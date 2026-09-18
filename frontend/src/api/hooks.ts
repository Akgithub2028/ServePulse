/**
 * Small data-fetching primitives.
 *
 * Hand-written rather than pulled from a query library: the console has five views, one
 * polling cadence and a handful of endpoints, so a dependency would buy nothing and cost
 * bundle size. What matters is that each one behaves correctly:
 *
 *  - polling pauses while the tab is hidden (no pointless traffic),
 *  - every timer and request is cleaned up on unmount (no leaks, no setState after
 *    unmount),
 *  - a poll that fails does not wipe the last good reading; it is reported alongside it,
 *    because "the last known value plus a fetch error" is what an operator needs.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, describeError } from "./client";
import type { ApiFailure } from "./types";

export interface AsyncState<T> {
  data: T | null;
  failure: ApiFailure | null;
  loading: boolean;
  /** When the current value was received, for "updated Ns ago" labels. */
  updatedAt: number | null;
}

export interface PollingState<T> extends AsyncState<T> {
  /** True while a background refresh is in flight and a previous value is on screen. */
  refreshing: boolean;
  refresh: () => void;
}

/**
 * Fetch once on mount, then every `intervalMs` while the tab is visible.
 *
 * `deps` follows the usual rules; changing them restarts the poll.
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  options: { intervalMs?: number; enabled?: boolean; deps?: unknown[] } = {},
): PollingState<T> {
  const { intervalMs = 0, enabled = true } = options;
  const deps = options.deps ?? [];

  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    failure: null,
    loading: enabled,
    updatedAt: null,
  });
  const [refreshing, setRefreshing] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const mounted = useRef(true);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const value = await fetcherRef.current();
      if (!mounted.current) return;
      setState({ data: value, failure: null, loading: false, updatedAt: Date.now() });
    } catch (error) {
      if (!mounted.current) return;
      // Keep the previous value: an operator should see "stale value + why it is stale"
      // rather than a blank panel.
      setState((previous) => ({
        data: previous.data,
        failure: error instanceof ApiError ? error.failure : describeError(error),
        loading: false,
        updatedAt: previous.updatedAt,
      }));
    } finally {
      inFlight.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) {
      setState({ data: null, failure: null, loading: false, updatedAt: null });
      return;
    }

    void load();

    if (intervalMs <= 0) {
      return () => {
        mounted.current = false;
      };
    }

    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(tick, intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, load, ...deps]);

  return { ...state, refreshing, refresh: () => void load() };
}

/** Run an action on demand (a form submit, a manual refresh) with its own state. */
export function useAction<Args extends unknown[], T>(
  action: (...args: Args) => Promise<T>,
): {
  run: (...args: Args) => Promise<T | null>;
  result: T | null;
  failure: ApiFailure | null;
  pending: boolean;
  reset: () => void;
} {
  const [result, setResult] = useState<T | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args: Args): Promise<T | null> => {
      setPending(true);
      setFailure(null);
      try {
        const value = await action(...args);
        if (mounted.current) setResult(value);
        return value;
      } catch (error) {
        if (mounted.current) {
          setFailure(error instanceof ApiError ? error.failure : describeError(error));
        }
        return null;
      } finally {
        if (mounted.current) setPending(false);
      }
    },
    [action],
  );

  const reset = useCallback(() => {
    setResult(null);
    setFailure(null);
  }, []);

  return { run, result, failure, pending, reset };
}

/** A ticking clock for "updated 4s ago" labels; interval-bound so it stays cheap. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
