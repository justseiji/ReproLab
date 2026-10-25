import { ModelProviderError } from "./provider";

export type FetchFn = typeof fetch;

export interface PostJsonOptions {
  headers?: Record<string, string>;
  /** Per-attempt timeout. */
  timeoutMs: number;
  /** Cancels the call (run deadline or lease loss). */
  signal: AbortSignal;
  /** Extra attempts after the first for 408/429/5xx and network errors. */
  retries?: number;
  fetch?: FetchFn;
  /** Shown in error messages, e.g. "OpenAI". */
  label: string;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });

/**
 * POSTs JSON to a model API and returns the parsed response body. Shared by
 * every REST-based provider so they all time out, retry and classify errors
 * the same way. Error messages never include request headers (API keys).
 */
export async function postJson<T>(url: string, body: unknown, options: PostJsonOptions): Promise<T> {
  const doFetch = options.fetch ?? fetch;
  const retries = options.retries ?? 2;
  let lastError: ModelProviderError | null = null;
  let serverDelayMs: number | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Honour the server's requested wait (rate limits are often per minute), else back off 1s, 2s, ...
    if (attempt > 0) await sleep(serverDelayMs ?? 1000 * 2 ** (attempt - 1), options.signal);
    serverDelayMs = null;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...options.headers },
        body: JSON.stringify(body),
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
      });
    } catch (error) {
      if (options.signal.aborted) throw error;
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      lastError = new ModelProviderError(
        "unavailable",
        timedOut ? `${options.label} did not respond within ${options.timeoutMs} ms.` : `${options.label} is not reachable at ${new URL(url).origin}.`,
      );
      continue;
    }

    if (res.ok) {
      try {
        return (await res.json()) as T;
      } catch {
        throw new ModelProviderError("unavailable", `${options.label} returned a response that is not JSON.`);
      }
    }

    const raw = await res.text().catch(() => "");
    const detail = raw.replace(/\s+/g, " ").slice(0, 200);
    const error = classifyStatus(res.status, options.label, detail);
    if (res.status === 408 || res.status === 429 || res.status >= 500) {
      lastError = error;
      serverDelayMs = retryDelayFromResponse(res, raw);
      continue;
    }
    throw error;
  }
  throw lastError ?? new ModelProviderError("unavailable", `${options.label} request failed.`);
}

const MAX_SERVER_DELAY_MS = 30_000;

/**
 * Reads how long the server asked us to wait: the standard Retry-After header
 * (seconds), or Google's RetryInfo detail ("retryDelay": "17s"). Capped so one
 * call cannot stall a run; the run deadline still cancels the wait.
 */
export function retryDelayFromResponse(res: Response, body: string): number | null {
  const header = Number(res.headers.get("retry-after"));
  const seconds = Number.isFinite(header) && header > 0 ? header : Number(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body)?.[1]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds * 1000), MAX_SERVER_DELAY_MS) : null;
}

function classifyStatus(status: number, label: string, detail: string): ModelProviderError {
  if (status === 401 || status === 403) return new ModelProviderError("auth", `${label} rejected the API key (HTTP ${status}).`);
  if (status === 429) return new ModelProviderError("rate_limited", `${label} rate limit or quota exceeded (after retries).`);
  if (status >= 500 || status === 408) return new ModelProviderError("unavailable", `${label} is unavailable (HTTP ${status}, after retries).`);
  return new ModelProviderError("bad_request", `${label} rejected the request (HTTP ${status}): ${detail}`);
}
