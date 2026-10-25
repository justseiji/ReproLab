import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BUG_KEYS, type BugFlags, type StoreBugsDto } from "@reprolab/shared";
import { ApiError, parseOrThrow } from "../errors";
import type { AppContext } from "../app";

/**
 * Demo-only controls that switch the store's bugs between broken and fixed.
 * They go API → store admin port (127.0.0.1). The agent's browser can reach
 * neither the API nor the admin port.
 */
const BugUpdateSchema = z.strictObject(
  Object.fromEntries(BUG_KEYS.map((key) => [key, z.boolean().optional()])) as Record<
    (typeof BUG_KEYS)[number],
    z.ZodOptional<z.ZodBoolean>
  >,
);

export interface StoreAdminClient {
  getBugs(): Promise<BugFlags>;
  setBugs(update: Partial<BugFlags>): Promise<BugFlags>;
}

export function httpStoreAdmin(adminUrl: string): StoreAdminClient {
  const call = async (init?: RequestInit) => {
    const res = await fetch(new URL("/admin/bugs", adminUrl), { ...init, signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as StoreBugsDto).bugs;
  };
  return {
    getBugs: () => call(),
    setBugs: (update) =>
      call({ method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(update) }),
  };
}

export function demoRoutes(app: FastifyInstance, ctx: AppContext): void {
  const unavailable = () =>
    new ApiError(502, "STORE_ADMIN_UNAVAILABLE", "The demo store is not running or its admin port is unreachable.");

  app.get("/api/demo/store-bugs", async (): Promise<StoreBugsDto> => {
    try {
      return { bugs: await ctx.storeAdmin.getBugs() };
    } catch {
      throw unavailable();
    }
  });

  app.put("/api/demo/store-bugs", async (request): Promise<StoreBugsDto> => {
    const update = parseOrThrow(BugUpdateSchema, request.body);
    try {
      return { bugs: await ctx.storeAdmin.setBugs(update as Partial<BugFlags>) };
    } catch {
      throw unavailable();
    }
  });
}
