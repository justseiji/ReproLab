import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimNextJob,
  completeJob,
  createRun,
  markRunExecutionFailed,
  reapExpiredJobs,
  renewLease,
  retryDelayMs,
  scheduleRetry,
} from "../src";
import { resetDb, testDb } from "../../../test/support/helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(() => resetDb(db));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function queueRuns(count: number, maxAttempts = 3) {
  const report = await db.report.create({
    data: { title: "Queue test", description: "Queue test description", expectedBehavior: "Works" },
  });
  const runs = [];
  for (let i = 0; i < count; i++) runs.push(await createRun(db, report.id, "SCRIPTED", maxAttempts));
  return runs;
}

/** Simulates time passing for a lease without waiting for it. */
const expireLease = (jobId: string) =>
  db.$executeRaw`UPDATE "Job" SET "lockedUntil" = now() - interval '1 second' WHERE id = ${jobId}::uuid`;

describe("job claiming", () => {
  it("hands every job to exactly one of many concurrent workers", async () => {
    await queueRuns(25);
    const claimed: string[] = [];
    await Promise.all(
      Array.from({ length: 8 }, async (_, w) => {
        for (;;) {
          const job = await claimNextJob(db, `worker-${w}`, 30_000);
          if (!job) return;
          claimed.push(job.id);
        }
      }),
    );
    expect(claimed).toHaveLength(25);
    expect(new Set(claimed).size).toBe(25);
    expect(await db.job.count({ where: { status: "RUNNING" } })).toBe(25);
  });

  it("does not hand out a job while its lease is valid", async () => {
    await queueRuns(1);
    const first = await claimNextJob(db, "a", 30_000);
    expect(first).toMatchObject({ attempts: 1, previousOwner: null });
    expect(await claimNextJob(db, "b", 30_000)).toBeNull();
    expect(await renewLease(db, first!.id, "a", 30_000)).toBe(true);
  });
});

describe("failure recovery", () => {
  it("lets another worker take over an expired lease, and fences out the old owner", async () => {
    await queueRuns(1);
    const original = await claimNextJob(db, "crashed-worker", 30_000);
    await expireLease(original!.id);

    const takeover = await claimNextJob(db, "healthy-worker", 30_000);
    expect(takeover).toMatchObject({ id: original!.id, attempts: 2, previousOwner: "crashed-worker" });

    // The old worker wakes up: it can neither renew nor complete the job.
    expect(await renewLease(db, original!.id, "crashed-worker", 30_000)).toBe(false);
    expect(await completeJob(db, original!.id, "crashed-worker")).toBe(false);
    expect(await completeJob(db, original!.id, "healthy-worker")).toBe(true);
    expect((await db.job.findUniqueOrThrow({ where: { id: original!.id } })).status).toBe("SUCCEEDED");
  });

  it("retries transient failures after a backoff delay", async () => {
    await queueRuns(1);
    const job = await claimNextJob(db, "w", 30_000);
    expect(await scheduleRetry(db, job!.id, "w", "store unreachable", 1200)).toBe(true);
    expect(await claimNextJob(db, "w", 30_000)).toBeNull(); // not yet due
    await sleep(1300);
    expect(await claimNextJob(db, "w", 30_000)).toMatchObject({ id: job!.id, attempts: 2 });
  });

  it("gives up on a job whose final attempt expired and records an execution failure", async () => {
    const [run] = await queueRuns(1, 1);
    const job = await claimNextJob(db, "w", 30_000);
    await expireLease(job!.id);

    expect(await claimNextJob(db, "other", 30_000)).toBeNull(); // no attempts left
    expect(await reapExpiredJobs(db)).toEqual([run!.id]);
    await markRunExecutionFailed(db, run!.id, "WORKER_LOST", "Worker stopped responding.");

    const stored = await db.run.findUniqueOrThrow({ where: { id: run!.id }, include: { job: true } });
    expect(stored).toMatchObject({ status: "COMPLETED", outcome: "EXECUTION_FAILED", reasonCode: "WORKER_LOST" });
    expect(stored.job?.status).toBe("FAILED");
  });

  it("backs off exponentially with a cap", () => {
    expect([1, 2, 3, 10].map(retryDelayMs)).toEqual([2000, 4000, 8000, 30_000]);
  });
});
