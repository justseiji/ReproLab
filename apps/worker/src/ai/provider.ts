import type { z } from "zod";

/**
 * The small adapter boundary between the planner and a model API. The
 * planner only ever asks for one structured JSON object that must match a
 * Zod schema; the adapter returns the validated object plus real token usage.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** False when the price list cannot be applied (e.g. cached tokens, or a fallback model served the call). */
  priceable: boolean;
}

export interface StructuredRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  signal: AbortSignal;
}

export interface StructuredResponse<T> {
  data: T;
  usage: TokenUsage | null;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  generate<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}

export type ModelErrorKind = "invalid_output" | "refused" | "auth" | "rate_limited" | "unavailable" | "bad_request";

export class ModelProviderError extends Error {
  constructor(
    readonly kind: ModelErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ModelProviderError";
  }
}

export function estimateCostUsd(
  usage: { inputTokens: number; outputTokens: number },
  pricing: { inputUsdPerMTok: number; outputUsdPerMTok: number },
): number {
  return (usage.inputTokens * pricing.inputUsdPerMTok + usage.outputTokens * pricing.outputUsdPerMTok) / 1_000_000;
}
