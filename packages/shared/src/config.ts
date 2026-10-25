import { z } from "zod";
import { AI_PROVIDER_IDS, AI_PROVIDERS, type AiProviderId } from "./ai-providers";
import { fromRepoRoot, loadRootEnv } from "./node";

/**
 * Environment configuration shared by the API and the worker, validated once
 * at startup so a typo fails fast with a readable message.
 */

// Treat empty strings from .env ("ANTHROPIC_API_KEY=") as unset.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" || v === undefined ? undefined : v), schema.optional());
const int = (def: number, min: number, max: number) =>
  z.preprocess((v) => (v === "" || v === undefined ? def : v), z.coerce.number().int().min(min).max(max));
const bool = (def: boolean) =>
  z.preprocess((v) => (v === "" || v === undefined ? def : v === true || v === "true" || v === "1"), z.boolean());

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  STORE_URL: z.url().default("http://localhost:4100"),
  STORE_ADMIN_URL: z.url().default("http://127.0.0.1:4101"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: int(4000, 1, 65535),
  ARTIFACT_DIR: z.string().default(".data/artifacts"),
  WORKER_CONCURRENCY: int(2, 1, 8),
  WORKER_POLL_INTERVAL_MS: int(1000, 100, 60_000),
  JOB_LEASE_MS: int(30_000, 5_000, 600_000),
  JOB_MAX_ATTEMPTS: int(3, 1, 10),
  RUN_TIMEOUT_MS: int(120_000, 10_000, 900_000),
  ACTION_TIMEOUT_MS: int(5_000, 1_000, 60_000),
  MAX_ACTIONS_LIVE: int(15, 1, 40),
  HEADLESS: bool(true),
  AI_PROVIDER: z.preprocess((v) => (v === "" ? undefined : v), z.enum(AI_PROVIDER_IDS).default("anthropic")),
  // Empty means "use the provider's default model" (see ai-providers.ts).
  AI_MODEL: optional(z.string()),
  AI_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  AI_REQUEST_TIMEOUT_MS: int(60_000, 5_000, 600_000),
  AI_MAX_OUTPUT_TOKENS: int(4_000, 256, 32_000),
  AI_REFUSAL_FALLBACK: bool(true),
  AI_PRICE_INPUT_USD_PER_MTOK: optional(z.coerce.number().nonnegative()),
  AI_PRICE_OUTPUT_USD_PER_MTOK: optional(z.coerce.number().nonnegative()),
});

export interface AppConfig {
  databaseUrl: string;
  storeUrl: string;
  storeOrigin: string;
  storeAdminUrl: string;
  api: { host: string; port: number };
  artifactDir: string;
  worker: { concurrency: number; pollIntervalMs: number; leaseMs: number };
  jobMaxAttempts: number;
  run: { timeoutMs: number; actionTimeoutMs: number; maxActionsLive: number; maxActionsScripted: number; headless: boolean };
  ai: {
    provider: AiProviderId;
    /** Key for the selected provider only; never sent anywhere but that provider. */
    apiKey: string | undefined;
    baseUrl: string;
    model: string;
    effort: "low" | "medium" | "high";
    requestTimeoutMs: number;
    maxOutputTokens: number;
    refusalFallback: boolean;
    pricing: { inputUsdPerMTok: number; outputUsdPerMTok: number } | null;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) loadRootEnv();
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const e = parsed.data;
  // Only the selected provider's key and base URL are read; the names come from ai-providers.ts.
  const provider = AI_PROVIDERS[e.AI_PROVIDER];
  const apiKey = provider.apiKeyEnv ? env[provider.apiKeyEnv]?.trim() || undefined : undefined;
  const baseUrl = (env[provider.baseUrlEnv]?.trim() || provider.defaultBaseUrl).replace(/\/+$/, "");
  if (!URL.canParse(baseUrl)) throw new Error(`Invalid configuration: ${provider.baseUrlEnv} must be a URL.`);
  const pricing =
    e.AI_PRICE_INPUT_USD_PER_MTOK !== undefined && e.AI_PRICE_OUTPUT_USD_PER_MTOK !== undefined
      ? { inputUsdPerMTok: e.AI_PRICE_INPUT_USD_PER_MTOK, outputUsdPerMTok: e.AI_PRICE_OUTPUT_USD_PER_MTOK }
      : null;
  return {
    databaseUrl: e.DATABASE_URL,
    storeUrl: e.STORE_URL,
    storeOrigin: new URL(e.STORE_URL).origin,
    storeAdminUrl: e.STORE_ADMIN_URL,
    api: { host: e.API_HOST, port: e.API_PORT },
    artifactDir: fromRepoRoot(e.ARTIFACT_DIR),
    worker: { concurrency: e.WORKER_CONCURRENCY, pollIntervalMs: e.WORKER_POLL_INTERVAL_MS, leaseMs: e.JOB_LEASE_MS },
    jobMaxAttempts: e.JOB_MAX_ATTEMPTS,
    run: {
      timeoutMs: e.RUN_TIMEOUT_MS,
      actionTimeoutMs: e.ACTION_TIMEOUT_MS,
      maxActionsLive: e.MAX_ACTIONS_LIVE,
      maxActionsScripted: 15,
      headless: e.HEADLESS,
    },
    ai: {
      provider: e.AI_PROVIDER,
      apiKey,
      baseUrl,
      model: e.AI_MODEL ?? provider.defaultModel,
      effort: e.AI_EFFORT,
      requestTimeoutMs: e.AI_REQUEST_TIMEOUT_MS,
      maxOutputTokens: e.AI_MAX_OUTPUT_TOKENS,
      refusalFallback: e.AI_REFUSAL_FALLBACK,
      pricing,
    },
  };
}

/** Whether live AI mode can run, and why not if it can't. */
export function liveAiStatus(config: AppConfig): { available: boolean; reason: string | null } {
  const info = AI_PROVIDERS[config.ai.provider];
  if (info.apiKeyEnv && !config.ai.apiKey) {
    return { available: false, reason: `Set ${info.apiKeyEnv} in .env to enable live AI mode with ${info.label}.` };
  }
  // Local providers need no key; whether the server is running is only known when a run starts.
  return { available: true, reason: null };
}
