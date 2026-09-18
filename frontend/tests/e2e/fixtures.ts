/**
 * Backend stubs for the browser tests.
 *
 * The payloads mirror the real response models in src/mlserve/serving/schemas.py field for
 * field. Keeping them faithful is the point: if the console only worked against a loosely
 * shaped mock, the test would prove nothing about the deployed system.
 */
import type { Page, Route } from "@playwright/test";

export const API_ORIGIN = "http://127.0.0.1:8077";

export const HEALTH_OK = {
  status: "ok",
  model_loaded: true,
  model_version: "1",
  uptime_seconds: 512.4,
  version: "0.1.0",
};

export const HEALTH_DEGRADED = {
  status: "degraded",
  model_loaded: false,
  model_version: null,
  uptime_seconds: 12.75,
  version: "0.1.0",
};

export const READY_OK = { status: "ready", model_version: "1" };

export const MODEL_INFO = {
  model_name: "adult-income-classifier",
  model_version: "1",
  model_alias: "production",
  model_source: "registry",
  run_id: "6fd6d925552445ceb53a5fe5dc9af2a9",
  dataset_version: "adult-ingest-2-975c90344d56",
  code_version: "fa158c51a2a5",
  git_commit: "b209d19",
  training_fingerprint: "54122c6ae1215984557601e70e885b48e140668effbfbadc5ea9418ca76b797a",
  loaded_at: "2026-09-18T12:00:00+00:00",
  load_seconds: 1.742,
  input_columns: [
    "age",
    "workclass",
    "education_num",
    "marital_status",
    "occupation",
    "relationship",
    "race",
    "sex",
    "capital_gain",
    "capital_loss",
    "hours_per_week",
    "native_country",
  ],
  model_features: ["age", "education_num", "capital_gain", "capital_loss", "hours_per_week"],
  metrics: { roc_auc: 0.926784, accuracy: 0.872059, pr_auc: 0.736 },
};

export const PREDICT_OK = {
  request_id: "0f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
  model_name: "adult-income-classifier",
  model_version: "1",
  model_alias: "production",
  threshold: 0.5,
  n_records: 1,
  predictions: [{ probability: 0.1834, prediction: 0, label: "<=50K" }],
  latency_ms: 4.31,
};

export const VALIDATION_ENVELOPE = {
  request_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  error: {
    type: "validation_error",
    message: "the request payload violates the data contract (1 error(s))",
    details: [
      { location: "records.0.age", message: "Input should be less than or equal to 90", type: "less_than_equal" },
    ],
  },
};

export const UNAVAILABLE_ENVELOPE = {
  request_id: "11111111-2222-3333-4444-555555555555",
  error: { type: "model_not_loaded", message: "no model is loaded", details: [] },
};

export const MONITORING_SUMMARY = {
  enabled: true,
  window_seconds: null,
  n_predictions: 1119,
  mean_probability: 0.2418,
  min_probability: 0.0012,
  max_probability: 0.9871,
  mean_latency_ms: 3.68,
  by_model_version: { "1": 1119 },
  events: { validation_error: 3, payload_too_large: 1 },
  uptime_seconds: 512.4,
  served_model_version: "1",
};

const METRICS_TEXT = [
  "# HELP mlserve_requests_total Total requests by endpoint and status",
  "# TYPE mlserve_requests_total counter",
  'mlserve_requests_total{endpoint="/predict",status="200"} 1119',
  'mlserve_requests_total{endpoint="/health",status="200"} 42',
  "# TYPE mlserve_errors_total counter",
  'mlserve_errors_total{endpoint="/predict",error_type="validation_error"} 3',
  "# TYPE mlserve_request_latency_seconds histogram",
  "mlserve_request_latency_seconds_bucket{le=\"0.005\"} 900",
  "mlserve_request_latency_seconds_bucket{le=\"0.01\"} 1050",
  "mlserve_request_latency_seconds_bucket{le=\"0.025\"} 1100",
  "mlserve_request_latency_seconds_bucket{le=\"0.05\"} 1119",
  'mlserve_request_latency_seconds_bucket{le="+Inf"} 1119',
  "mlserve_request_latency_seconds_sum 4.12",
  "mlserve_request_latency_seconds_count 1119",
  "# TYPE mlserve_prediction_score histogram",
  'mlserve_prediction_score_bucket{le="0.05"} 620',
  'mlserve_prediction_score_bucket{le="0.2"} 810',
  'mlserve_prediction_score_bucket{le="0.5"} 990',
  'mlserve_prediction_score_bucket{le="1.0"} 1119',
  "mlserve_prediction_score_sum 270.4",
  "mlserve_prediction_score_count 1119",
  "# TYPE mlserve_model_info gauge",
  'mlserve_model_info{alias="production",model_name="adult-income-classifier",model_version="1"} 1',
  "# TYPE mlserve_model_loaded gauge",
  "mlserve_model_loaded 1",
  "# TYPE mlserve_model_load_seconds gauge",
  "mlserve_model_load_seconds 1.742",
  "# TYPE mlserve_resource_rss_bytes gauge",
  "mlserve_resource_rss_bytes 283115520",
  "# TYPE mlserve_resource_cpu_percent gauge",
  "mlserve_resource_cpu_percent 2.4",
  "",
].join("\n");

const OPENAPI = {
  info: { title: "mlserve - Adult income classifier", version: "0.1.0" },
  paths: {
    "/health": { get: {} },
    "/ready": { get: {} },
    "/model-info": { get: {} },
    "/predict": { post: {} },
    "/metrics": { get: {} },
    "/monitoring/summary": { get: {} },
    "/admin/reload": { post: {} },
  },
};

export interface MockOptions {
  health?: unknown;
  readyStatus?: number;
  readyBody?: unknown;
  modelInfo?: unknown | null;
  modelInfoStatus?: number;
  predict?: { status: number; body: unknown };
  metrics?: string;
  monitoring?: unknown;
  /** Fail every API call at the network layer, simulating an unreachable backend. */
  offline?: boolean;
}

/**
 * Install the API stubs. Individual tests override only what they are about, so each test
 * states its own premise.
 */
export async function mockApi(page: Page, options: MockOptions = {}): Promise<void> {
  const {
    health = HEALTH_OK,
    readyStatus = 200,
    readyBody = READY_OK,
    modelInfo = MODEL_INFO,
    modelInfoStatus = 200,
    predict = { status: 200, body: PREDICT_OK },
    metrics = METRICS_TEXT,
    monitoring = MONITORING_SUMMARY,
    offline = false,
  } = options;

  await page.route(`${API_ORIGIN}/**`, async (route: Route) => {
    if (offline) {
      await route.abort("connectionrefused");
      return;
    }

    const url = new URL(route.request().url());
    const path = url.pathname;

    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: {
          "X-Request-ID": "test-request-id",
          "X-Model-Version": "1",
          ...headers,
        },
        body: JSON.stringify(body),
      });

    if (path === "/health") return json(200, health);
    if (path === "/ready") return json(readyStatus, readyBody);
    if (path === "/model-info") {
      return modelInfo === null
        ? json(modelInfoStatus, UNAVAILABLE_ENVELOPE)
        : json(200, modelInfo);
    }
    if (path === "/predict") {
      // A record with an out-of-range age simulates the API's own validation, so the test
      // can prove the console renders the *backend's* rejection rather than only its own.
      const payload = route.request().postDataJSON() as { records?: Array<{ age?: number }> } | null;
      const age = payload?.records?.[0]?.age;
      if (typeof age === "number" && (age < 17 || age > 90)) {
        return json(422, VALIDATION_ENVELOPE);
      }
      return json(predict.status, predict.body);
    }
    if (path === "/metrics") {
      return route.fulfill({ status: 200, contentType: "text/plain", body: metrics });
    }
    if (path === "/monitoring/summary") return json(200, monitoring);
    if (path === "/openapi.json") return json(200, OPENAPI);
    return json(404, { request_id: "x", error: { type: "not_found", message: "no such route", details: [] } });
  });
}
