/** The submitted report text as labelled passages. Shared by the report and run pages. */
export function ReportText(props: { description: string; expected: string; actual: string | null; compact?: boolean }) {
  return (
    <dl className={`report-text${props.compact ? " report-text--compact" : ""}`}>
      <div>
        <dt className="label">Steps or description</dt>
        <dd className="prewrap">{props.description}</dd>
      </div>
      <div>
        <dt className="label">Expected behavior</dt>
        <dd className="prewrap">{props.expected}</dd>
      </div>
      <div>
        <dt className="label">Actual behavior</dt>
        <dd className="prewrap">{props.actual ?? <span className="muted">Not provided.</span>}</dd>
      </div>
    </dl>
  );
}
