/**
 * The platform's shared liveness view.
 *
 * Every screen needs the same three answers — is the process alive, can it serve, and
 * which model is it serving — so they are fetched once here and share one polling cadence
 * per consumer rather than each view inventing its own.
 *
 * The distinction the backend draws is preserved exactly:
 *   `/health`  → 200 even with no model loaded; `status: "degraded"` says "alive, idle".
 *   `/ready`   → 503 with a `model_not_loaded` envelope when nothing can be served.
 * The console therefore shows *two* facts, never one blended "up/down".
 */
import { useCallback } from "react";
import { api, describeError } from "../api/client";
import { usePolling } from "../api/hooks";
import type { ApiFailure, HealthResponse, ModelInfo, ReadyResponse } from "../api/types";
import type { ServiceHeadline } from "../components/AppShell";

export interface ServiceState {
  health: HealthResponse | null;
  ready: ReadyResponse | null;
  model: ModelInfo | null;
  /** The first failure encountered, kept even if a later poll succeeds. */
  failure: ApiFailure | null;
  loading: boolean;
  refreshing: boolean;
  updatedAt: number | null;
  refresh: () => void;
  /** /ready answered 200: a model is loadable and the instance is taking traffic. */
  ready_: boolean;
  /** /health answered 200 but no model is loaded: alive and idle. */
  degraded: boolean;
  /** Neither endpoint answered: the API is unreachable from the browser. */
  unreachable: boolean;
}

export function useServiceState(intervalMs = 0): ServiceState {
  const healthPoll = usePolling(() => api.health().then((result) => result.data), { intervalMs });
  const readyPoll = usePolling(
    async () => {
      // /ready is 503 when degraded. That is a legitimate state, not a transport error,
      // so it is captured as data (and its envelope read for the reason) rather than
      // thrown away as a failure.
      const result = await api.ready();
      return result.data;
    },
    { intervalMs },
  );
  const modelPoll = usePolling(
    async () => {
      try {
        const result = await api.modelInfo();
        return result.data;
      } catch (error) {
        // A 503 here simply means no model is loaded; that is reported by /health.
        const failure = describeError(error);
        if (failure.kind === "unavailable") return null;
        throw error;
      }
    },
    { intervalMs },
  );

  const refresh = useCallback(() => {
    healthPoll.refresh();
    readyPoll.refresh();
    modelPoll.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [healthPoll.refresh, readyPoll.refresh, modelPoll.refresh]);

  const anyLoading = healthPoll.loading || readyPoll.loading || modelPoll.loading;
  const ready_ =
    readyPoll.data !== null ||
    Boolean(healthPoll.data?.model_loaded) ||
    Boolean(modelPoll.data);
  const degraded =
    (healthPoll.data?.status === "degraded" || readyPoll.failure?.kind === "unavailable") &&
    !ready_;
  const unreachable =
    !anyLoading &&
    !ready_ &&
    !healthPoll.data &&
    (healthPoll.failure?.kind === "transport" || healthPoll.failure?.kind === "timeout");

  return {
    health: healthPoll.data,
    ready: readyPoll.data,
    model: modelPoll.data,
    failure: healthPoll.failure ?? readyPoll.failure ?? modelPoll.failure,
    loading: anyLoading,
    refreshing: healthPoll.refreshing || readyPoll.refreshing || modelPoll.refreshing,
    updatedAt: healthPoll.updatedAt,
    refresh,
    ready_,
    degraded,
    unreachable,
  };
}

export function headlineFor(state: ServiceState): ServiceHeadline {
  if (state.loading) return { tone: "muted", label: "connecting…" };
  if (state.ready_) {
    return {
      tone: "ok",
      label: state.model?.model_version
        ? `serving ${state.model.model_version}`
        : "ready",
      detail: state.model?.model_alias ? `alias ${state.model.model_alias}` : undefined,
    };
  }
  if (state.unreachable) {
    return {
      tone: "danger",
      label: "API unreachable",
      detail: state.failure?.message,
    };
  }
  if (state.health?.status === "degraded") {
    return {
      tone: "warn",
      label: "degraded · no model",
      detail: state.failure?.message ?? "The process is alive but cannot serve predictions.",
    };
  }
  return { tone: "danger", label: "not ready", detail: state.failure?.message };
}
