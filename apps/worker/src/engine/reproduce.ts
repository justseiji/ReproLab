import type { Db } from "@reprolab/db";
import {
  BrowserActionSchema,
  checkActionAgainstObservation,
  decideOutcome,
  describeAction,
  detectTriggers,
  generateRegressionTest,
  type BugFlags,
  type CheckResult,
  type ExpectedOutcome,
  type ReasonCode,
  type RunOutcome,
  type StopReason,
  type TestStep,
  type TriggerEvent,
} from "@reprolab/shared";
import type { AppConfig } from "@reprolab/shared/node";
import type { HistoryEntry, Planner } from "../planners/types";
import { BrowserSession, redactUrl } from "./browser-session";
import type { RunRecorder } from "./recorder";
import { checkStoreReachable, getStoreBugs } from "./store-admin";

export interface RunResult {
  outcome: RunOutcome;
  reasonCode: ReasonCode;
  summary: string;
  expected: ExpectedOutcome | null;
  clarification: string | null;
  checkResults: CheckResult[];
  observedTriggers: TriggerEvent[];
  missingTriggers: TriggerEvent[];
  regressionTest: { fileName: string; code: string } | null;
  regressionTestNote: string | null;
}

export interface ReproduceParams {
  db: Db;
  config: AppConfig;
  recorder: RunRecorder;
  planner: Planner;
  runId: string;
  reportTitle: string;
  /** Aborted when the run deadline passes, the job lease is lost, or the worker stops. */
  signal: AbortSignal;
  /** The error to raise if the abort was not the deadline (lease lost or shutdown). */
  interruption: () => Error | null;
}

const ABORTED = Symbol("aborted");

/**
 * Runs one reproduction attempt. Both planners go through this loop:
 * observe → plan → validate (schema, then against the observation) →
 * execute → observe → detect triggers → record. The outcome comes only from
 * the deterministic oracle, never from the planner's own claims.
 */
export async function reproduce(params: ReproduceParams): Promise<RunResult> {
  const { db, config, recorder, planner, signal } = params;

  const guarded = async <T>(fn: () => Promise<T>): Promise<T | typeof ABORTED> => {
    try {
      return await fn();
    } catch (error) {
      if (signal.aborted) return ABORTED;
      throw error;
    }
  };
  const onAbort = (): StopReason => {
    const interruption = params.interruption();
    if (interruption) throw interruption;
    return "budget_exhausted";
  };
  const timeLimit = `Run time limit of ${Math.round(config.run.timeoutMs / 1000)}s reached.`;

  // 1. Turn the report into an explicit expected outcome (or stop here).
  await recorder.phase(planner.mode === "SCRIPTED" ? "Loading scripted recipe" : "Interpreting the report");
  const prep = await guarded(() => planner.prepare(signal));
  if (prep === ABORTED) {
    onAbort();
    return emptyResult("INCONCLUSIVE", "BUDGET_EXHAUSTED", timeLimit);
  }
  if (prep.kind === "inconclusive") {
    return { ...emptyResult("INCONCLUSIVE", prep.reasonCode, prep.summary), clarification: prep.clarification ?? null };
  }
  const expected = prep.expected;
  await db.run.update({ where: { id: params.runId }, data: { expectedOutcome: expected } });
  await recorder.event("info", `Expected outcome: ${expected.summary}`);

  // 2. Infrastructure preflight. Failures here are retried, not reported as "not reproduced".
  await recorder.phase("Checking the demo store");
  await checkStoreReachable(config.storeUrl);
  const bugs: BugFlags | null = await getStoreBugs(config.storeAdminUrl).catch(() => null);
  if (bugs) await db.run.update({ where: { id: params.runId }, data: { storeConfig: { bugs } } });

  await recorder.phase("Launching an isolated browser");
  const session = await BrowserSession.launch({
    storeOrigin: config.storeOrigin,
    headless: config.run.headless,
    actionTimeoutMs: config.run.actionTimeoutMs,
    onEvidence: (kind, message, url) => recorder.evidence(kind, message, url),
  });

  try {
    await session.startTracing();
    let observation = await session.observe();
    const history: HistoryEntry[] = [];
    const executed: TestStep[] = [];
    const observedTriggers = new Set<TriggerEvent>();
    let stopReason: StopReason | null = null;
    let stopDetail = "";

    // 3. Bounded action loop.
    for (let index = 1; index <= planner.maxActions; index++) {
      if (signal.aborted) {
        stopReason = onAbort();
        stopDetail = timeLimit;
        break;
      }
      await recorder.phase(`Planning step ${index}`);
      const decision = await guarded(() =>
        planner.next(
          { observation, history, remainingActions: planner.maxActions - index + 1, observedTriggers },
          signal,
        ),
      );
      if (decision === ABORTED) {
        stopReason = onAbort();
        stopDetail = timeLimit;
        break;
      }
      const startedAt = new Date();
      if (decision.kind === "stop") {
        stopReason = decision.stopReason;
        stopDetail = decision.detail;
        break;
      }
      if (decision.kind === "invalid") {
        await recorder.action({
          index,
          action: { type: "invalid" },
          description: "Planner output rejected",
          status: "rejected",
          error: decision.detail,
          startedAt,
          durationMs: 0,
        });
        history.push({ index, description: "Invalid planner output", status: "rejected", error: decision.detail, pagePath: observation.path, triggers: [] });
        continue;
      }

      // Gate 1: the action vocabulary. Gate 2: the element must be on this page and suit the action.
      const parsed = BrowserActionSchema.safeParse(decision.action);
      const check = parsed.success
        ? checkActionAgainstObservation(parsed.data, observation)
        : ({ ok: false, reason: "Action is outside the allowed vocabulary." } as const);
      if (!parsed.success || !check.ok) {
        const reason = check.ok ? "Invalid action." : check.reason;
        await recorder.action({
          index,
          action: parsed.success ? parsed.data : { type: "invalid" },
          description: "Action rejected by validation",
          status: "rejected",
          error: reason,
          rationale: decision.rationale,
          startedAt,
          durationMs: 0,
        });
        history.push({ index, description: "Rejected action", status: "rejected", error: reason, pagePath: observation.path, triggers: [] });
        continue;
      }

      const action = parsed.data;
      const description = describeAction(action, check.element);
      await recorder.phase(`Step ${index}: ${description}`);
      const result = await session.execute(action, check.locator);
      const next = await session.observe();
      const triggers = detectTriggers(observation.cart, next.cart);
      triggers.forEach((t) => observedTriggers.add(t));
      const screenshotId = await session
        .screenshot()
        .then((image) => recorder.saveScreenshot(index, image))
        .catch(() => null);

      await recorder.action({
        index,
        action,
        description,
        status: result.ok ? "succeeded" : "failed",
        error: result.ok ? null : result.error,
        rationale: decision.rationale,
        locator: check.locator,
        pageUrl: redactUrl(next.url),
        triggers,
        screenshotId,
        startedAt,
        durationMs: Date.now() - startedAt.getTime(),
      });
      history.push({
        index,
        description,
        status: result.ok ? "succeeded" : "failed",
        error: result.ok ? null : result.error,
        pagePath: next.path,
        triggers,
      });
      if (result.ok) executed.push({ action, locator: check.locator });
      observation = next;

      if (session.navigationBlocked) {
        stopReason = "navigation_blocked";
        stopDetail = `Blocked navigation to ${session.navigationBlocked}.`;
        break;
      }
    }
    if (!stopReason) {
      stopReason = "budget_exhausted";
      stopDetail = `Used all ${planner.maxActions} actions without finishing.`;
    }

    // 4. Deterministic evaluation against the store specification.
    await recorder.phase("Evaluating against the store specification");
    const decision = decideOutcome({ expected, stopReason, stopDetail, observedTriggers, finalCart: observation.cart });

    let regressionTest: RunResult["regressionTest"] = null;
    let regressionTestNote: string | null = null;
    if (decision.outcome === "REPRODUCED") {
      const generated = generateRegressionTest({
        runId: params.runId,
        reportTitle: params.reportTitle,
        modeLabel: planner.label,
        generatedAt: new Date().toISOString(),
        steps: executed,
        expected,
        finalCart: observation.cart,
        checkResults: decision.checkResults,
      });
      if (generated.ok) regressionTest = { fileName: generated.fileName, code: generated.code };
      else regressionTestNote = `No regression test was generated: ${generated.reason}`;
    } else {
      regressionTestNote = "Regression tests are generated only for runs that reproduce the bug against a clear expected outcome.";
    }

    return {
      outcome: decision.outcome,
      reasonCode: decision.reasonCode,
      summary: decision.summary,
      expected,
      clarification: null,
      checkResults: decision.checkResults,
      observedTriggers: [...observedTriggers],
      missingTriggers: decision.missingTriggers,
      regressionTest,
      regressionTestNote,
    };
  } finally {
    // Always save the trace and close the browser, even after an exception.
    try {
      const tracePath = await recorder.tracePath();
      if (await session.stopTracing(tracePath)) await recorder.registerTrace(tracePath);
    } catch {
      // The trace is best-effort evidence; a failure here must not hide the real result.
    }
    await session.close();
    await recorder.flush();
  }
}

function emptyResult(outcome: RunOutcome, reasonCode: ReasonCode, summary: string): RunResult {
  return {
    outcome,
    reasonCode,
    summary,
    expected: null,
    clarification: null,
    checkResults: [],
    observedTriggers: [],
    missingTriggers: [],
    regressionTest: null,
    regressionTestNote: null,
  };
}
