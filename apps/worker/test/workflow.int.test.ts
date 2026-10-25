import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimNextJob, createRun, type Db } from "@reprolab/db";
import { ALL_BUGS_ENABLED, findSeededReport, type SeedKey } from "@reprolab/shared";
import type { AppConfig } from "@reprolab/shared/node";
import { createStoreServers, type StoreServers } from "../../store/server/app";
import { elementIdFor, FakeProvider } from "../../../test/support/fake-provider";
import { resetDb, storeDistDir, testConfig, testDb } from "../../../test/support/helpers";
import { createPlannerFactory } from "../src/planners/factory";
import { Worker, type Logger } from "../src/worker";
import type { ModelProvider } from "../src/ai/provider";

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const db: Db = testDb();
let store: StoreServers;
let config: AppConfig;

beforeAll(async () => {
  store = await createStoreServers({ distDir: storeDistDir() });
  await store.publicApp.listen({ port: 0, host: "127.0.0.1" });
  await store.adminApp.listen({ port: 0, host: "127.0.0.1" });
  const port = (app: StoreServers["publicApp"]) => (app.server.address() as { port: number }).port;
  config = testConfig({
    STORE_URL: `http://127.0.0.1:${port(store.publicApp)}`,
    STORE_ADMIN_URL: `http://127.0.0.1:${port(store.adminApp)}`,
    JOB_MAX_ATTEMPTS: "2",
  });
});
afterAll(async () => {
  await Promise.allSettled([store.publicApp.close(), store.adminApp.close()]);
  await db.$disconnect();
});
beforeEach(async () => {
  await resetDb(db);
  store.setBugs(ALL_BUGS_ENABLED);
});

async function seededReport(seedKey: SeedKey) {
  const seeded = findSeededReport(seedKey)!;
  return db.report.create({
    data: {
      seedKey,
      title: seeded.title,
      description: seeded.description,
      expectedBehavior: seeded.expectedBehavior,
      actualBehavior: seeded.actualBehavior ?? null,
    },
  });
}

async function runToEnd(reportId: string, mode: "SCRIPTED" | "LIVE_AI", options: { cfg?: AppConfig; provider?: ModelProvider } = {}) {
  const cfg = options.cfg ?? config;
  const worker = new Worker(db, cfg, createPlannerFactory(cfg, options.provider ?? null), silent);
  const run = await createRun(db, reportId, mode, cfg.jobMaxAttempts);
  await worker.runOnce();
  return loadRun(run.id);
}

const loadRun = (id: string) =>
  db.run.findUniqueOrThrow({
    where: { id },
    include: { actions: { orderBy: { index: "asc" } }, artifacts: true, events: true, job: true },
  });

describe("scripted reproduction, end to end", () => {
  it("reproduces a seeded bug with evidence and a regression test", async () => {
    const report = await seededReport("coupon-removal-total");
    const run = await runToEnd(report.id, "SCRIPTED");

    expect(run).toMatchObject({ status: "COMPLETED", outcome: "REPRODUCED", reasonCode: "CHECK_FAILED" });
    expect(run.job?.status).toBe("SUCCEEDED");
    expect(run.actions.map((a) => a.status)).toEqual(Array(7).fill("succeeded"));
    expect(run.observedTriggers).toEqual(expect.arrayContaining(["coupon_applied", "coupon_removed"]));
    expect(run.storeConfig).toEqual({ bugs: ALL_BUGS_ENABLED });
    expect(run.regressionTest).toContain(`toHaveText("$24.00")`);

    // Screenshots and the trace exist on disk where the artifact records say.
    const screenshots = run.artifacts.filter((a) => a.kind === "SCREENSHOT");
    expect(screenshots).toHaveLength(7);
    expect(run.artifacts.some((a) => a.kind === "TRACE")).toBe(true);
    for (const artifact of run.artifacts) expect(existsSync(path.join(config.artifactDir, artifact.relativePath))).toBe(true);
  });

  it("reports Not reproduced when the bug is fixed, without a test", async () => {
    store.setBugs({ quantitySubtotal: false });
    const run = await runToEnd((await seededReport("quantity-subtotal")).id, "SCRIPTED");
    expect(run).toMatchObject({ outcome: "NOT_REPRODUCED", reasonCode: "CHECKS_PASSED", regressionTest: null });
  });

  it("explains that live AI is required for a report without a recipe", async () => {
    const report = await db.report.create({
      data: { title: "My own report", description: "Some steps here", expectedBehavior: "Something specific" },
    });
    const run = await runToEnd(report.id, "SCRIPTED");
    expect(run).toMatchObject({ outcome: "INCONCLUSIVE", reasonCode: "SCRIPTED_RECIPE_UNAVAILABLE" });
    expect(run.actions).toHaveLength(0);
  });
});

describe("infrastructure failures", () => {
  it("retries an unreachable store, then reports Execution failed (not Not reproduced)", async () => {
    const down = testConfig({ STORE_URL: "http://127.0.0.1:9", STORE_ADMIN_URL: "http://127.0.0.1:9", JOB_MAX_ATTEMPTS: "2" });
    const worker = new Worker(db, down, createPlannerFactory(down, null), silent);
    const report = await seededReport("stale-cart-badge");
    const { id } = await createRun(db, report.id, "SCRIPTED", down.jobMaxAttempts);

    await worker.runOnce();
    const afterFirst = await loadRun(id);
    expect(afterFirst).toMatchObject({ status: "QUEUED", outcome: null });
    expect(afterFirst.job).toMatchObject({ status: "QUEUED", attempts: 1 });

    await new Promise((r) => setTimeout(r, 2100)); // first retry delay
    await worker.runOnce();
    const final = await loadRun(id);
    expect(final).toMatchObject({ status: "COMPLETED", outcome: "EXECUTION_FAILED", reasonCode: "STORE_UNAVAILABLE" });
    expect(final.job).toMatchObject({ status: "FAILED", attempts: 2 });
    expect(final.events.some((e) => e.message.includes("Retrying"))).toBe(true);
  });

  it("recovers a run whose worker died mid-job", async () => {
    const report = await seededReport("stale-cart-badge");
    const { id } = await createRun(db, report.id, "SCRIPTED", 2);
    const abandoned = await claimNextJob(db, "worker-that-crashed", 30_000);
    await db.$executeRaw`UPDATE "Job" SET "lockedUntil" = now() - interval '1 second' WHERE id = ${abandoned!.id}::uuid`;

    await new Worker(db, config, createPlannerFactory(config, null), silent).runOnce();
    const run = await loadRun(id);
    expect(run).toMatchObject({ outcome: "REPRODUCED", attempt: 2 });
    expect(run.events.some((e) => e.message.includes("worker-that-crashed"))).toBe(true);
  });

  it("fails clearly when live AI is requested without a configured provider", async () => {
    const run = await runToEnd((await seededReport("stale-cart-badge")).id, "LIVE_AI");
    expect(run).toMatchObject({ outcome: "EXECUTION_FAILED", reasonCode: "AI_NOT_CONFIGURED" });
  });
});

describe("live AI mode with a scripted fake model", () => {
  const ready = {
    status: "ready",
    expectedOutcome: {
      summary: "Without the coupon the total equals the subtotal",
      triggers: ["coupon_applied", "coupon_removed"],
      checks: ["total_matches_spec"],
    },
    plan: ["add tote", "open cart", "apply SAVE10", "remove coupon"],
  };
  const act = (action: (user: string) => unknown) => (req: { user: string }) => ({
    decision: "act",
    action: action(req.user),
    rationale: "following the report",
  });

  it("executes only validated actions and lets the oracle decide the outcome", async () => {
    const provider = new FakeProvider([
      ready,
      act(() => ({ type: "navigate", route: "/" })),
      act((u) => ({ type: "click", elementId: elementIdFor(u, "add-to-cart-canvas-tote") })),
      // A manipulated or confused model: an element that was never observed.
      act(() => ({ type: "click", elementId: "e999" })),
      act(() => ({ type: "navigate", route: "/cart" })),
      act((u) => ({ type: "fill", elementId: elementIdFor(u, "coupon-input"), value: "SAVE10" })),
      act((u) => ({ type: "click", elementId: elementIdFor(u, "apply-coupon") })),
      act((u) => ({ type: "click", elementId: elementIdFor(u, "remove-coupon") })),
      { decision: "done", rationale: "The bug is definitely reproduced." },
    ]);
    const run = await runToEnd((await seededReport("coupon-removal-total")).id, "LIVE_AI", { provider });

    expect(run).toMatchObject({ outcome: "REPRODUCED", reasonCode: "CHECK_FAILED", modelProvider: "fake", modelCalls: 9 });
    expect(run.actions.find((a) => a.index === 3)).toMatchObject({ status: "rejected" });
    expect(run.estimatedCostUsd).toBeNull(); // no prices configured
    expect(run.inputTokens).toBe(9000);
    expect(run.regressionTest).toContain(`toHaveText("$24.00")`);
    expect(provider.requests[1]!.user).toContain("<bug_report>");
  });

  it("does not accept the model's claim that it finished without the described scenario", async () => {
    store.setBugs({ couponRemovalTotal: false });
    const provider = new FakeProvider([
      ready,
      act(() => ({ type: "navigate", route: "/cart" })),
      { decision: "done", rationale: "Looks fine to me." },
    ]);
    const run = await runToEnd((await seededReport("coupon-removal-total")).id, "LIVE_AI", { provider });
    // Not "Not reproduced": the coupon was never applied or removed.
    expect(run).toMatchObject({ outcome: "INCONCLUSIVE", reasonCode: "TRIGGER_NOT_OBSERVED" });
    expect(run.missingTriggers).toEqual(["coupon_applied", "coupon_removed"]);
  });

  it("stops at the run time limit and closes the browser", async () => {
    const slow = testConfig({ STORE_URL: config.storeUrl, STORE_ADMIN_URL: config.storeAdminUrl, RUN_TIMEOUT_MS: "10000" });
    const hang = (req: { signal: AbortSignal }) =>
      new Promise((_, reject) => req.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const provider = new FakeProvider([ready, act(() => ({ type: "navigate", route: "/" })), hang]);
    const started = Date.now();
    const run = await runToEnd((await seededReport("coupon-removal-total")).id, "LIVE_AI", { cfg: slow, provider });
    expect(run).toMatchObject({ outcome: "INCONCLUSIVE", reasonCode: "BUDGET_EXHAUSTED" });
    expect(Date.now() - started).toBeLessThan(25_000);
  });
});
