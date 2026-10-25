import type {
  ApiErrorBody,
  AppConfigDto,
  BugFlags,
  CreateReportRequest,
  ReportDetailDto,
  ReportSummaryDto,
  RunDetailDto,
  RunMode,
  RunSummaryDto,
  StoreBugsDto,
} from "@reprolab/shared";

/** Error thrown for non-2xx responses, carrying the API's error envelope. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
    });
  } catch {
    throw new ApiRequestError(0, "NETWORK_ERROR", "Could not reach the ReproLab API. Is it running?");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiRequestError(
      res.status,
      body?.error.code ?? "HTTP_ERROR",
      body?.error.message ?? `Request failed with status ${res.status}.`,
      body?.error.details as Array<{ path: string; message: string }> | undefined,
    );
  }
  return (await res.json()) as T;
}

export const api = {
  config: () => request<AppConfigDto>("/api/config"),
  reports: () => request<ReportSummaryDto[]>("/api/reports"),
  report: (id: string) => request<ReportDetailDto>(`/api/reports/${encodeURIComponent(id)}`),
  createReport: (body: CreateReportRequest) =>
    request<{ report: ReportDetailDto; run: RunSummaryDto }>("/api/reports", { method: "POST", body: JSON.stringify(body) }),
  createRun: (reportId: string, mode: RunMode) =>
    request<RunSummaryDto>(`/api/reports/${encodeURIComponent(reportId)}/runs`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),
  run: (id: string) => request<RunDetailDto>(`/api/runs/${encodeURIComponent(id)}`),
  storeBugs: () => request<StoreBugsDto>("/api/demo/store-bugs"),
  setStoreBugs: (update: Partial<BugFlags>) =>
    request<StoreBugsDto>("/api/demo/store-bugs", { method: "PUT", body: JSON.stringify(update) }),
};
