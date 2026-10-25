import { postJson, type FetchFn } from "../http";
import { parseStructuredText, providerJsonSchema } from "../json-schema";
import { ModelProviderError, type ModelProvider, type StructuredRequest, type StructuredResponse } from "../provider";

export interface OllamaOptions {
  model: string;
  baseUrl: string;
  maxOutputTokens: number;
  timeoutMs: number;
  fetch?: FetchFn;
}

interface ChatResult {
  message?: { content?: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Local models through Ollama's /api/chat with a JSON schema in `format`.
 * Free to run, no key, nothing leaves the machine. Smaller models plan less
 * reliably; invalid replies are rejected by validation like any other.
 */
export class OllamaProvider implements ModelProvider {
  readonly name = "ollama";
  readonly model: string;

  constructor(private readonly options: OllamaOptions) {
    this.model = options.model;
  }

  async generate<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    let res: ChatResult;
    try {
      res = await postJson<ChatResult>(
        `${this.options.baseUrl}/api/chat`,
        {
          model: this.model,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
          stream: false,
          format: providerJsonSchema(request.schema, { stripPattern: true }),
          options: { temperature: 0, num_predict: this.options.maxOutputTokens },
        },
        { timeoutMs: this.options.timeoutMs, signal: request.signal, fetch: this.options.fetch, label: "Ollama", retries: 1 },
      );
    } catch (error) {
      if (error instanceof ModelProviderError && error.kind === "bad_request" && /not found/i.test(error.message)) {
        throw new ModelProviderError("bad_request", `Ollama has no model "${this.model}". Run: ollama pull ${this.model}`);
      }
      throw error;
    }
    if (res.done_reason === "length") {
      throw new ModelProviderError("invalid_output", "The model's output was cut off by the token limit.");
    }
    const usage =
      res.prompt_eval_count !== undefined && res.eval_count !== undefined
        ? { inputTokens: res.prompt_eval_count, outputTokens: res.eval_count, priceable: true }
        : null;
    return parseStructuredText(res.message?.content ?? "", request.schema, usage);
  }
}
