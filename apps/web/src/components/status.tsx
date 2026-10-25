import { RUN_MODE_LABELS, RUN_OUTCOME_LABELS, type RunMode, type RunOutcome, type RunSummaryDto } from "@reprolab/shared";
import { Icon, type IconName } from "./Icon";

export type Tone = "bad" | "ok" | "warn" | "neutral" | "accent";

export interface StateMeta {
  tone: Tone;
  icon: IconName;
  label: string;
}

/** One visual identity per outcome, shared by labels, the verdict and tables. */
export const OUTCOME_META: Record<RunOutcome, StateMeta> = {
  REPRODUCED: { tone: "bad", icon: "alert-circle", label: RUN_OUTCOME_LABELS.REPRODUCED },
  NOT_REPRODUCED: { tone: "ok", icon: "check-circle", label: RUN_OUTCOME_LABELS.NOT_REPRODUCED },
  INCONCLUSIVE: { tone: "warn", icon: "help-circle", label: RUN_OUTCOME_LABELS.INCONCLUSIVE },
  EXECUTION_FAILED: { tone: "neutral", icon: "slash-circle", label: RUN_OUTCOME_LABELS.EXECUTION_FAILED },
};

export function runStateMeta(run: Pick<RunSummaryDto, "status" | "outcome">): StateMeta {
  if (run.status === "COMPLETED" && run.outcome) return OUTCOME_META[run.outcome];
  return run.status === "QUEUED"
    ? { tone: "accent", icon: "clock", label: "Queued" }
    : { tone: "accent", icon: "spinner", label: "Running" };
}

/** Outcome when finished, otherwise the live status. Icon + text, never color alone. */
export function RunStatus({ run, plain = false }: { run: Pick<RunSummaryDto, "status" | "outcome">; plain?: boolean }) {
  const meta = runStateMeta(run);
  return (
    <span className={`status tone-${meta.tone}${plain ? " status--plain" : ""}`}>
      <Icon name={meta.icon} size={14} spin={meta.icon === "spinner"} />
      {meta.label}
    </span>
  );
}

/** Run mode as quiet text; the model name is shown in monospace when known. */
export function ModeLabel({ mode, model }: { mode: RunMode; model?: string | null }) {
  return (
    <span className="mode-label">
      {RUN_MODE_LABELS[mode]}
      {mode === "LIVE_AI" && model ? <span className="mono muted"> · {model}</span> : null}
    </span>
  );
}
