import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRun } from "@reprolab/db";
import { ALL_BUGS_ENABLED, type BugFlags } from "@reprolab/shared";
import type { AppConfig } from "@reprolab/shared/node";
import { resetDb, testConfig, testDb } from "../../../test/support/helpers";
import { buildApp } from "../src/app";
import type { StoreAdminClient } from "../src/routes/demo";

const db = testDb();
let app: FastifyInstance;
let liveApp: FastifyInstance;
let config: AppConfig;
let bugs: BugFlags = { ...ALL_BUGS_ENABLED };
let storeAdminDown = false;

const fakeStoreAdmin: StoreAdminClient = {
  getBugs: async () => {
    if (storeAdminDown) throw new Error("connection refused");
    return bugs;
  },
  setBugs: async (update) => {
    if (storeAdminDown) throw new Error("connection refused");
    return (bugs = { ...bugs, ...update });
  },
};

const validReport = {
  title: "Checkout total is wrong",
  description: "1. Add an item\n2. Open the cart",
  expectedBehavior: "Total equals subtotal",
};

beforeAll(async () => {
  config = testConfig();
  app = await buildApp({ db, config, storeAdmin: fakeStoreAdmin });
  liveApp = await buildApp({ db, config: testConfig({ ANTHROPIC_API_KEY: "test-key-not-used" }), storeAdmin: fakeStoreAdmin });
});
afterAll(async () => {
  await app.close();
  await liveApp.close();
  await db.$disconnect();
});
beforeEach(async () => {
  await resetDb(db);
  bugs = { ...ALL_BUGS_ENABLED };
  storeAdminDown = false;
});

describe("reports API", () => {
  it("validates input and returns field-level errors in a consistent envelope", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/reports",
      payload: { report: { title: "x", description: "", expectedBehavior: "ok" }, mode: "SCRIPTED" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details.map((d: { path: string }) => d.path)).toEqual([
      "report.title",
      "report.description",
      "report.expectedBehavior",
    ]);
    expect(await db.report.count()).toBe(0);
  });

  it("rejects malformed JSON with the same envelope", async () => {
    const res = await app.inject({ method: "POST", url: "/api/reports", headers: { "content-type": "application/json" }, payload: "{oops" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBeTypeOf("string");
  });

  it("saves the report and queues a run in one step", async () => {
    const res = await app.inject({ method: "POST", url: "/api/reports", payload: { report: validReport, mode: "SCRIPTED" } });
    expect(res.statusCode).toBe(201);
    const { report, run } = res.json();
    expect(run).toMatchObject({ status: "QUEUED", mode: "SCRIPTED" });
    expect(report.scriptedSupported).toBe(false);
    const job = await db.job.findUniqueOrThrow({ where: { runId: run.id } });
    expect(job).toMatchObject({ status: "QUEUED", attempts: 0, maxAttempts: config.jobMaxAttempts });
  });

  it("refuses live AI runs when no API key is configured, saving nothing", async () => {
    const res = await app.inject({ method: "POST", url: "/api/reports", payload: { report: validReport, mode: "LIVE_AI" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("LIVE_AI_UNAVAILABLE");
    expect(await db.report.count()).toBe(0);
    // With a key configured, the same request is accepted.
    const ok = await liveApp.inject({ method: "POST", url: "/api/reports", payload: { report: validReport, mode: "LIVE_AI" } });
    expect(ok.statusCode).toBe(201);
  });

  it("reports whether live AI is available without exposing the key", async () => {
    const res = await liveApp.inject({ method: "GET", url: "/api/config" });
    expect(res.json().liveAi).toMatchObject({ available: true, model: config.ai.model });
    expect(res.body).not.toContain("test-key-not-used");
  });

  it("returns 400 for malformed ids and 404 for unknown ones", async () => {
    expect((await app.inject({ method: "GET", url: "/api/runs/not-a-uuid" })).statusCode).toBe(400);
    const missing = await app.inject({ method: "GET", url: "/api/runs/00000000-0000-4000-8000-000000000000" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("NOT_FOUND");
  });
});

describe("runs and artifacts", () => {
  async function runWithArtifact(relativePath: string) {
    const report = await db.report.create({ data: validReport });
    const run = await createRun(db, report.id, "SCRIPTED", 1);
    const artifact = await db.artifact.create({
      data: { runId: run.id, attempt: 1, kind: "SCREENSHOT", label: "shot", relativePath, contentType: "image/jpeg", sizeBytes: 3 },
    });
    return { run, artifact };
  }

  it("serves an artifact by id from inside the artifact directory", async () => {
    const { run, artifact } = await runWithArtifact("run/attempt-1/step-01.jpg");
    mkdirSync(path.join(config.artifactDir, "run", "attempt-1"), { recursive: true });
    writeFileSync(path.join(config.artifactDir, "run", "attempt-1", "step-01.jpg"), "jpg");
    const res = await app.inject({ method: "GET", url: `/api/artifacts/${artifact.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.body).toBe("jpg");
    expect((await app.inject({ method: "GET", url: `/api/runs/${run.id}` })).json().status).toBe("QUEUED");
  });

  it("never reads outside the artifact directory, even if a stored path tries to escape", async () => {
    const outside = path.join(path.dirname(config.artifactDir), "secret.txt");
    writeFileSync(outside, "secret");
    const { artifact } = await runWithArtifact("../secret.txt");
    const res = await app.inject({ method: "GET", url: `/api/artifacts/${artifact.id}` });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("secret");
  });

  it("downloads a generated regression test as an attachment", async () => {
    const report = await db.report.create({ data: validReport });
    const run = await createRun(db, report.id, "SCRIPTED", 1);
    await db.run.update({
      where: { id: run.id },
      data: { regressionTest: "// test", regressionTestFileName: "reprolab-x-12345678.spec.ts" },
    });
    const res = await app.inject({ method: "GET", url: `/api/runs/${run.id}/regression-test` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="reprolab-x-12345678.spec.ts"');
    expect(res.body).toBe("// test");
  });
});

describe("demo store controls", () => {
  it("reads and switches bugs through the store admin client", async () => {
    expect((await app.inject({ method: "GET", url: "/api/demo/store-bugs" })).json()).toEqual({ bugs: ALL_BUGS_ENABLED });
    const res = await app.inject({ method: "PUT", url: "/api/demo/store-bugs", payload: { staleCartBadge: false } });
    expect(res.json().bugs.staleCartBadge).toBe(false);
    const bad = await app.inject({ method: "PUT", url: "/api/demo/store-bugs", payload: { notABug: true } });
    expect(bad.statusCode).toBe(400);
  });

  it("reports an unreachable store as 502", async () => {
    storeAdminDown = true;
    const res = await app.inject({ method: "GET", url: "/api/demo/store-bugs" });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("STORE_ADMIN_UNAVAILABLE");
  });
});
