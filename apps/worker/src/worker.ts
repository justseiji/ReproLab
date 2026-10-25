import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import {
  addRunEvent,
  claimNextJob,
  failJob,
  markRunExecutionFailed,
  reapExpiredJobs,
  releaseJob,
  renewLease,
  retryDelayMs,
  scheduleRetry,
  type ClaimedJob,
  type Db,
  type Report,
  type Run,
} from "@reprolab/db";
import type { AppConfig } from "@reprolab/shared/node";
import { RunRecorder } from "./engine/recorder";
import { reproduce } from "./engine/reproduce";
import { classifyError, LeaseLostError, ShutdownError } from "./errors";
import type { Planner } from "./planners/types";

export type PlannerFactory = (run: Run & { report: Report }) => Planner;

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const consoleLogger: Logger = {
  info: (m) => console.log(`[worker] ${m}`),
  warn: (m) => console.warn(`[worker] ${m}`),
  error: (m) => console.error(`[worker] ${m}`),
};

/**
 * Polls the queue and processes up to `concurrency` jobs at a time. Safe to
 * run as several processes: claiming is atomic and results are fenced on the
 * job lease.
 */
export class Worker {
  readonly id = `${hostname()}-${process.pid}-${randomUUID().slice(0, 6)}`;
  private readonly active = new Map<string, AbortController>();
  private stopping = false;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly createPlanner: PlannerFactory,
    private readonly log: Logger = consoleLogger,
  ) {}

  start(): void {
    this.loop = this.pollLoop();
  }

  private async pollLoop(): Promise<void> {
    let lastReap = 0;
    while (!this.stopping) {
      try {
        if (Date.now() - lastReap > 5_000) {
          lastReap = Date.now();
          await this.reap();
        }
        if (this.active.size < this.config.worker.concurrency) {
          const job = await claimNextJob(this.db, this.id, this.config.worker.leaseMs);
          if (job) {
            void this.process(job);
            continue; // look for more work immediately
          }
        }
      } catch (error) {
        this.log.error(`Poll failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, this.config.worker.pollIntervalMs));
    }
  }

  /** Records an execution failure on runs whose job ran out of attempts after lease expiry. */
  async reap(): Promise<void> {
    for (const runId of await reapExpiredJobs(this.db)) {
      this.log.warn(`Run ${runId}: worker lease expired on the final attempt`);
      await markRunExecutionFailed(
        this.db,
        runId,
        "WORKER_LOST",
        "The worker processing this run stopped responding and the retry limit was reached.",
      );
    }
  }

  /** Claims and processes a single job. Used by tests and the evaluation command. */
  async runOnce(): Promise<boolean> {
    const job = await claimNextJob(this.db, this.id, this.config.worker.leaseMs);
    if (!job) return false;
    await this.process(job);
    return true;
  }

  async process(job: ClaimedJob): Promise<void> {
    const interrupt = new AbortController();
    this.active.set(job.id, interrupt);
    let leaseLost = false;

    const heartbeat = setInterval(() => {
      renewLease(this.db, job.id, this.id, this.config.worker.leaseMs)
        .then((ok) => {
          if (!ok && !leaseLost) {
            leaseLost = true;
            interrupt.abort(new LeaseLostError());
          }
        })
        .catch(() => {});
    }, Math.max(1000, Math.floor(this.config.worker.leaseMs / 3)));

    let planner: Planner | null = null;
    try {
      const run = await this.db.run.findUnique({ where: { id: job.runId }, include: { report: true } });
      if (!run) {
        await failJob(this.db, job.id, this.id, "Run not found");
        return;
      }
      if (job.previousOwner) {
        await addRunEvent(this.db, run.id, "warn", `Recovered after worker ${job.previousOwner} stopped renewing its lease.`);
      }
      // startedAt is kept from the first attempt, so durations include retries.
      const startedAt = run.startedAt ?? new Date();
      await this.db.run.update({
        where: { id: run.id },
        data: { status: "RUNNING", attempt: job.attempts, startedAt, phase: "Starting" },
      });
      await addRunEvent(this.db, run.id, "info", `Attempt ${job.attempts} of ${job.maxAttempts} started by worker ${this.id}`);
      this.log.info(`Run ${run.id}: attempt ${job.attempts} (${run.mode})`);

      planner = this.createPlanner(run);
      const recorder = new RunRecorder(this.db, run.id, job.attempts, this.config.artifactDir);
      const signal = AbortSignal.any([interrupt.signal, AbortSignal.timeout(this.config.run.timeoutMs)]);
      const result = await reproduce({
        db: this.db,
        config: this.config,
        recorder,
        planner,
        runId: run.id,
        reportTitle: run.report.title,
        signal,
        interruption: () => (interrupt.signal.aborted ? (interrupt.signal.reason as Error) : null),
      });

      // Commit the result only if this worker still owns the job.
      const finishedAt = new Date();
      const usage = usageFields(planner);
      await this.db.$transaction(async (tx) => {
        const { count } = await tx.job.updateMany({
          where: { id: job.id, lockedBy: this.id, status: "RUNNING" },
          data: { status: "SUCCEEDED", lockedUntil: null },
        });
        if (count !== 1) throw new LeaseLostError();
        await tx.run.update({
          where: { id: run.id },
          data: {
            status: "COMPLETED",
            phase: "Finished",
            outcome: result.outcome,
            reasonCode: result.reasonCode,
            summary: result.summary,
            expectedOutcome: result.expected ?? undefined,
            clarification: result.clarification,
            checkResults: result.checkResults as object[],
            observedTriggers: result.observedTriggers,
            missingTriggers: result.missingTriggers,
            regressionTest: result.regressionTest?.code ?? null,
            regressionTestFileName: result.regressionTest?.fileName ?? null,
            regressionTestNote: result.regressionTestNote,
            ...usage,
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            events: { create: { level: "info", message: `Finished: ${result.outcome} (${result.reasonCode})` } },
          },
        });
      });
      this.log.info(`Run ${run.id}: ${result.outcome}`);
    } catch (error) {
      await this.handleFailure(job, error, planner);
    } finally {
      clearInterval(heartbeat);
      this.active.delete(job.id);
    }
  }

  private async handleFailure(job: ClaimedJob, error: unknown, planner: Planner | null): Promise<void> {
    if (error instanceof LeaseLostError) {
      this.log.warn(`Run ${job.runId}: lease lost; leaving the job to its new owner`);
      return;
    }
    if (error instanceof ShutdownError || this.stopping) {
      await releaseJob(this.db, job.id, this.id);
      await addRunEvent(this.db, job.runId, "warn", "Worker shut down; run returned to the queue.");
      return;
    }
    const failure = classifyError(error);
    if (planner) await this.db.run.update({ where: { id: job.runId }, data: usageFields(planner) }).catch(() => {});

    if (failure.transient && job.attempts < job.maxAttempts) {
      const delay = retryDelayMs(job.attempts);
      if (await scheduleRetry(this.db, job.id, this.id, failure.message, delay)) {
        await this.db.run.update({
          where: { id: job.runId },
          data: { status: "QUEUED", phase: `Retrying in ${Math.round(delay / 1000)}s` },
        });
        await addRunEvent(this.db, job.runId, "warn", `Transient failure (${failure.reasonCode}): ${failure.message} Retrying.`);
        this.log.warn(`Run ${job.runId}: transient failure, retry scheduled`);
      }
      return;
    }
    if (await failJob(this.db, job.id, this.id, failure.message)) {
      await markRunExecutionFailed(this.db, job.runId, failure.reasonCode, failure.message);
    }
    this.log.error(`Run ${job.runId}: execution failed (${failure.reasonCode}): ${failure.message}`);
  }

  /** Stops claiming, aborts running jobs, and returns them to the queue. */
  async stop(): Promise<void> {
    this.stopping = true;
    for (const controller of this.active.values()) controller.abort(new ShutdownError());
    await this.loop;
    const deadline = Date.now() + 15_000;
    while (this.active.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  }
}

function usageFields(planner: Planner) {
  const usage = planner.usage();
  if (!usage) return {};
  return {
    modelProvider: usage.provider,
    modelName: usage.model,
    modelCalls: usage.calls,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    estimatedCostUsd: usage.estimatedCostUsd,
  };
}
