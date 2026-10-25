import { useCallback, useEffect, useRef, useState } from "react";

export interface Resource<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads data and, while `pollWhile(data)` is true, re-fetches every
 * `intervalMs`. Progress in the UI always comes from real backend state.
 */
export function useResource<T>(
  load: () => Promise<T>,
  deps: unknown[],
  options: { intervalMs?: number; pollWhile?: (data: T) => boolean } = {},
): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fetchOnce = async () => {
      try {
        const result = await loadRef.current();
        if (cancelled) return;
        setData(result);
        setError(null);
        const { pollWhile, intervalMs = 1500 } = optionsRef.current;
        if (pollWhile?.(result)) timer = setTimeout(fetchOnce, intervalMs);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        // Keep polling through transient errors if we were polling before.
        if (optionsRef.current.pollWhile) timer = setTimeout(fetchOnce, 5000);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    void fetchOnce();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Re-renders every `ms` so relative times and elapsed timers stay fresh. */
export function useNow(ms: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
  return now;
}

/**
 * Reveals a long list `pageSize` items at a time. Keeps rendering cheap for
 * large histories and mirrors the shape of future server-side pagination.
 */
export function useIncremental<T>(items: readonly T[], pageSize: number) {
  const [limit, setLimit] = useState(pageSize);
  const visible = items.length > limit ? items.slice(0, limit) : items;
  const showMore = useCallback(() => setLimit((l) => l + pageSize), [pageSize]);
  return { visible, remaining: Math.max(0, items.length - limit), showMore };
}
