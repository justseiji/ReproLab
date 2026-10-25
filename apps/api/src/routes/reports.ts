import type { FastifyInstance } from "fastify";
import { createReportWithRun, createRun } from "@reprolab/db";
import { CreateReportRequestSchema, CreateRunRequestSchema, type RunMode } from "@reprolab/shared";
import { liveAiStatus } from "@reprolab/shared/node";
import { toReportDetail, toReportSummary, toRunSummary } from "../dto";
import { ApiError, IdParamSchema, notFound, parseOrThrow } from "../errors";
import type { AppContext } from "../app";

export function reportRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;

  /** Live AI runs are refused up front when no API key is configured, so nothing is saved. */
  const assertModeAvailable = (mode: RunMode) => {
    const ai = liveAiStatus(config);
    if (mode === "LIVE_AI" && !ai.available) {
      throw new ApiError(409, "LIVE_AI_UNAVAILABLE", ai.reason ?? "Live AI mode is not available.");
    }
  };

  app.get("/api/reports", async () => {
    const reports = await db.report.findMany({
      orderBy: [{ seedKey: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 100,
      include: { runs: { orderBy: { createdAt: "desc" }, take: 1 }, _count: { select: { runs: true } } },
    });
    return reports.map(toReportSummary);
  });

  app.post("/api/reports", async (request, reply) => {
    const body = parseOrThrow(CreateReportRequestSchema, request.body);
    assertModeAvailable(body.mode);
    const { report, run } = await createReportWithRun(db, body.report, body.mode, config.jobMaxAttempts);
    return reply.code(201).send({ report: toReportDetail({ ...report, runs: [run] }), run: toRunSummary(run) });
  });

  app.get("/api/reports/:id", async (request) => {
    const { id } = parseOrThrow(IdParamSchema, request.params);
    const report = await db.report.findUnique({ where: { id }, include: { runs: { orderBy: { createdAt: "desc" } } } });
    if (!report) throw notFound("Report");
    return toReportDetail(report);
  });

  app.post("/api/reports/:id/runs", async (request, reply) => {
    const { id } = parseOrThrow(IdParamSchema, request.params);
    const { mode } = parseOrThrow(CreateRunRequestSchema, request.body);
    assertModeAvailable(mode);
    if (!(await db.report.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Report");
    const run = await createRun(db, id, mode, config.jobMaxAttempts);
    return reply.code(201).send(toRunSummary(run));
  });
}
