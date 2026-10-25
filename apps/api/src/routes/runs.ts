import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { toRunDetail } from "../dto";
import { IdParamSchema, notFound, parseOrThrow } from "../errors";
import type { AppContext } from "../app";

export function runRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;

  app.get("/api/runs/:id", async (request) => {
    const { id } = parseOrThrow(IdParamSchema, request.params);
    const run = await db.run.findUnique({
      where: { id },
      include: {
        report: true,
        actions: true,
        evidence: { orderBy: { at: "asc" } },
        artifacts: { orderBy: { createdAt: "asc" } },
        events: { orderBy: { at: "asc" }, take: 200 },
        job: { select: { maxAttempts: true } },
      },
    });
    if (!run) throw notFound("Run");
    return toRunDetail(run);
  });

  app.get("/api/runs/:id/regression-test", async (request, reply) => {
    const { id } = parseOrThrow(IdParamSchema, request.params);
    const run = await db.run.findUnique({ where: { id }, select: { regressionTest: true, regressionTestFileName: true } });
    if (!run?.regressionTest || !run.regressionTestFileName) throw notFound("Regression test");
    return reply
      .header("content-type", "text/plain; charset=utf-8")
      .header("content-disposition", `attachment; filename="${run.regressionTestFileName}"`)
      .send(run.regressionTest);
  });

  /**
   * Serves screenshots and traces by artifact id. The file path comes from the
   * database (written by the worker), never from the request, and is checked
   * to stay inside ARTIFACT_DIR before anything is read.
   */
  app.get("/api/artifacts/:id", async (request, reply) => {
    const { id } = parseOrThrow(IdParamSchema, request.params);
    const artifact = await db.artifact.findUnique({ where: { id } });
    if (!artifact) throw notFound("Artifact");

    const root = path.resolve(config.artifactDir);
    const filePath = path.resolve(root, artifact.relativePath);
    if (!filePath.startsWith(root + path.sep)) throw notFound("Artifact");
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) throw notFound("Artifact file");

    const disposition = artifact.kind === "TRACE" ? `attachment; filename="trace-${artifact.runId.slice(0, 8)}-attempt-${artifact.attempt}.zip"` : "inline";
    return reply
      .header("content-type", artifact.contentType)
      .header("content-length", info.size)
      .header("content-disposition", disposition)
      .header("cache-control", "private, max-age=3600")
      .send(createReadStream(filePath));
  });
}
