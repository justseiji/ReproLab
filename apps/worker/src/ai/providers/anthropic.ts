import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  ModelProviderError,
  type ModelProvider,
  type StructuredRequest,
  type StructuredResponse,
} from "../provider";

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  effort: "low" | "medium" | "high";
  maxOutputTokens: number;
  timeoutMs: number;
  baseUrl?: string;
  /** Server-side refusal fallback (beta): a declined request is retried on Anthropic's recommended model. */
  refusalFallback: boolean;
}

/**
 * Claude adapter. The API key stays in this process; it is never logged,
 * stored, or sent anywhere but the Anthropic API.
 */
export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicOptions) {
    this.model = options.model;
    // The SDK retries 408/409/429/5xx and connection errors twice with backoff.
    this.client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseUrl, maxRetries: 2, timeout: options.timeoutMs });
  }

  async generate<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    let response;
    try {
      response = await this.client.beta.messages.parse(
        {
          model: this.model,
          max_tokens: this.options.maxOutputTokens,
          system: request.system,
          messages: [{ role: "user", content: request.user }],
          output_config: { effort: this.options.effort, format: betaZodOutputFormat(request.schema) },
          ...(this.options.refusalFallback
            ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
            : {}),
        },
        { signal: request.signal },
      );
    } catch (error) {
      throw toProviderError(error);
    }

    if (response.stop_reason === "refusal") {
      throw new ModelProviderError("refused", "The model declined the request.");
    }
    if (response.stop_reason === "max_tokens") {
      throw new ModelProviderError("invalid_output", "The model's output was cut off by the token limit.");
    }
    // Defence in depth: validate again with our own schema.
    const parsed = request.schema.safeParse(response.parsed_output);
    if (!parsed.success) {
      throw new ModelProviderError("invalid_output", `Output failed validation: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    }

    const u = response.usage;
    const cached = (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    return {
      data: parsed.data,
      usage: {
        inputTokens: u.input_tokens + cached,
        outputTokens: u.output_tokens,
        // A flat per-token price is only accurate for uncached input on the configured model.
        priceable: cached === 0 && response.model === this.model,
      },
    };
  }
}

function toProviderError(error: unknown): ModelProviderError {
  if (error instanceof ModelProviderError) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new ModelProviderError("auth", "The AI provider rejected the API key.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ModelProviderError("rate_limited", "The AI provider rate limit was hit (after retries).");
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new ModelProviderError("bad_request", `The AI provider rejected the request: ${error.message.slice(0, 200)}`);
  }
  if (error instanceof Anthropic.APIConnectionError || error instanceof Anthropic.InternalServerError) {
    return new ModelProviderError("unavailable", "The AI provider is unavailable or timed out (after retries).");
  }
  if (error instanceof Anthropic.APIError) {
    return new ModelProviderError("unavailable", `AI provider error ${error.status ?? ""}`.trim());
  }
  if (error instanceof Anthropic.AnthropicError) {
    // Thrown by .parse() when the output is not valid JSON for the schema.
    return new ModelProviderError("invalid_output", error.message.slice(0, 300));
  }
  return new ModelProviderError("unavailable", error instanceof Error ? error.message.slice(0, 200) : String(error));
}
