import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ALL_BUGS_ENABLED,
  BUG_KEYS,
  computeExpectedCart,
  MAX_QUANTITY,
  MIN_QUANTITY,
  PRODUCTS,
  type BugFlags,
} from "@reprolab/shared";

/**
 * The demo store is two Fastify servers sharing one in-memory bug state:
 *
 * - public (storefront + store API): the only origin the browser agent may reach.
 * - admin (demo-only bug switches): bound to 127.0.0.1 on a separate port. The
 *   agent's network allowlist never includes it, so the agent cannot flip bugs.
 */
export interface StoreServers {
  publicApp: FastifyInstance;
  adminApp: FastifyInstance;
  getBugs(): BugFlags;
  setBugs(update: Partial<BugFlags>): BugFlags;
}

export interface StoreOptions {
  distDir: string;
  bugs?: BugFlags;
  logger?: boolean;
}

const OrderSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  email: z.email().max(200),
  lines: z
    .array(
      z.strictObject({
        productId: z.enum(PRODUCTS.map((p) => p.id) as [string, ...string[]]),
        quantity: z.number().int().min(MIN_QUANTITY).max(MAX_QUANTITY),
      }),
    )
    .min(1)
    .max(20),
  couponCode: z.string().max(40).nullable(),
});

const BugUpdateSchema = z.strictObject(
  Object.fromEntries(BUG_KEYS.map((key) => [key, z.boolean().optional()])) as Record<
    (typeof BUG_KEYS)[number],
    z.ZodOptional<z.ZodBoolean>
  >,
);

export async function createStoreServers(options: StoreOptions): Promise<StoreServers> {
  let bugs: BugFlags = { ...(options.bugs ?? ALL_BUGS_ENABLED) };
  const getBugs = () => ({ ...bugs });
  const setBugs = (update: Partial<BugFlags>) => {
    bugs = { ...bugs, ...update };
    return getBugs();
  };

  // --- Public storefront -------------------------------------------------
  const publicApp = Fastify({ logger: options.logger ?? false });

  publicApp.addHook("onSend", async (request, reply) => {
    if (request.url.startsWith("/api/")) reply.header("cache-control", "no-store");
  });

  publicApp.get("/api/health", async () => ({ ok: true }));
  publicApp.get("/api/config", async () => ({ bugs: getBugs() }));
  publicApp.get("/api/products", async () => ({ products: PRODUCTS }));
  publicApp.post("/api/orders", async (request, reply) => {
    const parsed = OrderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid order." } });
    }
    // The server prices orders from the specification, independent of the client cart.
    const priced = computeExpectedCart(parsed.data.lines, parsed.data.couponCode);
    return { orderId: `HP-${randomUUID().slice(0, 6).toUpperCase()}`, totalCents: priced.totalCents };
  });

  if (!existsSync(path.join(options.distDir, "index.html"))) {
    throw new Error(`Store bundle not found in ${options.distDir}. Run "npm run build -w @reprolab/store" first.`);
  }
  await publicApp.register(fastifyStatic, { root: options.distDir });
  publicApp.setNotFoundHandler((request, reply) => {
    // Client-side routes (/cart, /checkout, ...) are served by the SPA shell.
    if (request.method === "GET" && !request.url.startsWith("/api/")) {
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    }
    return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Not found." } });
  });

  // --- Admin (demo-only bug switches) ------------------------------------
  const adminApp = Fastify({ logger: options.logger ?? false });
  adminApp.get("/admin/health", async () => ({ ok: true }));
  adminApp.get("/admin/bugs", async () => ({ bugs: getBugs() }));
  adminApp.put("/admin/bugs", async (request, reply) => {
    const parsed = BugUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Body must map bug keys to booleans." } });
    }
    const update = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as Partial<BugFlags>;
    return { bugs: setBugs(update) };
  });

  return { publicApp, adminApp, getBugs, setBugs };
}

/** "all" (default), "none", or a comma-separated list of enabled bug keys. */
export function parseBugSetting(value: string | undefined): BugFlags {
  if (!value || value === "all") return { ...ALL_BUGS_ENABLED };
  const enabled = new Set(value === "none" ? [] : value.split(",").map((s) => s.trim()));
  return Object.fromEntries(BUG_KEYS.map((key) => [key, enabled.has(key)])) as BugFlags;
}
