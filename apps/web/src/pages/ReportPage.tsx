import { Link, useParams } from "react-router";
import type { RunSummaryDto } from "@reprolab/shared";
import { api } from "../api";
import { DataTable, type Column } from "../components/DataTable";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { ReportText } from "../components/ReportText";
import { Section } from "../components/Section";
import { ModeLabel, RunStatus } from "../components/status";
import { EmptyState, ErrorState, Loading } from "../components/states";
import { useAppConfig } from "../config-context";
import { formatDateTime, formatDuration } from "../format";
import { useResource } from "../hooks";
import { useStartRun } from "../start-run";

const RUN_COLUMNS: Column<RunSummaryDto>[] = [
  {
    key: "run",
    header: "Run",
    primary: true,
    cell: (run) => (
      <Link to={`/runs/${run.id}`} className="run-cell">
        <time dateTime={run.createdAt}>{formatDateTime(run.createdAt)}</time>
        <span className="mono muted">#{run.id.slice(0, 8)}</span>
      </Link>
    ),
  },
  { key: "outcome", header: "Outcome", shrink: true, emphasis: true, cell: (run) => <RunStatus run={run} /> },
  { key: "mode", header: "Mode", shrink: true, cell: (run) => <ModeLabel mode={run.mode} /> },
  {
    key: "summary",
    header: "Summary",
    wide: true,
    cell: (run) => <span className="summary-cell">{run.summary ?? run.phase ?? "—"}</span>,
  },
  { key: "duration", header: "Duration", align: "end", shrink: true, cell: (run) => <span className="num">{formatDuration(run.durationMs)}</span> },
];

export function ReportPage() {
  const { id = "" } = useParams();
  const { config } = useAppConfig();
  const report = useResource(() => api.report(id), [id], {
    pollWhile: (r) => r.runs.some((run) => run.status !== "COMPLETED"),
  });
  const { start, pending, error } = useStartRun();
  const crumbs = [{ label: "Dashboard", to: "/" }, { label: "Report" }];

  if (report.loading && !report.data) return <Loading label="Loading report…" />;
  if (report.error && !report.data)
    return (
      <>
        <PageHeader crumbs={crumbs} title="Report" />
        <ErrorState title="Could not load this report" error={report.error} onRetry={report.reload} />
      </>
    );
  const r = report.data!;
  const liveAvailable = Boolean(config?.liveAi.available);

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        title={r.title}
        meta={
          <p className="meta-line">
            <span>
              Submitted <time dateTime={r.createdAt}>{formatDateTime(r.createdAt)}</time>
            </span>
            <span className="num">
              {r.runs.length} run{r.runs.length === 1 ? "" : "s"}
            </span>
            {r.seedKey && (
              <span>
                <span className="tag">seeded</span>
              </span>
            )}
          </p>
        }
        actions={
          <>
            <button type="button" className="btn btn--primary" disabled={pending !== null} onClick={() => start(r.id, "SCRIPTED")}>
              <Icon name="play" size={12} />
              {pending === `${r.id}:SCRIPTED` ? "Starting…" : "Run scripted demo"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!liveAvailable || pending !== null}
              onClick={() => start(r.id, "LIVE_AI")}
              title={liveAvailable ? undefined : (config?.liveAi.reason ?? undefined)}
            >
              {pending === `${r.id}:LIVE_AI` ? "Starting…" : "Run with live AI"}
            </button>
          </>
        }
      />
      {error && (
        <Notice tone="error" alert title="Could not start the run">
          {error}
        </Notice>
      )}
      {!r.scriptedSupported && (
        <Notice>This report has no scripted recipe. A scripted run will end Inconclusive and explain that live AI mode is required.</Notice>
      )}

      <div className="report-layout">
        <Section id="report-text" title="Report" className="report-doc panel">
          <ReportText description={r.description} expected={r.expectedBehavior} actual={r.actualBehavior} />
        </Section>

        <Section id="runs" title="Run history" count={r.runs.length} description="Newest first. Each run is an independent reproduction attempt.">
          {r.runs.length === 0 ? (
            <EmptyState title="No runs yet" icon="play" compact>
              Start one with <strong>Run scripted demo</strong> or <strong>Run with live AI</strong>.
            </EmptyState>
          ) : (
            <DataTable caption={`Runs of “${r.title}”`} columns={RUN_COLUMNS} rows={r.runs} rowKey={(run) => run.id} noun="runs" pageSize={25} />
          )}
        </Section>
      </div>
    </>
  );
}
