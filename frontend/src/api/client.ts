/**
 * The single place this application talks to the backend.
 *
 * Every response is typed against the real contract, every failure is normalised into an
 * `ApiFailure` so views can render the *specific* thing that went wrong, and the request
 * id / model version response headers are captured so they can be shown to an operator.
 *
 * Two deliberate properties:
 *  - The base URL comes from the environment (VITE_API_BASE_URL), never from a hardcoded
 *    constant, so local/staging/production differ by configuration only.
 *  - No privileged credential lives here. The console is a read-only surface; the admin
 *    token exists only in the deployment environment and is never sent by this client.
 */
import type {
  ApiFailure,
  ApiFailureKind,
  ErrorEnvelope,
  HealthResponse,
  MetricSample,
  HistogramSnapshot,
  ModelInfo,
  MonitoringSummary,
  ParsedMetrics,
  PredictResponse,
  Prediction,
  ReadyResponse,
} from "./types";

/** Default per-request budget. Generous, because a cold-started instance is slow once. */
const DEFAULT_TIMEOUT_MS = 20_000;

function resolveBaseUrl(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

export const API_BASE_URL = resolveBaseUrl();

/** True when no backend URL was configured at build time — the UI says so explicitly. */
export const API_CONFIGURED = API_BASE_URL.length > 0;

export class ApiError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = "ApiError";
    this.failure = failure;
  }
}

export interface RequestMeta {
  requestId: string | null;
  modelVersion: string | null;
  /** Round-trip time measured by the browser, not the server's self-reported latency. */
  roundTripMs: number;
}

export interface ApiResult<T> {
  data: T;
  meta: RequestMeta;
}

function classify(status: number, envelopeType: string | null): ApiFailureKind {
  if (envelopeType === "payload_too_large") return "oversized";
  if (envelopeType === "validation_error") return "validation";
  if (envelopeType === "unauthorized") return "unauthorized";
  if (envelopeType === "model_not_loaded" || envelopeType === "service_unavailable") {
    return "unavailable";
  }
  if (status === 413) return "oversized";
  if (status === 422) return "validation";
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 503) return "unavailable";
  if (status >= 500) return "server";
  return "server";
}

function failureFromBody(status: number, body: unknown, fallback: string): ApiFailure {
  const envelope = body as Partial<ErrorEnvelope> | null;
  const error = envelope?.error;
  if (error && typeof error.type === "string") {
    return {
      kind: classify(status, error.type),
      status,
      type: error.type,
      message: error.message || fallback,
      requestId: envelope?.request_id ?? null,
      details: Array.isArray(error.details) ? error.details : [],
    };
  }
  return {
    kind: classify(status, null),
    status,
    type: null,
    message: fallback,
    requestId: null,
    details: [],
  };
}

/**
 * Issue a request and normalise everything that can go wrong.
 *
 * `parse` receives the raw body so a caller can take text (the Prometheus exposition)
 * as well as JSON.
 */
async function request<T>(
  path: string,
  init: RequestInit,
  parse: (response: Response) => Promise<T>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ApiResult<T>> {
  if (!API_CONFIGURED) {
    throw new ApiError({
      kind: "transport",
      status: null,
      type: "unconfigured",
      message:
        "No backend URL is configured. Set VITE_API_BASE_URL at build time (see frontend/.env.example).",
      requestId: null,
      details: [],
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { Accept: "application/json", ...(init.headers ?? {}) },
    });
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    throw new ApiError({
      kind: aborted ? "timeout" : "transport",
      status: null,
      type: aborted ? "timeout" : "network_error",
      message: aborted
        ? `The backend did not respond within ${Math.round(timeoutMs / 1000)}s.`
        : `Could not reach the backend at ${API_BASE_URL}. It may be starting up, or the URL may be wrong.`,
      requestId: null,
      details: [],
    });
  } finally {
    clearTimeout(timer);
  }

  const roundTripMs = performance.now() - started;
  const meta: RequestMeta = {
    requestId: response.headers.get("X-Request-ID"),
    modelVersion: response.headers.get("X-Model-Version"),
    roundTripMs,
  };

  if (!response.ok) {
    let body: unknown = null;
    let text = "";
    try {
      text = await response.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    throw new ApiError(
      failureFromBody(
        response.status,
        body,
        text?.slice(0, 300) || `Request failed with status ${response.status}.`,
      ),
    );
  }

  return { data: await parse(response), meta };
}

async function asJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function asText(response: Response): Promise<string> {
  return await response.text();
}

// ------------------------------------------------------------------------- metrics --

/**
 * Parse the Prometheus exposition format into the pieces this console displays.
 *
 * A small hand-written parser rather than a parser dependency: the exposition is a line
 * format and this keeps the bundle small and the behaviour inspectable. Histograms are
 * assembled from `_bucket`/`_sum`/`_count` families, which is what makes the latency and
 * prediction distributions real rather than decorative.
 */
export function parsePrometheus(text: string): ParsedMetrics {
  const counters: Record<string, MetricSample[]> = {};
  const gauges: Record<string, MetricSample[]> = {};
  const histogramParts: Record<
    string,
    { buckets: Array<{ le: number; count: number }>; sum: number; count: number }
  > = {};

  const labelRe = /(\w+)="((?:[^"\\]|\\.)*)"/g;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const spaceAt = line.lastIndexOf(" ");
    if (spaceAt < 0) continue;
    const series = line.slice(0, spaceAt);
    const valueLiteral = line.slice(spaceAt + 1).trim();
    const value = Number(valueLiteral);
    if (!Number.isFinite(value)) continue;

    const braceAt = series.indexOf("{");
    const name = braceAt < 0 ? series : series.slice(0, braceAt);
    const labels: Record<string, string> = {};
    if (braceAt >= 0) {
      const labelBlock = series.slice(braceAt);
      for (const match of labelBlock.matchAll(labelRe)) {
        const key = match[1];
        const raw = match[2];
        if (key === undefined || raw === undefined) continue;
        labels[key] = raw.replace(/\\(.)/g, "$1");
      }
    }

    if (name.endsWith("_bucket")) {
      const base = name.slice(0, -"_bucket".length);
      const le = Number(labels.le);
      histogramParts[base] ??= { buckets: [], sum: 0, count: 0 };
      if (Number.isFinite(le)) histogramParts[base].buckets.push({ le, count: value });
      continue;
    }
    if (name.endsWith("_sum")) {
      const base = name.slice(0, -"_sum".length);
      histogramParts[base] ??= { buckets: [], sum: 0, count: 0 };
      histogramParts[base].sum = value;
      continue;
    }
    if (name.endsWith("_count")) {
      const base = name.slice(0, -"_count".length);
      histogramParts[base] ??= { buckets: [], sum: 0, count: 0 };
      histogramParts[base].count = value;
      continue;
    }

    const sample: MetricSample = { labels, value };
    const bucket = name.endsWith("_total") ? counters : gauges;
    bucket[name] ??= [];
    bucket[name].push(sample);
  }

  const histograms: Record<string, HistogramSnapshot[]> = {};
  for (const [base, parts] of Object.entries(histogramParts)) {
    if (parts.buckets.length === 0) continue;
    histograms[base] = [
      {
        buckets: parts.buckets.sort((a, b) => a.le - b.le),
        sum: parts.sum,
        count: parts.count,
      },
    ];
  }

  return { counters, gauges, histograms, raw: text };
}

// --------------------------------------------------------------------------- client --

export const api = {
  baseUrl: API_BASE_URL,

  health: () => request<HealthResponse>("/health", { method: "GET" }, asJson),

  ready: () => request<ReadyResponse>("/ready", { method: "GET" }, asJson),

  modelInfo: () => request<ModelInfo>("/model-info", { method: "GET" }, asJson),

  monitoringSummary: (windowSeconds?: number) => {
    const query = typeof windowSeconds === "number" ? `?window_seconds=${windowSeconds}` : "";
    return request<MonitoringSummary>(
      `/monitoring/summary${query}`,
      { method: "GET" },
      asJson,
    );
  },

  metrics: async (): Promise<ApiResult<ParsedMetrics>> => {
    const result = await request<string>("/metrics", { method: "GET" }, asText);
    return { data: parsePrometheus(result.data), meta: result.meta };
  },

  predict: (records: Array<Record<string, unknown>>, requestId?: string) =>
    request<PredictResponse>(
      "/predict",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(requestId ? { "X-Request-ID": requestId } : {}),
        },
        body: JSON.stringify({ records }),
      },
      asJson,
    ),

  /** The OpenAPI document, used by the API view to count the real endpoint inventory. */
  openapi: () =>
    request<{ paths: Record<string, unknown>; info?: { title?: string; version?: string } }>(
      "/openapi.json",
      { method: "GET" },
      asJson,
    ),
};

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** A one-line, UI-safe summary of any thrown value. */
export function describeError(error: unknown): ApiFailure {
  if (isApiError(error)) return error.failure;
  return {
    kind: "server",
    status: null,
    type: null,
    message: error instanceof Error ? error.message : String(error),
    requestId: null,
    details: [],
  };
}

export type PredictOutcome = {
  predictions: Prediction[];
  requestId: string;
  modelVersion: string;
  serverLatencyMs: number;
  roundTripMs: number;
};
