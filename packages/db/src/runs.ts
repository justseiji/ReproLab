import type { ReasonCode, ReportInput, RunMode } from "@reprolab/shared";
import type { Db } from "./client";

/** Creates a run and its queue job in one transaction. */
export async function createRun(db: Db, reportId: string, mode: RunMode, maxAttempts: number) {
  return db.run.create({
    data: {
      reportId,
      mode,
      phase: "Queued",
      job: { create: { maxAttempts } },
      events: { create: { level: "info", message: `Run queued (${mode === "SCRIPTED" ? "scripted demo" : "live AI"})` } },
    },
  });
}

export async function createReportWithRun(db: Db, input: ReportInput, mode: RunMode, maxAttempts: number) {
  return db.$transaction(async (tx) => {
    const report = await tx.report.create({
      data: {
        title: input.title,
        description: input.description,
        expectedBehavior: input.expectedBehavior,
        actualBehavior: input.actualBehavior ?? null,
      },
    });
    const run = await createRun(tx as Db, report.id, mode, maxAttempts);
    return { report, run };
  });
}

export async function addRunEvent(db: Db, runId: string, level: "info" | "warn" | "error", message: string) {
  await db.runEvent.create({ data: { runId, level, message: message.slice(0, 1000) } });
}

/** Records an infrastructure failure as the run's final outcome. */
export async function markRunExecutionFailed(db: Db, runId: string, reasonCode: ReasonCode, summary: string) {
  const run = await db.run.findUnique({ where: { id: runId }, select: { startedAt: true } });
  const finishedAt = new Date();
  await db.run.update({
    where: { id: runId },
    data: {
      status: "COMPLETED",
      outcome: "EXECUTION_FAILED",
      reasonCode,
      summary,
      phase: "Finished",
      finishedAt,
      durationMs: run?.startedAt ? finishedAt.getTime() - run.startedAt.getTime() : null,
      events: { create: { level: "error", message: summary.slice(0, 1000) } },
    },
  });
}
