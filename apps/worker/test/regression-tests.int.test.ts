import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRun } from "@reprolab/db";
import { ALL_BUGS_ENABLED, SEEDED_REPORTS } from "@reprolab/shared";
import { findRepoRoot, type AppConfig } from "@reprolab/shared/node";
import { createStoreServers, type StoreServers } from "../../store/server/app";
import { resetDb, storeDistDir, testConfig, testDb } from "../../../test/support/helpers";
import { createPlannerFactory } from "../src/planners/factory";
import { runGeneratedTest } from "../src/regression/run-test";
import { Worker } from "../src/worker";

/**
 * The core promise of an exported regression test: for every seeded bug it
 * must FAIL while the bug is enabled and PASS once the bug is fixed, when run
 * with the real Playwright test runner.
 */
const db = testDb();
let store: StoreServers;
let config: AppConfig;
// Inside the repo so the generated test can import @playwright/test.
const workDir = path.join(findRepoRoot(), ".data", "test-regression", randomUUID().slice(0, 8));

beforeAll(async () => {
  await resetDb(db);
  store = await createStoreServers({ distDir: storeDistDir() });
  await store.publicApp.listen({ port: 0, host: "127.0.0.1" });
  await store.adminApp.listen({ port: 0, host: "127.0.0.1" });
  const port = (app: StoreServers["publicApp"]) => (app.server.address() as { port: number }).port;
  config = testConfig({
    STORE_URL: `http://127.0.0.1:${port(store.publicApp)}`,
    STORE_ADMIN_URL: `http://127.0.0.1:${port(store.adminApp)}`,
  });
});
afterAll(async () => {
  await Promise.allSettled([store.publicApp.close(), store.adminApp.close()]);
  await db.$disconnect();
});

describe.each(SEEDED_REPORTS)("exported test for $seedKey", (seeded) => {
  it("fails with the bug enabled and passes after the fix", async () => {
    store.setBugs(ALL_BUGS_ENABLED);
    const report = await db.report.create({
      data: { seedKey: seeded.seedKey, title: seeded.title, description: seeded.description, expectedBehavior: seeded.expectedBehavior },
    });
    const { id } = await createRun(db, report.id, "SCRIPTED", 1);
    await new Worker(db, config, createPlannerFactory(config, null), { info() {}, warn() {}, error() {} }).runOnce();
    const run = await db.run.findUniqueOrThrow({ where: { id } });
    expect(run.outcome).toBe("REPRODUCED");
    const test = { dir: workDir, fileName: run.regressionTestFileName!, code: run.regressionTest!, storeUrl: config.storeUrl };

    store.setBugs({ [seeded.bug]: true });
    const withBug = await runGeneratedTest(test);
    // It must fail because an assertion caught the bug, not because the test broke.
    expect(withBug.outcome, withBug.output).toBe("assertion_failed");

    store.setBugs({ [seeded.bug]: false });
    const fixed = await runGeneratedTest(test);
    expect(fixed.outcome, fixed.output).toBe("passed");
  });
});
