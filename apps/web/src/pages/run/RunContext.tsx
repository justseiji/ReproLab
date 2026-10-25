import { BUG_INFO, BUG_KEYS, RUN_MODE_LABELS, type RunDetailDto } from "@reprolab/shared";
import { Disclosure } from "../../components/Disclosure";
import { Icon } from "../../components/Icon";
import { formatBytes, formatDateTime, formatDuration, formatUsd } from "../../format";
import { ReportText } from "../../components/ReportText";

/** Secondary information for a run, behind progressive disclosure. */
export function RunContext({ run }: { run: RunDetailDto }) {
  const traces = run.artifacts.filter((a) => a.kind === "TRACE");
  const screenshots = run.artifacts.filter((a) => a.kind === "SCREENSHOT").length;
  const enabledBugs = run.storeConfig ? BUG_KEYS.filter((k) => run.storeConfig!.bugs[k]).length : 0;

  return (
    <aside className="run-aside" aria-label="Run context">
      <h2 className="label run-aside__title">Run context</h2>

      <Disclosure summary="Artifacts" aside={`${plural(traces.length, "trace")} · ${plural(screenshots, "screenshot")}`} defaultOpen>
        {traces.length === 0 && screenshots === 0 ? (
          <p className="small muted">Screenshots and a Playwright trace are saved once the browser starts.</p>
        ) : (
          <>
            <ul className="artifact-list">
              {traces.map((t) => (
                <li key={t.id}>
                  <a href={t.url} download className="artifact">
                    <Icon name="download" size={14} />
                    <span>{t.label}</span>
                    <span className="muted num">{formatBytes(t.sizeBytes)}</span>
                  </a>
                </li>
              ))}
              <li className="small muted">
                {screenshots} screenshot{screenshots === 1 ? "" : "s"} — open them from the timeline.
              </li>
            </ul>
            {traces.length > 0 && (
              <p className="small muted">
                Inspect with <code>npx playwright show-trace trace.zip</code>
              </p>
            )}
          </>
        )}
      </Disclosure>

      <Disclosure summary="Report" aside="as submitted">
        <ReportText description={run.report.description} expected={run.report.expectedBehavior} actual={run.report.actualBehavior} compact />
      </Disclosure>

      <Disclosure summary="Run details">
        <dl className="kv">
          <dt>Run ID</dt>
          <dd className="mono">{run.id}</dd>
          <dt>Mode</dt>
          <dd>{RUN_MODE_LABELS[run.mode]}</dd>
          <dt>Created</dt>
          <dd>{formatDateTime(run.createdAt)}</dd>
          <dt>Started</dt>
          <dd>{formatDateTime(run.startedAt)}</dd>
          <dt>Finished</dt>
          <dd>{formatDateTime(run.finishedAt)}</dd>
          <dt>Duration</dt>
          <dd className="num">{formatDuration(run.durationMs)}</dd>
          <dt>Attempt</dt>
          <dd className="num">
            {run.attempt} of {run.maxAttempts}
          </dd>
          <dt>Reason code</dt>
          <dd className="mono">{run.reasonCode ?? "—"}</dd>
        </dl>
      </Disclosure>

      {run.storeConfig && (
        <Disclosure summary="Demo store at start" aside={`${enabledBugs} of ${BUG_KEYS.length} bugs on`}>
          <p className="small muted">Recorded as evidence only. The evaluator never reads these switches.</p>
          <ul className="flag-list">
            {BUG_KEYS.map((key) => {
              const on = run.storeConfig!.bugs[key];
              return (
                <li key={key}>
                  <span>{BUG_INFO[key].title}</span>
                  <span className={`status status--plain tone-${on ? "bad" : "ok"}`}>
                    <Icon name={on ? "alert-circle" : "check-circle"} size={14} />
                    {on ? "Bug enabled" : "Fixed"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Disclosure>
      )}

      {run.mode === "LIVE_AI" && (
        <Disclosure summary="Model usage" aside={run.modelUsage ? `${run.modelUsage.calls} calls` : "none"}>
          {!run.modelUsage ? (
            <p className="small muted">No model calls recorded.</p>
          ) : (
            <dl className="kv">
              <dt>Model</dt>
              <dd className="mono">
                {run.modelUsage.provider} / {run.modelUsage.model}
              </dd>
              <dt>Calls</dt>
              <dd className="num">{run.modelUsage.calls}</dd>
              <dt>Tokens</dt>
              <dd className="num">
                {run.modelUsage.inputTokens === null
                  ? "not reported"
                  : `${run.modelUsage.inputTokens.toLocaleString()} in · ${run.modelUsage.outputTokens?.toLocaleString()} out`}
              </dd>
              <dt>Est. cost</dt>
              <dd>
                {run.modelUsage.estimatedCostUsd === null
                  ? "not estimated (needs reported usage and configured prices)"
                  : formatUsd(run.modelUsage.estimatedCostUsd)}
              </dd>
            </dl>
          )}
        </Disclosure>
      )}

      <Disclosure summary="Run events" aside={run.events.length}>
        {run.events.length === 0 ? (
          <p className="small muted">No events yet.</p>
        ) : (
          <ol className="event-list">
            {run.events.map((e) => (
              <li key={e.id} className={`event event--${e.level}`}>
                <time dateTime={e.at}>{new Date(e.at).toLocaleTimeString()}</time>
                <span>
                  {e.level !== "info" && <span className="event__level">{e.level}</span>}
                  {e.message}
                </span>
              </li>
            ))}
          </ol>
        )}
        {run.events.length >= 200 && <p className="small muted">Only the first 200 events are returned by the API.</p>}
      </Disclosure>
    </aside>
  );
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
