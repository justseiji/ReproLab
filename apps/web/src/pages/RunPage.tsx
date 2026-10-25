import { useParams } from "react-router";
import { api } from "../api";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { ModeLabel, RunStatus } from "../components/status";
import { ErrorState, Loading } from "../components/states";
import { formatDateTime } from "../format";
import { useResource } from "../hooks";
import { BrowserEvidence, RegressionTest } from "./run/Evidence";
import { RunContext } from "./run/RunContext";
import { SpecChecks } from "./run/SpecChecks";
import { Timeline } from "./run/Timeline";
import { Verdict } from "./run/Verdict";

export function RunPage() {
  const { id = "" } = useParams();
  const run = useResource(() => api.run(id), [id], { intervalMs: 1000, pollWhile: (r) => r.status !== "COMPLETED" });

  if (run.loading && !run.data) return <Loading label="Loading run…" />;
  if (run.error && !run.data)
    return (
      <>
        <PageHeader crumbs={[{ label: "Dashboard", to: "/" }, { label: "Run" }]} title="Run" />
        <ErrorState title="Could not load this run" error={run.error} onRetry={run.reload} />
      </>
    );
  const r = run.data!;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Dashboard", to: "/" }, { label: "Report", to: `/reports/${r.report.id}` }, { label: `Run #${r.id.slice(0, 8)}` }]}
        title={r.report.title}
        meta={
          <p className="meta-line">
            <span>
              <RunStatus run={r} />
            </span>
            <ModeLabel mode={r.mode} model={r.modelUsage?.model} />
            <span>
              Created <time dateTime={r.createdAt}>{formatDateTime(r.createdAt)}</time>
            </span>
            {r.attempt > 1 && (
              <span className="num">
                Attempt {r.attempt} of {r.maxAttempts}
              </span>
            )}
          </p>
        }
      />
      {run.error && (
        <Notice tone="warn" title="Live updates paused">
          {run.error.message} Retrying automatically.
        </Notice>
      )}

      <div className="run-layout">
        <div className="run-main">
          <Verdict run={r} />
          <SpecChecks run={r} />
          <Timeline actions={r.actions} running={r.status !== "COMPLETED"} />
          <BrowserEvidence run={r} />
          <RegressionTest run={r} />
        </div>
        <RunContext run={r} />
      </div>
    </>
  );
}
