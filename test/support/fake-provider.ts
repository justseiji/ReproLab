import {
  ModelProviderError,
  type ModelProvider,
  type StructuredRequest,
  type StructuredResponse,
  type TokenUsage,
} from "../../apps/worker/src/ai/provider";

export type ScriptEntry = unknown | Error | ((request: StructuredRequest<unknown>) => unknown);

/**
 * A scripted stand-in for the model API, used only in tests. Like the real
 * adapter it validates every reply against the request's Zod schema, so
 * malformed or out-of-vocabulary output is rejected the same way.
 */
export class FakeProvider implements ModelProvider {
  readonly name = "fake";
  readonly model = "fake-model";
  readonly requests: Array<{ system: string; user: string }> = [];

  constructor(
    private readonly script: ScriptEntry[],
    private readonly usage: TokenUsage | null = { inputTokens: 1000, outputTokens: 100, priceable: true },
  ) {}

  async generate<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    this.requests.push({ system: request.system, user: request.user });
    if (this.script.length === 0) throw new Error("FakeProvider script exhausted");
    const entry = this.script.shift();
    if (entry instanceof Error) throw entry;
    const raw = typeof entry === "function" ? await (entry as (r: StructuredRequest<unknown>) => unknown)(request) : entry;
    const parsed = request.schema.safeParse(raw);
    if (!parsed.success) throw new ModelProviderError("invalid_output", "Output failed validation");
    return { data: parsed.data, usage: this.usage };
  }
}

/** Finds the observation element id for a test id in the planner's prompt, as a model would. */
export function elementIdFor(userMessage: string, testId: string): string {
  const match = new RegExp(`^(e\\d+) [^\\n]*testid=${testId}(\\s|$)`, "m").exec(userMessage);
  if (!match) throw new Error(`No element with testid=${testId} in the observation`);
  return match[1]!;
}
