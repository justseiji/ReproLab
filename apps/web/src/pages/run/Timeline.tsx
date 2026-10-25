import { useMemo, useState } from "react";
import { TRIGGER_DESCRIPTIONS, type RunActionDto } from "@reprolab/shared";
import { Icon, type IconName } from "../../components/Icon";
import { ScreenshotDialog, type Shot } from "../../components/ScreenshotDialog";
import { Section } from "../../components/Section";
import { formatDuration } from "../../format";

const STEP_STATE: Record<RunActionDto["status"], { icon: IconName | null; label: string | null }> = {
  succeeded: { icon: null, label: null },
  failed: { icon: "x", label: "Failed" },
  rejected: { icon: "alert", label: "Rejected" },
};

/** Path only: the origin is always the demo store, so it is noise in a timeline. */
function pagePath(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Numbered action rail with a screenshot after each step. Steps from retried
 * attempts are grouped under their attempt. Thumbnails load lazily; the full
 * image only loads in the viewer.
 */
export function Timeline({ actions, running }: { actions: RunActionDto[]; running: boolean }) {
  const [openShot, setOpenShot] = useState<number | null>(null);

  const attempts = useMemo(() => {
    const groups = new Map<number, RunActionDto[]>();
    for (const a of actions) groups.set(a.attempt, [...(groups.get(a.attempt) ?? []), a]);
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [actions]);

  const shots = useMemo(
    () =>
      actions
        .filter((a) => a.screenshotUrl)
        .map(
          (a): Shot & { id: string } => ({
            id: a.id,
            src: a.screenshotUrl!,
            label: attempts.length > 1 ? `Attempt ${a.attempt} · step ${a.index}` : `Step ${a.index}`,
            caption: a.description,
            detail: a.pageUrl,
          }),
        ),
    [actions, attempts.length],
  );
  const shotIndex = new Map(shots.map((s, i) => [s.id, i]));
  const problems = actions.filter((a) => a.status !== "succeeded").length;

  return (
    <Section
      id="timeline"
      title="Action timeline"
      count={actions.length}
      description={`A screenshot is captured after every step${shots.length ? ` — ${shots.length} available` : ""}.`}
      actions={
        problems > 0 ? (
          <span className="status tone-warn">
            <Icon name="alert" size={14} />
            {problems} step{problems === 1 ? "" : "s"} did not succeed
          </span>
        ) : undefined
      }
    >
      {actions.length === 0 ? (
        <p className="empty-line">
          {running ? <Icon name="spinner" spin /> : <Icon name="dash" />}
          {running ? "No browser actions yet." : "No browser actions were performed."}
        </p>
      ) : (
        <div className="timeline">
          {attempts.map(([attempt, steps]) => (
            <div key={attempt} className="timeline__attempt">
              {attempts.length > 1 && (
                <h3 className="timeline__attempt-label label">
                  Attempt {attempt}
                  <span className="num"> · {steps.length} steps</span>
                </h3>
              )}
              <ol className="timeline__steps">
                {steps.map((a) => {
                  const state = STEP_STATE[a.status];
                  const i = shotIndex.get(a.id);
                  const path = pagePath(a.pageUrl);
                  return (
                    <li key={a.id} className={`step step--${a.status}`}>
                      <span className="step__node mono" aria-hidden="true">
                        {state.icon ? <Icon name={state.icon} size={12} /> : a.index}
                      </span>
                      <div className="step__body">
                        <p className="step__title">
                          <span className="sr-only">Step {a.index}: </span>
                          {a.description}
                          {state.label && <span className={`status tone-${a.status === "failed" ? "bad" : "warn"}`}>{state.label}</span>}
                        </p>
                        {a.locator && <code className="step__locator">{a.locator}</code>}
                        {a.error && (
                          <p className="step__error">
                            <Icon name="alert-circle" size={14} />
                            <span>{a.error}</span>
                          </p>
                        )}
                        {a.triggers.length > 0 && (
                          <p className="step__triggers">
                            {a.triggers.map((t) => (
                              <span key={t} className="tag tag--trigger" title={TRIGGER_DESCRIPTIONS[t]}>
                                <Icon name="flag" size={11} />
                                {t}
                              </span>
                            ))}
                          </p>
                        )}
                        {a.rationale && (
                          <p className="step__rationale">
                            <span className="label">Planner</span> {a.rationale}
                          </p>
                        )}
                        <p className="step__meta mono">
                          <time dateTime={a.startedAt}>{new Date(a.startedAt).toLocaleTimeString()}</time>
                          <span>{formatDuration(a.durationMs)}</span>
                          {path && <span title={a.pageUrl ?? undefined}>{path}</span>}
                        </p>
                      </div>
                      {i !== undefined ? (
                        <button type="button" className="step__thumb" onClick={() => setOpenShot(i)} aria-label={`View screenshot after step ${a.index}`}>
                          <img src={a.screenshotUrl!} alt="" loading="lazy" decoding="async" width={128} height={80} />
                        </button>
                      ) : (
                        <span className="step__thumb step__thumb--missing">
                          <Icon name="image" />
                          <span className="small">No screenshot</span>
                        </span>
                      )}
                    </li>
                  );
                })}
                {running && attempt === attempts[attempts.length - 1]?.[0] && (
                  <li className="step step--pending">
                    <span className="step__node" aria-hidden="true">
                      <Icon name="spinner" size={12} spin />
                    </span>
                    <div className="step__body">
                      <p className="step__title muted">Waiting for the next action…</p>
                    </div>
                  </li>
                )}
              </ol>
            </div>
          ))}
        </div>
      )}
      <ScreenshotDialog shots={shots} index={openShot} onChange={setOpenShot} />
    </Section>
  );
}
