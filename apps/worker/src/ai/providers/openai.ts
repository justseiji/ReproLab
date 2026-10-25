import { postJson, type FetchFn } from "../http";
import { parseStructuredText, providerJsonSchema } from "../json-schema";
import { ModelProviderError, type ModelProvider, type StructuredRequest, type StructuredResponse } from "../provider";

export interface OpenAiOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxOutputTokens: number;
  timeoutMs: number;
  fetch?: FetchFn;
}

interface ResponsesApiResult {
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string; refusal?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
}

/** OpenAI adapter using the Responses API with strict JSON-schema output. */
export class OpenAiProvider implements ModelProvider {
  readonly name = "openai";
  readonly model: string;

  constructor(private readonly options: OpenAiOptions) {
    this.model = options.model;
  }

  async generate<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const res = await postJson<ResponsesApiResult>(
      `${this.options.baseUrl}/responses`,
      {
        model: this.model,
        instructions: request.system,
        input: request.user,
        max_output_tokens: this.options.maxOutputTokens,
        // Do not keep run content on OpenAI's side.
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "reprolab_output",
            strict: true,
            schema: providerJsonSchema(request.schema, { stripPattern: false }),
          },
        },
      },
      {
        headers: { authorization: `Bearer ${this.options.apiKey}` },
        timeoutMs: this.options.timeoutMs,
        signal: request.signal,
        fetch: this.options.fetch,
        label: "OpenAI",
      },
    );

    if (res.status === "incomplete") {
      const reason = res.incomplete_details?.reason;
      if (reason === "content_filter") throw new ModelProviderError("refused", "The model declined the request.");
      throw new ModelProviderError("invalid_output", `The model's output was incomplete (${reason ?? "unknown reason"}).`);
    }
    const parts = (res.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []);
    if (parts.some((p) => p.type === "refusal")) throw new ModelProviderError("refused", "The model declined the request.");
    const text = parts.filter((p) => p.type === "output_text").map((p) => p.text ?? "").join("");

    const cached = res.usage?.input_tokens_details?.cached_tokens ?? 0;
    const usage =
      res.usage?.input_tokens !== undefined && res.usage.output_tokens !== undefined
        ? {
            inputTokens: res.usage.input_tokens,
            outputTokens: res.usage.output_tokens,
            // Flat prices apply only to uncached input on the configured model (or a dated snapshot of it).
            priceable: cached === 0 && (res.model ?? this.model).startsWith(this.model),
          }
        : null;
    return parseStructuredText(text, request.schema, usage);
  }
}
