import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { createDb } from "@reprolab/db";
import {
  ALL_BUGS_ENABLED,
  ALL_BUGS_FIXED,
  RUN_MODE_LABELS,
  SEEDED_REPORTS,
  type BugFlags,
  type RunMode,
  type RunOutcome,
} from "@reprolab/shared";
import { findRepoRoot, liveAiStatus, loadConfig } from "@reprolab/shared/node";
import { getStoreBugs, setStoreBugs } from "../engine/store-admin";
import { createPlannerFactory } from "../planners/factory";
import { consoleLogger, Worker } from "../worker";
import { findSeededReportId, requireStore, runToCompletion, table } from "./harness";

/**
 * Evaluation command. Runs every seeded report with the store bugs enabled
 * (expected: Reproduced) and disabled (expected: Not reproduced), then prints
 * and saves the actual outcomes and durations. Scripted and live AI results
 * are written to separate folders and never mixed.
 *
 *   npm run eval:scripted
 *   npm run eval:live      (uses AI_PROVIDER; cloud providers need a key and spend tokens)
 */
const { values } = parseArgs({ options: { mode: { type: "string", default: "scripted" } } });
const mode: RunMode = values.mode === "live" ? "LIVE_AI" : "SCRIPTED";

const config = loadConfig();
if (mode === "LIVE_AI" && !liveAiStatus(config).available) {
  console.error(`Live AI evaluation is not available: ${liveAiStatus(config).reason} Nothing was run.`);
  process.exit(2);
}
const db = createDb(config.databaseUrl);
const quietLogger = { ...consoleLogger, info: () => {} };
const worker = new Worker(db, config, createPlannerFactory(config), quietLogger);

await requireStore(config);
const originalBugs = await getStoreBugs(config.storeAdminUrl);
const configurations: Array<{ name: "bugs enabled" | "bugs fixed"; bugs: BugFlags; expected: RunOutcome }> = [
  { name: "bugs enabled", bugs: ALL_BUGS_ENABLED, expected: "REPRODUCED" },
  { name: "bugs fixed", bugs: ALL_BUGS_FIXED, expected: "NOT_REPRODUCED" },
];

const startedAt = new Date();
const results = [];
try {
  for (const configuration of configurations) {
    await setStoreBugs(config.storeAdminUrl, configuration.bugs);
    for (const seeded of SEEDED_REPORTS) {
      const reportId = await findSeededReportId(db, seeded.seedKey);
      const wallStart = Date.now();
      const run = await runToCompletion(db, worker, config, reportId, mode);
      const actions = await db.runAction.count({ where: { runId: run.id, attempt: run.attempt } });
      const result = {
        report: seeded.seedKey,
        store: configuration.name,
        expected: configuration.expected,
        actual: run.outcome,
        reasonCode: run.reasonCode,
        matched: run.outcome === configuration.expected,
        runDurationMs: run.durationMs,
        wallClockMs: Date.now() - wallStart,
        actions,
        attempts: run.attempt,
        regressionTestGenerated: Boolean(run.regressionTest),
        modelCalls: run.modelCalls,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        estimatedCostUsd: run.estimatedCostUsd,
        runId: run.id,
      };
      results.push(result);
      console.log(`${result.matched ? "✔" : "✘"} ${seeded.seedKey} (${configuration.name}): ${run.outcome} in ${run.durationMs} ms`);
    }
  }
} finally {
  await setStoreBugs(config.storeAdminUrl, originalBugs);
}

const finishedAt = new Date();
const matched = results.filter((r) => r.matched).length;
const report = {
  mode,
  modeLabel: RUN_MODE_LABELS[mode],
  provider: mode === "LIVE_AI" ? config.ai.provider : null,
  model: mode === "LIVE_AI" ? config.ai.model : null,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  environment: { node: process.version, platform: `${os.platform()} ${os.release()}`, headless: config.run.headless },
  summary: { total: results.length, matched },
  results,
};

const outDir = path.join(findRepoRoot(), "eval-results", mode === "SCRIPTED" ? "scripted" : "live-ai");
await mkdir(outDir, { recursive: true });
const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
await writeFile(path.join(outDir, `${stamp}.json`), JSON.stringify(report, null, 2));
await writeFile(path.join(outDir, "latest.json"), JSON.stringify(report, null, 2));

console.log(`\n${RUN_MODE_LABELS[mode]} evaluation: ${matched}/${results.length} outcomes matched expectations\n`);
console.log(
  table(
    results.map((r) => ({
      Report: r.report,
      Store: r.store,
      Expected: r.expected,
      Actual: r.actual ?? "—",
      Reason: r.reasonCode ?? "—",
      "Run ms": r.runDurationMs ?? "—",
      Actions: r.actions,
      "Test generated": r.regressionTestGenerated ? "yes" : "no",
    })),
  ),
);
console.log(`\nSaved to ${path.relative(process.cwd(), outDir)}`);
await db.$disconnect();
process.exit(matched === results.length ? 0 : 1);
