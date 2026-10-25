import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "@reprolab/db";
import { AI_PROVIDERS, SEED_KEYS, type AppConfigDto } from "@reprolab/shared";
import { liveAiStatus, type AppConfig } from "@reprolab/shared/node";
import { registerErrorHandling } from "./errors";
import { demoRoutes, httpStoreAdmin, type StoreAdminClient } from "./routes/demo";
import { reportRoutes } from "./routes/reports";
import { runRoutes } from "./routes/runs";

export interface AppContext {
  db: Db;
  config: AppConfig;
  storeAdmin: StoreAdminClient;
}

export interface BuildOptions {
  db: Db;
  config: AppConfig;
  storeAdmin?: StoreAdminClient;
  /** Built web UI to serve in production (skipped when missing). */
  webDistDir?: string;
  logger?: boolean;
}

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const ctx: AppContext = {
    db: options.db,
    config: options.config,
    storeAdmin: options.storeAdmin ?? httpStoreAdmin(options.config.storeAdminUrl),
  };
  const app = Fastify({
    bodyLimit: 64 * 1024,
    logger: options.logger
      ? { redact: ["req.headers.authorization", "req.headers.cookie", "req.headers['x-api-key']"] }
      : false,
  });

  app.addHook("onSend", async (_request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
  });
  const serveWeb = Boolean(options.webDistDir && existsSync(`${options.webDistDir}/index.html`));
  registerErrorHandling(app, serveWeb);
  if (serveWeb) await app.register(fastifyStatic, { root: options.webDistDir! });

  app.get("/api/health", async () => {
    await ctx.db.$queryRaw`SELECT 1`;
    return { ok: true };
  });

  app.get("/api/config", async (): Promise<AppConfigDto> => {
    const ai = liveAiStatus(ctx.config);
    return {
      liveAi: {
        available: ai.available,
        provider: ai.available ? ctx.config.ai.provider : null,
        providerLabel: ai.available ? AI_PROVIDERS[ctx.config.ai.provider].label : null,
        model: ai.available ? ctx.config.ai.model : null,
        reason: ai.reason,
      },
      scriptedSeedKeys: [...SEED_KEYS],
      limits: {
        maxActionsScripted: ctx.config.run.maxActionsScripted,
        maxActionsLive: ctx.config.run.maxActionsLive,
        runTimeoutMs: ctx.config.run.timeoutMs,
      },
      storeUrl: ctx.config.storeUrl,
    };
  });

  reportRoutes(app, ctx);
  runRoutes(app, ctx);
  demoRoutes(app, ctx);

  return app;
}
