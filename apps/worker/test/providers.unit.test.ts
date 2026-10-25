import { describe, expect, it } from "vitest";
import { loadConfig, liveAiStatus } from "@reprolab/shared/node";
import { retryDelayFromResponse, type FetchFn } from "../src/ai/http";
import { parseStructuredText, providerJsonSchema } from "../src/ai/json-schema";
import { ModelProviderError } from "../src/ai/provider";
import { GeminiProvider } from "../src/ai/providers/gemini";
import { OllamaProvider } from "../src/ai/providers/ollama";
import { OpenAiProvider } from "../src/ai/providers/openai";
import { createModelProvider } from "../src/ai/registry";
import { StepDecisionSchema } from "../src/ai/schemas";

const decision = { decision: "act", action: { type: "navigate", route: "/cart" }, rationale: "open the cart" };
const request = () => ({ system: "SYSTEM", user: "USER", schema: StepDecisionSchema, signal: new AbortController().signal });
const base = { model: "test-model", baseUrl: "https://api.example.test/v1", maxOutputTokens: 1000, timeoutMs: 5000 };

/** A fake fetch that replays responses in order and records every request. */
function fakeFetch(...responses: Array<{ status?: number; body: unknown } | Error>) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const fn: FetchFn = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return new Response(typeof next.body === "string" ? next.body : JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  return { fn, calls };
}

function walk(node: any, visit: (n: any) => void) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (node && typeof node === "object") {
    visit(node);
    Object.values(node).forEach((v) => walk(v, visit));
  }
}

describe("retry delays requested by the server", () => {
  it("reads Retry-After or Google's retryDelay, capped at 30 seconds", () => {
    expect(retryDelayFromResponse(new Response("", { headers: { "retry-after": "3" } }), "")).toBe(3000);
    expect(retryDelayFromResponse(new Response(""), '{"error":{"details":[{"retryDelay": "17s"}]}}')).toBe(17000);
    expect(retryDelayFromResponse(new Response(""), '{"retryDelay":"300s"}')).toBe(30000);
    expect(retryDelayFromResponse(new Response(""), "{}")).toBeNull();
  });
});

describe("provider JSON schema", () => {
  const schema = providerJsonSchema(StepDecisionSchema, { stripPattern: true });

  it("always has an object root wrapping the real schema", () => {
    expect(schema).toMatchObject({ type: "object", required: ["result"], additionalProperties: false });
  });

  it("meets strict-mode rules: no oneOf/const/length limits, every object closed with all keys required", () => {
    walk(schema, (n) => {
      for (const banned of ["oneOf", "const", "minLength", "maxLength", "pattern", "$schema"]) expect(n).not.toHaveProperty(banned);
      if (n.type === "object" && n.properties) {
        expect(n.additionalProperties).toBe(false);
        expect([...n.required].sort()).toEqual(Object.keys(n.properties).sort());
      }
    });
  });

  it("keeps regex patterns when the provider supports them", () => {
    expect(JSON.stringify(providerJsonSchema(StepDecisionSchema, { stripPattern: false }))).toContain("pattern");
  });
});

describe("parsing structured text", () => {
  it("accepts the envelope, a bare object, or fenced JSON", () => {
    for (const text of [JSON.stringify({ result: decision }), JSON.stringify(decision), "```json\n" + JSON.stringify({ result: decision }) + "\n```"]) {
      expect(parseStructuredText(text, StepDecisionSchema, null).data).toEqual(decision);
    }
  });

  it("rejects non-JSON and out-of-vocabulary output", () => {
    expect(() => parseStructuredText("Sure! I'll click it.", StepDecisionSchema, null)).toThrow(ModelProviderError);
    const hostile = { result: { decision: "act", action: { type: "evaluate", script: "x" }, rationale: "" } };
    expect(() => parseStructuredText(JSON.stringify(hostile), StepDecisionSchema, null)).toThrow(/validation/);
  });
});

describe("OpenAI adapter", () => {
  const reply = (over: object = {}) => ({
    body: {
      model: "test-model-2026-01-01",
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ result: decision }) }] }],
      usage: { input_tokens: 120, output_tokens: 30 },
      ...over,
    },
  });

  it("sends a strict JSON-schema request to the Responses API and parses the reply", async () => {
    const { fn, calls } = fakeFetch(reply());
    const res = await new OpenAiProvider({ ...base, apiKey: "sk-test", fetch: fn }).generate(request());
    expect(res.data).toEqual(decision);
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 30, priceable: true });
    expect(calls[0]!.url).toBe("https://api.example.test/v1/responses");
    expect(calls[0]!.headers.authorization).toBe("Bearer sk-test");
    expect(calls[0]!.body).toMatchObject({ model: "test-model", instructions: "SYSTEM", input: "USER", store: false });
    expect(calls[0]!.body.text.format).toMatchObject({ type: "json_schema", strict: true });
  });

  it("maps refusals, truncation and auth errors", async () => {
    const refusal = reply({ output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] });
    await expect(new OpenAiProvider({ ...base, apiKey: "k", fetch: fakeFetch(refusal).fn }).generate(request())).rejects.toMatchObject({ kind: "refused" });
    const cut = reply({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
    await expect(new OpenAiProvider({ ...base, apiKey: "k", fetch: fakeFetch(cut).fn }).generate(request())).rejects.toMatchObject({ kind: "invalid_output" });
    const denied = fakeFetch({ status: 401, body: { error: { message: "bad key" } } });
    await expect(new OpenAiProvider({ ...base, apiKey: "k", fetch: denied.fn }).generate(request())).rejects.toMatchObject({ kind: "auth" });
    expect(denied.calls).toHaveLength(1); // auth errors are not retried
  });

  it("retries rate limits and server errors, then succeeds", async () => {
    const { fn, calls } = fakeFetch({ status: 429, body: {} }, reply());
    const res = await new OpenAiProvider({ ...base, apiKey: "k", fetch: fn }).generate(request());
    expect(res.data).toEqual(decision);
    expect(calls).toHaveLength(2);
  });

  it("does not leak the API key into error messages", async () => {
    const { fn } = fakeFetch({ status: 400, body: "invalid schema" });
    const error = await new OpenAiProvider({ ...base, apiKey: "sk-secret-123", fetch: fn }).generate(request()).catch((e) => e);
    expect(error.kind).toBe("bad_request");
    expect(String(error.message)).not.toContain("sk-secret-123");
  });
});

describe("Gemini adapter", () => {
  const reply = (over: object = {}) => ({
    body: {
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: "thinking...", thought: true }, { text: JSON.stringify({ result: decision }) }] },
        },
      ],
      usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40, thoughtsTokenCount: 10 },
      ...over,
    },
  });

  it("calls generateContent with a JSON response schema and ignores thought parts", async () => {
    const { fn, calls } = fakeFetch(reply());
    const res = await new GeminiProvider({ ...base, model: "gemini-test", apiKey: "g-key", fetch: fn }).generate(request());
    expect(res.data).toEqual(decision);
    expect(res.usage).toEqual({ inputTokens: 200, outputTokens: 50, priceable: true });
    expect(calls[0]!.url).toBe("https://api.example.test/v1/models/gemini-test:generateContent");
    expect(calls[0]!.headers["x-goog-api-key"]).toBe("g-key");
    expect(calls[0]!.body.generationConfig).toMatchObject({ responseMimeType: "application/json", maxOutputTokens: 1000 });
    expect(calls[0]!.body.systemInstruction.parts[0].text).toBe("SYSTEM");
  });

  it("maps safety blocks and token limits", async () => {
    const blocked = reply({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] });
    await expect(new GeminiProvider({ ...base, apiKey: "k", fetch: fakeFetch(blocked).fn }).generate(request())).rejects.toMatchObject({ kind: "refused" });
    const cut = reply({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] });
    await expect(new GeminiProvider({ ...base, apiKey: "k", fetch: fakeFetch(cut).fn }).generate(request())).rejects.toMatchObject({ kind: "invalid_output" });
  });
});

describe("Ollama adapter", () => {
  it("sends the schema in `format` with no API key and reads local token counts", async () => {
    const { fn, calls } = fakeFetch({
      body: { message: { content: JSON.stringify({ result: decision }) }, done_reason: "stop", prompt_eval_count: 300, eval_count: 25 },
    });
    const res = await new OllamaProvider({ ...base, baseUrl: "http://127.0.0.1:11434", fetch: fn }).generate(request());
    expect(res.data).toEqual(decision);
    expect(res.usage).toMatchObject({ inputTokens: 300, outputTokens: 25 });
    expect(calls[0]!.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(calls[0]!.headers.authorization).toBeUndefined();
    expect(calls[0]!.body).toMatchObject({ stream: false, format: { type: "object" }, options: { temperature: 0 } });
  });

  it("explains a missing model and an unreachable server", async () => {
    const missing = fakeFetch({ status: 404, body: { error: "model 'test-model' not found" } });
    await expect(new OllamaProvider({ ...base, fetch: missing.fn }).generate(request())).rejects.toThrow(/ollama pull test-model/);
    const down = fakeFetch(new TypeError("fetch failed"), new TypeError("fetch failed"));
    await expect(new OllamaProvider({ ...base, fetch: down.fn }).generate(request())).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("provider selection", () => {
  const config = (env: Record<string, string>) =>
    loadConfig({ DATABASE_URL: "postgresql://x/y", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", ...env });

  it("uses each provider's default model unless AI_MODEL is set", () => {
    expect(config({ AI_PROVIDER: "openai" }).ai.model).toBe("gpt-6-astra");
    expect(config({ AI_PROVIDER: "gemini", AI_MODEL: "gemini-custom" }).ai.model).toBe("gemini-custom");
    expect(config({}).ai.provider).toBe("anthropic");
  });

  it("only reads the selected provider's key, and needs none for Ollama", () => {
    const openai = config({ AI_PROVIDER: "openai", ANTHROPIC_API_KEY: "anthropic-key" });
    expect(openai.ai.apiKey).toBeUndefined();
    expect(liveAiStatus(openai)).toEqual({ available: false, reason: expect.stringContaining("OPENAI_API_KEY") });
    expect(createModelProvider(openai)).toBeNull();

    const ollama = config({ AI_PROVIDER: "ollama" });
    expect(liveAiStatus(ollama).available).toBe(true);
    expect(createModelProvider(ollama)).toMatchObject({ name: "ollama", model: "gpt-oss" });
    expect(ollama.ai.baseUrl).toBe("http://127.0.0.1:11434");
  });

  it("builds the right adapter for each provider", () => {
    expect(createModelProvider(config({ AI_PROVIDER: "openai", OPENAI_API_KEY: "k" }))?.name).toBe("openai");
    expect(createModelProvider(config({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "k" }))?.name).toBe("gemini");
    expect(createModelProvider(config({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" }))?.name).toBe("anthropic");
  });

  it("rejects an unknown provider", () => {
    expect(() => config({ AI_PROVIDER: "mystery" })).toThrow(/AI_PROVIDER/);
  });
});
