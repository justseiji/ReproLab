import type {
  BrowserAction,
  ExpectedOutcome,
  ModelUsageDto,
  PageObservation,
  ReasonCode,
  RunMode,
  StopReason,
  TriggerEvent,
} from "@reprolab/shared";

/**
 * A planner decides *what* to do next; the engine decides whether it is
 * allowed and does it. Scripted recipes and the live AI model implement the
 * same interface, so they share execution, evidence capture and evaluation.
 */

export type Preparation =
  | { kind: "ready"; expected: ExpectedOutcome; plan: string[] }
  | {
      kind: "inconclusive";
      reasonCode: Extract<ReasonCode, "NEEDS_CLARIFICATION" | "UNSUPPORTED_REPORT" | "SCRIPTED_RECIPE_UNAVAILABLE">;
      summary: string;
      clarification?: string;
    };

export interface HistoryEntry {
  index: number;
  description: string;
  status: "succeeded" | "failed" | "rejected";
  error: string | null;
  pagePath: string;
  triggers: TriggerEvent[];
}

export interface StepInput {
  observation: PageObservation;
  history: readonly HistoryEntry[];
  remainingActions: number;
  observedTriggers: ReadonlySet<TriggerEvent>;
}

export type StepDecision =
  | { kind: "act"; action: BrowserAction; rationale: string | null }
  /** The planner produced output that failed validation; recorded and counted against the budget. */
  | { kind: "invalid"; detail: string }
  | { kind: "stop"; stopReason: StopReason; detail: string };

export interface Planner {
  readonly mode: RunMode;
  readonly label: string;
  readonly maxActions: number;
  prepare(signal: AbortSignal): Promise<Preparation>;
  next(input: StepInput, signal: AbortSignal): Promise<StepDecision>;
  /** Real token usage reported by the provider, or null for scripted runs. */
  usage(): ModelUsageDto | null;
}
