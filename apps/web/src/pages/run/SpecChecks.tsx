import { CHECK_DESCRIPTIONS, TRIGGER_DESCRIPTIONS, type CheckResult, type RunDetailDto } from "@reprolab/shared";
import { Icon, type IconName } from "../../components/Icon";
import { Section } from "../../components/Section";
import type { Tone } from "../../components/status";

const CHECK_STATE: Record<CheckResult["status"] | "pending", { tone: Tone; icon: IconName; label: string }> = {
  pass: { tone: "ok", icon: "check", label: "Pass" },
  fail: { tone: "bad", icon: "x", label: "Fail" },
  not_evaluable: { tone: "warn", icon: "help-circle", label: "Not evaluable" },
  pending: { tone: "neutral", icon: "dash", label: "Pending" },
};

/** The oracle: what had to happen (triggers) and what had to hold (specification checks). */
export function SpecChecks({ run }: { run: RunDetailDto }) {
  const expected = run.expectedOutcome;
  const done = run.status === "COMPLETED";
  const failed = run.checkResults.filter((c) => c.status === "fail").length;

  return (
    <Section
      id="checks"
      title="Specification checks"
      count={expected ? expected.checks.length : undefined}
      description="Deterministic checks against the store's written specification decide the verdict."
      actions={
        run.checkResults.length > 0 ? (
          <span className={`status tone-${failed ? "bad" : "ok"}`}>
            <Icon name={failed ? "x" : "check"} size={14} />
            {failed ? `${failed} failed` : "All passed"}
          </span>
        ) : undefined
      }
    >
      {!expected ? (
        <p className="empty-line">
          <Icon name="dash" />
          {done ? "No checkable expected outcome was established." : "The expected outcome has not been established yet."}
        </p>
      ) : (
        <div className="oracle panel">
          <p className="oracle__summary">
            <span className="label">Expected outcome</span>
            {expected.summary}
          </p>

          <div className="oracle__group">
            <h3 className="label">Required triggers</h3>
            <ul className="triggers">
              {expected.triggers.map((t) => {
                const seen = run.observedTriggers.includes(t);
                const state = seen ? "seen" : done ? "missing" : "waiting";
                return (
                  <li key={t} className={`trigger trigger--${state}`}>
                    <Icon name={seen ? "check" : done ? "x" : "dash"} size={14} />
                    <code>{t}</code>
                    <span className="muted">{TRIGGER_DESCRIPTIONS[t]}</span>
                    <span className="sr-only">{seen ? "(observed)" : done ? "(not observed)" : "(not observed yet)"}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="oracle__group">
            <h3 className="label">Checks</h3>
            <ul className="checks">
              {(run.checkResults.length > 0
                ? run.checkResults
                : expected.checks.map((check) => ({ check, status: "pending" as const, expected: null, observed: null, detail: null }))
              ).map((c) => {
                const state = CHECK_STATE[c.status];
                return (
                  <li key={c.check} className={`check check--${c.status} tone-${state.tone}`}>
                    <span className="status check__status">
                      <Icon name={state.icon} size={14} />
                      {state.label}
                    </span>
                    <div className="check__what">
                      <p>{CHECK_DESCRIPTIONS[c.check]}</p>
                      <code className="check__id">{c.check}</code>
                      {c.status === "not_evaluable" && c.detail && <p className="small muted">{c.detail}</p>}
                    </div>
                    {c.expected !== null && (
                      <dl className="check__values">
                        <div>
                          <dt>Expected</dt>
                          <dd>{c.expected}</dd>
                        </div>
                        <div className={c.status === "fail" ? "check__observed--bad" : undefined}>
                          <dt>Observed</dt>
                          <dd>{c.observed}</dd>
                        </div>
                      </dl>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </Section>
  );
}
