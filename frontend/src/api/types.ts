/**
 * The backend contract, transcribed from the FastAPI response models
 * (src/mlserve/serving/schemas.py). These are the *actual* shapes the service returns --
 * if one drifts, the console shows a type error rather than inventing a number.
 */

/** GET /health — 200 whenever the process is alive, even with no model loaded. */
export interface HealthResponse {
  status: "ok" | "degraded";
  model_loaded: boolean;
  model_version: string | null;
  uptime_seconds: number;
  version: string;
}

/** GET /ready — 200 body when a model is actually servable. */
export interface ReadyResponse {
  status: "ready";
  model_version: string;
}

/** The documented error envelope every non-2xx response uses. */
export interface ErrorDetail {
  type: string;
  message: string;
  details: Array<Record<string, unknown>>;
}

export interface ErrorEnvelope {
  request_id: string;
  error: ErrorDetail;
}

/** GET /model-info — provenance of the model currently being served. */
export interface ModelInfo {
  model_name: string;
  model_version: string;
  model_alias: string | null;
  model_source: "registry" | "file" | string;
  run_id: string | null;
  dataset_version: string | null;
  code_version: string | null;
  git_commit: string | null;
  training_fingerprint: string | null;
  loaded_at: string;
  load_seconds: number;
  input_columns: string[];
  model_features: string[];
  metrics: Record<string, number>;
}

/** One scored record. */
export interface Prediction {
  probability: number;
  prediction: number;
  label: string;
}

/** POST /predict — one response for the whole batch. */
export interface PredictResponse {
  request_id: string;
  model_name: string;
  model_version: string;
  model_alias: string | null;
  threshold: number;
  n_records: number;
  predictions: Prediction[];
  latency_ms: number;
}

/**
 * GET /monitoring/summary — the operational snapshot read from the prediction store.
 * `enabled: false` means the service is running without a monitoring store; the console
 * renders that state rather than an empty chart.
 */
export interface MonitoringSummary {
  enabled: boolean;
  window_seconds?: number | null;
  n_predictions?: number;
  mean_probability?: number | null;
  min_probability?: number | null;
  max_probability?: number | null;
  mean_latency_ms?: number | null;
  by_model_version?: Record<string, number>;
  events?: Record<string, number>;
  uptime_seconds: number;
  served_model_version: string | null;
}

/** A single Prometheus sample: the label set plus its value. */
export interface MetricSample {
  labels: Record<string, string>;
  value: number;
}

/** A parsed histogram: cumulative buckets plus the sum/count pair. */
export interface HistogramSnapshot {
  buckets: Array<{ le: number; count: number }>;
  sum: number;
  count: number;
}

/** The subset of the Prometheus exposition this console reads. */
export interface ParsedMetrics {
  counters: Record<string, MetricSample[]>;
  gauges: Record<string, MetricSample[]>;
  histograms: Record<string, HistogramSnapshot[]>;
  /** Bytes of exposition parsed, so the UI can show it is reading something real. */
  raw: string;
}

/**
 * A failed request, normalised.
 *
 * The frontend's job is to make a failure legible, which the backend supports by
 * returning a structured envelope for every non-2xx. `kind` is the classification the UI
 * renders differently (validation vs oversized vs unavailable vs server vs transport).
 */
export type ApiFailureKind =
  | "validation"
  | "oversized"
  | "unavailable"
  | "unauthorized"
  | "server"
  | "not_found"
  | "transport"
  | "timeout";

export interface ApiFailure {
  kind: ApiFailureKind;
  status: number | null;
  /** The structured error type from the envelope, when the backend produced one. */
  type: string | null;
  message: string;
  requestId: string | null;
  details: Array<Record<string, unknown>>;
}
