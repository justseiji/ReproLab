import type { RunDetailDto, RunOutcome } from "@reprolab/shared";
import { Icon } from "../../components/Icon";
import { OUTCOME_META, runStateMeta } from "../../components/status";
import { formatDuration } from "../../format";
import { useNow } from "../../hooks";

const OUTCOME_EXPLANATION: Record<RunOutcome, string> = {
  REPRODUCED:
    "After the described steps, the store violated the expected behavior. The verdict comes from deterministic specification checks, not from a model's opinion.",
  NOT_REPRODUCED: "The described scenario was performed and every expected-behavior check passed.",
  INCONCLUSIVE: "ReproLab could not reach a trustworthy verdict, so it does not claim one either way.",
  EXECUTION_FAILED: "The run could not be carried out. This is an infrastructure problem and says nothing about the bug.",
};

/** The first thing on a run page: the verdict when finished, live progress otherwise. */
export function Verdict({ run }: { run: RunDetailDto }) {
  return run.status === "COMPLETED" && run.outcome ? <Outcome run={run} outcome={run.outcome} /> : <Progress run={run} />;
}

function Outcome({ run, outcome }: { run: RunDetailDto; outcome: RunOutcome }) {
  const meta = OUTCOME_META[outcome];
  return (
    <section className={`verdict tone-${meta.tone}`} aria-labelledby="verdict-heading">
      <div className="verdict__head">
        <span className="verdict__icon">
          <Icon name={meta.icon} size={22} />
        </span>
        <div>
          <p className="label">Verdict</p>
          <h2 id="verdict-heading" className="verdict__label">
            {meta.label}
          </h2>
        </div>
      </div>
      <div className="verdict__body">
        {run.summary && <p className="verdict__summary">{run.summary}</p>}
        {run.clarification && (
          <div className="verdict__clarify tone-warn">
            <Icon name="help-circle" />
            <p>
              <strong>Clarification needed.</strong> {run.clarification}
            </p>
          </div>
        )}
        {OUTCOME_EXPLANATION[outcome] !== run.summary && <p className="verdict__explain">{OUTCOME_EXPLANATION[outcome]}</p>}
        <p className="meta-line">
          {run.reasonCode && (
            <span>
              Reason <code>{run.reasonCode}</code>
            </span>
          )}
          <span className="num">Took {formatDuration(run.durationMs)}</span>
          {run.attempt > 1 && <span className="num">{run.attempt} attempts</span>}
        </p>
      </div>
    </section>
  );
}

function Progress({ run }: { run: RunDetailDto }) {
  const now = useNow(1000);
  const meta = runStateMeta(run);
  const queued = run.status === "QUEUED";
  const elapsed = run.startedAt ? now - new Date(run.startedAt).getTime() : null;
  const steps = run.actions.length;
  return (
    <section className="verdict verdict--progress tone-accent" aria-labelledby="verdict-heading" aria-busy="true">
      <div className="verdict__head">
        <span className="verdict__icon">
          <Icon name={meta.icon} size={22} spin={!queued} />
        </span>
        <div>
          <p className="label">{meta.label}</p>
          <h2 id="verdict-heading" className="verdict__label">
            {queued ? "Waiting for a worker" : "Reproducing in the browser"}
          </h2>
        </div>
      </div>
      <div className="verdict__body">
        <p className="verdict__summary" aria-live="polite">
          {run.phase ?? "Starting…"}
        </p>
        <div className={`progress${queued ? " progress--idle" : ""}`} aria-hidden="true">
          <span className="progress__bar" />
        </div>
        <p className="meta-line">
          {elapsed !== null && <span className="num">Elapsed {formatDuration(elapsed)}</span>}
          <span className="num">
            {steps} step{steps === 1 ? "" : "s"} so far
          </span>
          {run.attempt > 1 && (
            <span className="num">
              Attempt {run.attempt} of {run.maxAttempts}
            </span>
          )}
        </p>
        {queued && <p className="verdict__explain">If this stays queued, check that the worker process is running.</p>}
      </div>
    </section>
  );
}
