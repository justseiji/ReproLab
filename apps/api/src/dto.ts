import type { Artifact, Report, Run, RunAction, RunEvent, RunEvidence } from "@reprolab/db";
import {
  findRecipe,
  type ArtifactDto,
  type BugFlags,
  type CheckResult,
  type ElementLocator,
  type EvidenceKind,
  type ExpectedOutcome,
  type ReasonCode,
  type ReportDetailDto,
  type ReportSummaryDto,
  type RunDetailDto,
  type RunSummaryDto,
  type TriggerEvent,
} from "@reprolab/shared";

/** Maps database rows to the response shapes in @reprolab/shared/api-types. */

const iso = (d: Date | null) => (d ? d.toISOString() : null);
export const artifactUrl = (id: string) => `/api/artifacts/${id}`;

export function toRunSummary(run: Run): RunSummaryDto {
  return {
    id: run.id,
    reportId: run.reportId,
    mode: run.mode,
    status: run.status,
    outcome: run.outcome,
    reasonCode: run.reasonCode as ReasonCode | null,
    summary: run.summary,
    phase: run.phase,
    createdAt: run.createdAt.toISOString(),
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
    durationMs: run.durationMs,
  };
}

export function toReportSummary(report: Report & { runs: Run[]; _count: { runs: number } }): ReportSummaryDto {
  return {
    id: report.id,
    title: report.title,
    seedKey: report.seedKey,
    createdAt: report.createdAt.toISOString(),
    runCount: report._count.runs,
    latestRun: report.runs[0] ? toRunSummary(report.runs[0]) : null,
  };
}

export function toReportDetail(report: Report & { runs: Run[] }): ReportDetailDto {
  return {
    id: report.id,
    title: report.title,
    description: report.description,
    expectedBehavior: report.expectedBehavior,
    actualBehavior: report.actualBehavior,
    seedKey: report.seedKey,
    scriptedSupported: Boolean(findRecipe(report.seedKey)),
    createdAt: report.createdAt.toISOString(),
    runs: report.runs.map(toRunSummary),
  };
}

function describeLocator(locator: unknown): string | null {
  const l = locator as ElementLocator | null;
  if (!l) return null;
  return l.kind === "testId" ? `getByTestId("${l.testId}")` : `getByRole("${l.role}", { name: "${l.name}" })`;
}

type RunWithRelations = Run & {
  report: Report;
  actions: RunAction[];
  evidence: RunEvidence[];
  artifacts: Artifact[];
  events: RunEvent[];
  job: { maxAttempts: number } | null;
};

export function toRunDetail(run: RunWithRelations): RunDetailDto {
  // The timeline shows the latest attempt; earlier attempts are summarised in the events.
  const current = <T extends { attempt: number }>(rows: T[]) => rows.filter((r) => r.attempt === run.attempt);
  return {
    ...toRunSummary(run),
    report: {
      id: run.report.id,
      title: run.report.title,
      description: run.report.description,
      expectedBehavior: run.report.expectedBehavior,
      actualBehavior: run.report.actualBehavior,
    },
    attempt: run.attempt,
    maxAttempts: run.job?.maxAttempts ?? 1,
    expectedOutcome: run.expectedOutcome as ExpectedOutcome | null,
    clarification: run.clarification,
    checkResults: (run.checkResults as CheckResult[] | null) ?? [],
    observedTriggers: run.observedTriggers as TriggerEvent[],
    missingTriggers: run.missingTriggers as TriggerEvent[],
    storeConfig: run.storeConfig as { bugs: BugFlags } | null,
    modelUsage: run.modelProvider
      ? {
          provider: run.modelProvider,
          model: run.modelName ?? "unknown",
          calls: run.modelCalls,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          estimatedCostUsd: run.estimatedCostUsd,
        }
      : null,
    actions: current(run.actions)
      .sort((a, b) => a.index - b.index)
      .map((a) => ({
        id: a.id,
        attempt: a.attempt,
        index: a.index,
        type: a.type,
        description: a.description,
        status: a.status as "succeeded" | "failed" | "rejected",
        error: a.error,
        rationale: a.rationale,
        locator: describeLocator(a.locator),
        pageUrl: a.pageUrl,
        triggers: a.triggers as TriggerEvent[],
        startedAt: a.startedAt.toISOString(),
        durationMs: a.durationMs,
        screenshotUrl: a.screenshotId ? artifactUrl(a.screenshotId) : null,
      })),
    evidence: current(run.evidence).map((e) => ({
      id: e.id,
      attempt: e.attempt,
      kind: e.kind as EvidenceKind,
      message: e.message,
      url: e.url,
      at: e.at.toISOString(),
    })),
    artifacts: run.artifacts
      .filter((a) => a.kind === "TRACE" || a.attempt === run.attempt)
      .map(
        (a): ArtifactDto => ({
          id: a.id,
          kind: a.kind,
          label: a.kind === "TRACE" ? `${a.label} (attempt ${a.attempt})` : a.label,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
          url: artifactUrl(a.id),
        }),
      ),
    events: run.events.map((e) => ({
      id: e.id,
      at: e.at.toISOString(),
      level: e.level as "info" | "warn" | "error",
      message: e.message,
    })),
    regressionTest:
      run.regressionTest && run.regressionTestFileName
        ? { fileName: run.regressionTestFileName, code: run.regressionTest, downloadUrl: `/api/runs/${run.id}/regression-test` }
        : null,
    regressionTestNote: run.regressionTestNote,
  };
}
