import { Link } from "react-router";
import { BUG_INFO, SEEDED_REPORTS, type ReportSummaryDto } from "@reprolab/shared";
import { api } from "../api";
import { DataTable, type Column } from "../components/DataTable";
import { Icon } from "../components/Icon";
import { Notice } from "../components/Notice";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { ModeLabel, RunStatus } from "../components/status";
import { EmptyState, ErrorState, Loading } from "../components/states";
import { useAppConfig } from "../config-context";
import { formatDateTime, formatDuration, formatRelative } from "../format";
import { useNow, useResource } from "../hooks";
import { useStartRun } from "../start-run";

const isActive = (r: ReportSummaryDto) => r.latestRun !== null && r.latestRun.status !== "COMPLETED";

export function DashboardPage() {
  const { config } = useAppConfig();
  const reports = useResource(api.reports, [], { intervalMs: 2000, pollWhile: (list) => list.some(isActive) });
  const { start, pending, error: startError } = useStartRun();
  const now = useNow(15_000);
  const liveAvailable = Boolean(config?.liveAi.available);

  const seeded = reports.data?.filter((r) => r.seedKey) ?? [];

  const columns: Column<ReportSummaryDto>[] = [
    {
      key: "title",
      header: "Report",
      primary: true,
      cell: (r) => (
        <div className="report-cell">
          <Link to={`/reports/${r.id}`} className="report-cell__title">
            {r.title}
          </Link>
          <span className="meta-line">
            {r.seedKey && <span className="tag">seeded</span>}
            <span>Submitted {formatRelative(r.createdAt, now)}</span>
          </span>
        </div>
      ),
    },
    {
      key: "outcome",
      header: "Latest outcome",
      shrink: true,
      emphasis: true,
      cell: (r) =>
        r.latestRun ? (
          <Link to={`/runs/${r.latestRun.id}`} className="status-link" aria-label={`Latest run of “${r.title}”: open run`}>
            <RunStatus run={r.latestRun} />
          </Link>
        ) : (
          <span className="muted">No runs</span>
        ),
    },
    { key: "mode", header: "Mode", shrink: true, cell: (r) => (r.latestRun ? <ModeLabel mode={r.latestRun.mode} /> : <span className="muted">—</span>) },
    { key: "duration", header: "Duration", align: "end", shrink: true, cell: (r) => <span className="num">{formatDuration(r.latestRun?.durationMs)}</span> },
    {
      key: "when",
      header: "Last activity",
      align: "end",
      shrink: true,
      cell: (r) => {
        const at = r.latestRun?.createdAt ?? r.createdAt;
        return (
          <time dateTime={at} title={formatDateTime(at)} className="num">
            {formatRelative(at, now)}
          </time>
        );
      },
    },
    { key: "runs", header: "Runs", align: "end", shrink: true, cell: (r) => <span className="num">{r.runCount}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Bug reports"
        description="Submit a report, let the worker reproduce it in an isolated browser, and review the evidence."
        actions={
          <Link to="/reports/new" className="btn btn--primary">
            <Icon name="plus" size={14} />
            New report
          </Link>
        }
      />

      {startError && (
        <Notice tone="error" alert title="Could not start the run">
          {startError}
        </Notice>
      )}

      <Section
        id="examples"
        title="Seeded examples"
        description={
          <>
            Each targets one deliberate bug in the demo store. <strong>Scripted demo</strong> replays a fixed recipe and needs no API
            key; <strong>Live AI</strong> lets the model plan the steps.
          </>
        }
      >
        <ul className="examples panel panel--flush">
          {SEEDED_REPORTS.map((example) => {
            const report = seeded.find((r) => r.seedKey === example.seedKey);
            return (
              <li key={example.seedKey} className="example">
                <div className="example__head">
                  <p className="label">{BUG_INFO[example.bug].title}</p>
                  {report?.latestRun && (
                    <Link to={`/runs/${report.latestRun.id}`} className="status-link" aria-label={`Latest run of “${example.title}”: open run`}>
                      <RunStatus run={report.latestRun} plain />
                    </Link>
                  )}
                </div>
                <h3 className="example__title">
                  {report ? <Link to={`/reports/${report.id}`}>{example.title}</Link> : example.title}
                </h3>
                <p className="example__desc">{example.expectedBehavior}</p>
                <div className="btn-row example__actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={!report || pending !== null}
                    onClick={() => report && start(report.id, "SCRIPTED")}
                  >
                    <Icon name="play" size={12} />
                    {pending === `${report?.id}:SCRIPTED` ? "Starting…" : "Run scripted demo"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={!report || !liveAvailable || pending !== null}
                    onClick={() => report && start(report.id, "LIVE_AI")}
                    aria-describedby={!liveAvailable ? "live-ai-hint" : undefined}
                  >
                    {pending === `${report?.id}:LIVE_AI` ? "Starting…" : "Run with live AI"}
                  </button>
                </div>
                {!report && !reports.loading && (
                  <p className="small muted">
                    Not seeded yet — run <code>npm run db:seed</code>.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {!liveAvailable && (
          <p id="live-ai-hint" className="small muted examples__hint">
            Live AI is off: {config?.liveAi.reason ?? "checking configuration…"}
          </p>
        )}
      </Section>

      <Section id="reports" title="All reports" count={reports.data?.length}>
        {reports.loading && !reports.data ? (
          <Loading label="Loading reports…" />
        ) : reports.error && !reports.data ? (
          <ErrorState title="Could not load reports" error={reports.error} onRetry={reports.reload} />
        ) : reports.data && reports.data.length === 0 ? (
          <EmptyState title="No reports yet" icon="file">
            <Link to="/reports/new">Submit a report</Link> or seed the examples with <code>npm run db:seed</code>.
          </EmptyState>
        ) : (
          <DataTable caption="All bug reports with their latest run" columns={columns} rows={reports.data ?? []} rowKey={(r) => r.id} noun="reports" />
        )}
      </Section>
    </>
  );
}
