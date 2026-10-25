import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDb } from "@reprolab/db";
import { ALL_BUGS_ENABLED, SEEDED_REPORTS } from "@reprolab/shared";
import { findRepoRoot, loadConfig } from "@reprolab/shared/node";
import { getStoreBugs, setStoreBugs } from "../engine/store-admin";
import { createPlannerFactory } from "../planners/factory";
import { runGeneratedTest } from "../regression/run-test";
import { consoleLogger, Worker } from "../worker";
import { findSeededReportId, requireStore, runToCompletion, table } from "./harness";

/**
 * For each seeded bug: reproduce it in scripted mode, take the exported
 * Playwright test, and run it with the real Playwright runner twice:
 *   1. bug enabled  → the test must FAIL
 *   2. bug fixed    → the test must PASS
 */
const config = loadConfig();
const db = createDb(config.databaseUrl);
const worker = new Worker(db, config, createPlannerFactory(config), { ...consoleLogger, info: () => {} });
const root = findRepoRoot();
const workDir = path.join(root, ".data", "regression-check");

await requireStore(config);
const originalBugs = await getStoreBugs(config.storeAdminUrl);
const rows = [];
let allOk = true;

try {
  for (const seeded of SEEDED_REPORTS) {
    await setStoreBugs(config.storeAdminUrl, ALL_BUGS_ENABLED);
    const run = await runToCompletion(db, worker, config, await findSeededReportId(db, seeded.seedKey), "SCRIPTED");
    if (run.outcome !== "REPRODUCED" || !run.regressionTest || !run.regressionTestFileName) {
      allOk = false;
      rows.push({ Report: seeded.seedKey, Reproduction: run.outcome ?? "—", "Bug enabled": "not run", "Bug fixed": "not run", Verdict: "✘" });
      continue;
    }
    const test = { dir: workDir, fileName: run.regressionTestFileName, code: run.regressionTest, storeUrl: config.storeUrl };

    await setStoreBugs(config.storeAdminUrl, { [seeded.bug]: true });
    const broken = await runGeneratedTest(test);
    await setStoreBugs(config.storeAdminUrl, { [seeded.bug]: false });
    const fixed = await runGeneratedTest(test);

    // The bug-enabled run must fail on an assertion (not crash); the fixed run must pass.
    const ok = broken.outcome === "assertion_failed" && fixed.outcome === "passed";
    allOk &&= ok;
    rows.push({
      Report: seeded.seedKey,
      Reproduction: run.outcome,
      "Bug enabled": `${broken.outcome} (${broken.durationMs} ms)`,
      "Bug fixed": `${fixed.outcome} (${fixed.durationMs} ms)`,
      "Failure message (bug enabled)": broken.message?.slice(0, 80) ?? "—",
      Verdict: ok ? "✔" : "✘",
    });
    await mkdir(path.join(root, "eval-results", "regression-tests"), { recursive: true });
    await writeFile(path.join(root, "eval-results", "regression-tests", `${seeded.seedKey}.spec.ts`), run.regressionTest);
    if (!ok) console.log(`--- ${seeded.seedKey} output (bug enabled) ---\n${broken.output}\n--- (bug fixed) ---\n${fixed.output}`);
  }
} finally {
  await setStoreBugs(config.storeAdminUrl, originalBugs);
}

console.log("\nGenerated regression tests: expected to FAIL with the bug and PASS once fixed\n");
console.log(table(rows));
await writeFile(
  path.join(root, "eval-results", "regression-tests", "latest.json"),
  JSON.stringify({ checkedAt: new Date().toISOString(), rows }, null, 2),
);
await db.$disconnect();
process.exit(allOk ? 0 : 1);
