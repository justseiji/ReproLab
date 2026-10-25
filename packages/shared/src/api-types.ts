import type { CheckResult, ExpectedOutcome, ReasonCode, TriggerEvent } from "./oracle";
import type { RunMode, RunOutcome, RunStatus } from "./report";
import type { BugFlags } from "./store-spec";

/** Response shapes shared by the API and the web UI. */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface RunSummaryDto {
  id: string;
  reportId: string;
  mode: RunMode;
  status: RunStatus;
  outcome: RunOutcome | null;
  reasonCode: ReasonCode | null;
  summary: string | null;
  phase: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface ReportSummaryDto {
  id: string;
  title: string;
  seedKey: string | null;
  createdAt: string;
  runCount: number;
  latestRun: RunSummaryDto | null;
}

export interface ReportDetailDto {
  id: string;
  title: string;
  description: string;
  expectedBehavior: string;
  actualBehavior: string | null;
  seedKey: string | null;
  scriptedSupported: boolean;
  createdAt: string;
  runs: RunSummaryDto[];
}

export interface RunActionDto {
  id: string;
  attempt: number;
  index: number;
  type: string;
  description: string;
  status: "succeeded" | "failed" | "rejected";
  error: string | null;
  rationale: string | null;
  locator: string | null;
  pageUrl: string | null;
  triggers: TriggerEvent[];
  startedAt: string;
  durationMs: number | null;
  screenshotUrl: string | null;
}

export type EvidenceKind = "console_error" | "page_error" | "request_failed" | "http_error" | "request_blocked";

export interface EvidenceDto {
  id: string;
  attempt: number;
  kind: EvidenceKind;
  message: string;
  url: string | null;
  at: string;
}

export interface ArtifactDto {
  id: string;
  kind: "SCREENSHOT" | "TRACE";
  label: string;
  contentType: string;
  sizeBytes: number;
  url: string;
}

export interface RunEventDto {
  id: string;
  at: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface ModelUsageDto {
  provider: string;
  model: string;
  calls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Only present when real usage and configured prices are both available. */
  estimatedCostUsd: number | null;
}

export interface RunDetailDto extends RunSummaryDto {
  report: { id: string; title: string; description: string; expectedBehavior: string; actualBehavior: string | null };
  attempt: number;
  maxAttempts: number;
  expectedOutcome: ExpectedOutcome | null;
  clarification: string | null;
  checkResults: CheckResult[];
  observedTriggers: TriggerEvent[];
  missingTriggers: TriggerEvent[];
  storeConfig: { bugs: BugFlags } | null;
  modelUsage: ModelUsageDto | null;
  actions: RunActionDto[];
  evidence: EvidenceDto[];
  artifacts: ArtifactDto[];
  events: RunEventDto[];
  regressionTest: { fileName: string; code: string; downloadUrl: string } | null;
  regressionTestNote: string | null;
}

export interface AppConfigDto {
  liveAi: {
    available: boolean;
    /** Provider id, e.g. "openai". */
    provider: string | null;
    /** Human-readable provider name, e.g. "OpenAI". */
    providerLabel: string | null;
    model: string | null;
    reason: string | null;
  };
  scriptedSeedKeys: string[];
  limits: { maxActionsScripted: number; maxActionsLive: number; runTimeoutMs: number };
  storeUrl: string;
}

export interface StoreBugsDto {
  bugs: BugFlags;
}
