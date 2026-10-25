import type { ExpectedOutcome, ModelUsageDto, ReportInput } from "@reprolab/shared";
import { InfraError } from "../errors";
import { INTERPRET_SYSTEM, interpretUserMessage, STEP_SYSTEM, stepUserMessage } from "../ai/prompts";
import { estimateCostUsd, ModelProviderError, type ModelProvider, type TokenUsage } from "../ai/provider";
import { InterpretationSchema, StepDecisionSchema } from "../ai/schemas";
import type { Planner, Preparation, StepDecision, StepInput } from "./types";

const MAX_CONSECUTIVE_INVALID = 2;

/**
 * Live AI mode: a model interprets the report into an explicit expected
 * outcome, then picks one validated action per step from the current page's
 * observed elements. It never decides the outcome.
 */
export class LiveAiPlanner implements Planner {
  readonly mode = "LIVE_AI" as const;
  readonly label: string;
  private expected: ExpectedOutcome | null = null;
  private calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private priceable = true;
  private consecutiveInvalid = 0;

  constructor(
    private readonly provider: ModelProvider,
    private readonly report: ReportInput,
    readonly maxActions: number,
    private readonly pricing: { inputUsdPerMTok: number; outputUsdPerMTok: number } | null,
  ) {
    this.label = `Live AI (${provider.name} / ${provider.model})`;
  }

  private track(usage: TokenUsage | null): void {
    this.calls += 1;
    if (!usage) {
      this.priceable = false;
      return;
    }
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    if (!usage.priceable) this.priceable = false;
  }

  async prepare(signal: AbortSignal): Promise<Preparation> {
    let result;
    try {
      result = await this.provider.generate({
        system: INTERPRET_SYSTEM,
        user: interpretUserMessage(this.report),
        schema: InterpretationSchema,
        signal,
      });
    } catch (error) {
      if (error instanceof ModelProviderError && error.kind === "invalid_output") {
        this.calls += 1;
        return {
          kind: "inconclusive",
          reasonCode: "NEEDS_CLARIFICATION",
          summary: "The model could not turn this report into a checkable expected outcome.",
        };
      }
      throw asInfraError(error);
    }
    this.track(result.usage);
    const data = result.data;
    if (data.status === "needs_clarification") {
      return {
        kind: "inconclusive",
        reasonCode: "NEEDS_CLARIFICATION",
        summary: "The expected behavior is not clear enough to check. Clarification needed.",
        clarification: data.question,
      };
    }
    if (data.status === "unsupported") {
      return { kind: "inconclusive", reasonCode: "UNSUPPORTED_REPORT", summary: `Not checkable on the demo store: ${data.reason}` };
    }
    this.expected = data.expectedOutcome;
    return { kind: "ready", expected: data.expectedOutcome, plan: data.plan };
  }

  async next(input: StepInput, signal: AbortSignal): Promise<StepDecision> {
    let result;
    try {
      result = await this.provider.generate({
        system: STEP_SYSTEM,
        user: stepUserMessage({
          report: this.report,
          expected: this.expected!,
          observation: input.observation,
          history: input.history,
          remainingActions: input.remainingActions,
          observedTriggers: [...input.observedTriggers],
        }),
        schema: StepDecisionSchema,
        signal,
      });
    } catch (error) {
      if (error instanceof ModelProviderError && error.kind === "invalid_output") {
        this.calls += 1;
        this.consecutiveInvalid += 1;
        if (this.consecutiveInvalid >= MAX_CONSECUTIVE_INVALID) {
          return { kind: "stop", stopReason: "planner_gave_up", detail: "The model repeatedly produced invalid output." };
        }
        return { kind: "invalid", detail: error.message };
      }
      throw asInfraError(error);
    }
    this.track(result.usage);
    this.consecutiveInvalid = 0;
    const d = result.data;
    if (d.decision === "act") return { kind: "act", action: d.action, rationale: d.rationale };
    if (d.decision === "done") return { kind: "stop", stopReason: "completed", detail: d.rationale };
    return { kind: "stop", stopReason: "planner_gave_up", detail: d.reason };
  }

  usage(): ModelUsageDto {
    const tokensKnown = this.calls > 0 && (this.inputTokens > 0 || this.outputTokens > 0);
    return {
      provider: this.provider.name,
      model: this.provider.model,
      calls: this.calls,
      inputTokens: tokensKnown ? this.inputTokens : null,
      outputTokens: tokensKnown ? this.outputTokens : null,
      estimatedCostUsd:
        tokensKnown && this.priceable && this.pricing
          ? estimateCostUsd({ inputTokens: this.inputTokens, outputTokens: this.outputTokens }, this.pricing)
          : null,
    };
  }
}

/** Model API problems are infrastructure failures, not evidence about the bug. */
function asInfraError(error: unknown): unknown {
  if (!(error instanceof ModelProviderError)) return error;
  // Not retried at job level: the SDK already retried, and a re-run would spend tokens again.
  return new InfraError("AI_PROVIDER_ERROR", error.message, false);
}
