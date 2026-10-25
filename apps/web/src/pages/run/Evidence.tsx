import type { EvidenceKind, RunDetailDto } from "@reprolab/shared";
import { CodeBlock } from "../../components/CodeBlock";
import { Icon, type IconName } from "../../components/Icon";
import { Section } from "../../components/Section";
import type { Tone } from "../../components/status";
import { useIncremental } from "../../hooks";

const EVIDENCE_KIND: Record<EvidenceKind, { label: string; tone: Tone; icon: IconName }> = {
  console_error: { label: "Console error", tone: "bad", icon: "alert-circle" },
  page_error: { label: "Uncaught page error", tone: "bad", icon: "alert-circle" },
  request_failed: { label: "Failed request", tone: "bad", icon: "x" },
  http_error: { label: "HTTP error response", tone: "bad", icon: "alert-circle" },
  request_blocked: { label: "Blocked by network policy", tone: "warn", icon: "slash-circle" },
};

/** Browser-side signals captured during the run, shown as a log. */
export function BrowserEvidence({ run }: { run: RunDetailDto }) {
  const { visible, remaining, showMore } = useIncremental(run.evidence, 20);
  const attempts = new Set(run.evidence.map((e) => e.attempt)).size;

  return (
    <Section
      id="evidence"
      title="Browser evidence"
      count={run.evidence.length}
      description="Console errors, page errors, failed or error responses, and requests blocked by the network allowlist."
    >
      {run.evidence.length === 0 ? (
        <p className="empty-line">
          <Icon name="check" />
          {run.status === "COMPLETED" ? "Nothing captured during this run." : "Nothing captured yet."}
        </p>
      ) : (
        <div className="log">
          <ol className="log__rows">
            {visible.map((e) => {
              const kind = EVIDENCE_KIND[e.kind];
              return (
                <li key={e.id} className={`log__row tone-${kind.tone}`}>
                  <span className="log__time mono">
                    <time dateTime={e.at}>{new Date(e.at).toLocaleTimeString()}</time>
                    {attempts > 1 && <span>attempt {e.attempt}</span>}
                  </span>
                  <span className="log__kind">
                    <Icon name={kind.icon} size={14} />
                    {kind.label}
                  </span>
                  <span className="log__msg">
                    <span className="prewrap">{e.message}</span>
                    {e.url && <code className="log__url">{e.url}</code>}
                  </span>
                </li>
              );
            })}
          </ol>
          {remaining > 0 && (
            <div className="table__footer">
              <span className="num">
                Showing {visible.length} of {run.evidence.length}
              </span>
              <button type="button" className="btn btn--sm" onClick={showMore}>
                Show more
              </button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

export function RegressionTest({ run }: { run: RunDetailDto }) {
  const test = run.regressionTest;
  return (
    <Section
      id="test"
      title="Regression test"
      description={
        test
          ? "Generated from the validated action trace with fixed templates. It asserts the store specification, so it should fail while the bug exists and pass once it is fixed. Review it before adding it to a suite."
          : undefined
      }
      actions={
        test ? (
          <a className="btn btn--primary btn--sm" href={test.downloadUrl} download={test.fileName}>
            <Icon name="download" size={14} />
            Download test
          </a>
        ) : undefined
      }
    >
      {test ? (
        <div className="stack">
          <CodeBlock code={test.code} label={test.fileName} />
          <p className="small muted">
            Run it with <code>STORE_URL=http://localhost:4100 npx playwright test {test.fileName}</code>
          </p>
        </div>
      ) : (
        <p className="empty-line">
          <Icon name={run.status === "COMPLETED" ? "dash" : "clock"} />
          {run.status !== "COMPLETED"
            ? "Available when the run finishes, if it reproduces the bug."
            : (run.regressionTestNote ?? "No test was generated for this run.")}
        </p>
      )}
    </Section>
  );
}
