import { postJson, type FetchFn } from "../http";
import { parseStructuredText, providerJsonSchema } from "../json-schema";
import { ModelProviderError, type ModelProvider, type StructuredRequest, type StructuredResponse } from "../provider";

export interface GeminiOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxOutputTokens: number;
  timeoutMs: number;
  fetch?: FetchFn;
}

interface GenerateContentResult {
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

const BLOCKED = new Set(["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "RECITATION"]);

/** Google Gemini adapter using generateContent with a JSON response schema. */
export class GeminiProvider implements ModelProvider {
  readonly name = "gemini";
  readonly model: string;

  constructor(private readonly options: GeminiOptions) {
    this.model = options.model;
  }

  async generate<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const res = await postJson<GenerateContentResult>(
      `${this.options.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          // Gemini does not enforce regex patterns; Zod re-checks them.
          responseJsonSchema: providerJsonSchema(request.schema, { stripPattern: true }),
          maxOutputTokens: this.options.maxOutputTokens,
        },
      },
      {
        headers: { "x-goog-api-key": this.options.apiKey },
        timeoutMs: this.options.timeoutMs,
        signal: request.signal,
        fetch: this.options.fetch,
        label: "Gemini",
      },
    );

    if (res.promptFeedback?.blockReason) throw new ModelProviderError("refused", "The model declined the request.");
    const candidate = res.candidates?.[0];
    if (!candidate) throw new ModelProviderError("invalid_output", "Gemini returned no candidates.");
    if (candidate.finishReason && BLOCKED.has(candidate.finishReason)) {
      throw new ModelProviderError("refused", "The model declined the request.");
    }
    if (candidate.finishReason === "MAX_TOKENS") {
      throw new ModelProviderError("invalid_output", "The model's output was cut off by the token limit.");
    }
    const text = (candidate.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");

    const u = res.usageMetadata;
    const usage =
      u?.promptTokenCount !== undefined
        ? {
            inputTokens: u.promptTokenCount,
            // Thinking tokens are billed as output.
            outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
            priceable: (u.cachedContentTokenCount ?? 0) === 0,
          }
        : null;
    return parseStructuredText(text, request.schema, usage);
  }
}
