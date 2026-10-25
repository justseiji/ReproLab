import { z } from "zod";
import { ModelProviderError, type TokenUsage, type StructuredResponse } from "./provider";

/**
 * Converts a Zod schema to the JSON Schema subset that model APIs accept.
 *
 * Providers differ (OpenAI forbids a non-object root, Gemini ignores length
 * limits, local models handle fewer keywords), so every provider gets the same
 * conservative shape:
 * - the output is wrapped as { "result": ... } so the root is always an object;
 * - oneOf becomes anyOf and const becomes a one-value enum;
 * - numeric, length and size limits are removed (and optionally `pattern`).
 * Nothing is lost: every reply is validated with the original Zod schema.
 */
export const ENVELOPE_KEY = "result";

const ALWAYS_STRIP = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "default",
]);

function simplify(node: unknown, stripPattern: boolean): unknown {
  if (Array.isArray(node)) return node.map((n) => simplify(n, stripPattern));
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (ALWAYS_STRIP.has(key) || (stripPattern && key === "pattern")) continue;
    if (key === "oneOf") out.anyOf = simplify(value, stripPattern);
    else if (key === "const") out.enum = [value];
    else out[key] = simplify(value, stripPattern);
  }
  return out;
}

export function providerJsonSchema(schema: z.ZodType, options: { stripPattern: boolean }): Record<string, unknown> {
  const inner = simplify(z.toJSONSchema(schema, { io: "output" }), options.stripPattern);
  return {
    type: "object",
    properties: { [ENVELOPE_KEY]: inner },
    required: [ENVELOPE_KEY],
    additionalProperties: false,
  };
}

/** Parses model text into the schema's type, accepting either the envelope or a bare object. */
export function parseStructuredText<T>(text: string, schema: z.ZodType<T>, usage: TokenUsage | null): StructuredResponse<T> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    throw new ModelProviderError("invalid_output", "The model did not return valid JSON.");
  }
  const enveloped =
    json && typeof json === "object" && ENVELOPE_KEY in json ? (json as Record<string, unknown>)[ENVELOPE_KEY] : undefined;
  const parsed = schema.safeParse(enveloped !== undefined ? enveloped : json);
  if (!parsed.success) {
    throw new ModelProviderError("invalid_output", `Output failed validation: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  return { data: parsed.data, usage };
}
