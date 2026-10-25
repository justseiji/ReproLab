import { createRun, type Db, type Run } from "@reprolab/db";
import type { RunMode } from "@reprolab/shared";
import type { AppConfig } from "@reprolab/shared/node";
import { checkStoreReachable, getStoreBugs } from "../engine/store-admin";
import type { Worker } from "../worker";

/** Shared helpers for the evaluation and verification commands. */

export async function requireStore(config: AppConfig): Promise<void> {
  await checkStoreReachable(config.storeUrl);
  await getStoreBugs(config.storeAdminUrl).catch(() => {
    throw new Error(`The store admin API at ${config.storeAdminUrl} is not reachable. Start the store first.`);
  });
}

export async function findSeededReportId(db: Db, seedKey: string): Promise<string> {
  const report = await db.report.findUnique({ where: { seedKey } });
  if (!report) throw new Error(`Seeded report "${seedKey}" not found. Run: npm run db:seed`);
  return report.id;
}

/** Queues a run and drives it to completion with an in-process worker. */
export async function runToCompletion(
  db: Db,
  worker: Worker,
  config: AppConfig,
  reportId: string,
  mode: RunMode,
): Promise<Run> {
  const run = await createRun(db, reportId, mode, config.jobMaxAttempts);
  const deadline = Date.now() + config.run.timeoutMs * config.jobMaxAttempts + 60_000;
  for (;;) {
    const current = await db.run.findUniqueOrThrow({ where: { id: run.id } });
    if (current.status === "COMPLETED") return current;
    if (Date.now() > deadline) throw new Error(`Run ${run.id} did not finish in time.`);
    // Processes whatever job is next (ours, or another queued one).
    const processed = await worker.runOnce();
    if (!processed) await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

export function table(rows: Array<Record<string, string | number>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const line = (cells: Array<string | number>) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map((r) => line(headers.map((h) => r[h] ?? "")))].join("\n");
}
