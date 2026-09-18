/**
 * View 5 — Platform / API.
 *
 * The engineering surface: the endpoint inventory read from the service's own OpenAPI
 * document (not a hand-maintained list that drifts), the health/readiness semantics the
 * deployment depends on, the runtime facts that are safe to publish, and the security
 * posture — including the deliberate statement that this console holds no privileged
 * credential.
 */
import { api, API_BASE_URL, API_CONFIGURED } from "../api/client";
import { usePolling, useNow } from "../api/hooks";
import { AppShell } from "../components/AppShell";
import {
  Alert,
  Badge,
  EmptyState,
  ErrorState,
  KeyValues,
  Panel,
  SkeletonLines,
  Stat,
} from "../components/ui";
import { headlineFor, useServiceState } from "../state/service";
import { bytes, duration, fixed, num, relative, seconds } from "../lib/format";

const POLL_MS = 15_000;

/** How each documented route behaves, keyed by the OpenAPI path. */
const ROUTE_NOTES: Record<string, { purpose: string; auth: "public" | "admin" }> = {
  "/health": { purpose: "Liveness. 200 whenever the process is alive, even with no model.", auth: "public" },
  "/ready": {
    purpose: "Readiness. 200 only when a model is loadable; 503 model_not_loaded otherwise. This is what gates deploy traffic.",
    auth: "public",
  },
  "/model-info": { purpose: "Provenance of the served model.", auth: "public" },
  "/predict": { purpose: "Batch scoring, up to the configured maximum batch size.", auth: "public" },
  "/metrics": { purpose: "Prometheus exposition of counters, histograms and gauges.", auth: "public" },
  "/monitoring/summary": {
    purpose: "Rolling window snapshot from the prediction store.",
    auth: "public",
  },
  "/admin/reload": {
    purpose: "Re-resolve the registry alias and hot-swap the model. Requires the admin token in a deployment.",
    auth: "admin",
  },
};

export default function Platform() {
  const service = useServiceState(POLL_MS);
  const openapi = usePolling(
    async () => {
      const result = await api.openapi();
      return result.data;
    },
    { intervalMs: 0 },
  );
  const metrics = usePolling(() => api.metrics().then((result) => result.data), {
    intervalMs: POLL_MS,
  });
  const now = useNow(1000);

  const routes = Object.entries(openapi.data?.paths ?? {})
    .map(([path, methods]) => ({
      path,
      methods: Object.keys(methods as Record<string, unknown>).map((method) => method.toUpperCase()),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const rss = metrics.data?.gauges["mlserve_resource_rss_bytes"]?.[0]?.value;
  const cpu = metrics.data?.gauges["mlserve_resource_cpu_percent"]?.[0]?.value;
  const modelLoadedGauge = metrics.data?.gauges["mlserve_model_loaded"]?.[0]?.value;
  const loadSeconds = metrics.data?.gauges["mlserve_model_load_seconds"]?.[0]?.value;
  const counterFamilies = Object.keys(metrics.data?.counters ?? {}).length;
  const histogramFamilies = Object.keys(metrics.data?.histograms ?? {}).length;
  const gaugeFamilies = Object.keys(metrics.data?.gauges ?? {}).length;

  return (
    <AppShell
      title="Platform / API"
      subtitle="Endpoint inventory, runtime facts and the security posture of this console"
      headline={headlineFor(service)}
      actions={
        <span className="faint small mono">
          {metrics.updatedAt ? `metrics ${relative(metrics.updatedAt, now)}` : "reading metrics…"}
        </span>
      }
    >
      {!API_CONFIGURED && (
        <Alert tone="danger" title="This build has no backend URL">
          <code>VITE_API_BASE_URL</code> was empty at build time, so the console cannot reach any
          API. Rebuild with the backend base URL set.
        </Alert>
      )}

      <div className="grid grid--stats">
        <Stat
          label="API base"
          value={API_CONFIGURED ? API_BASE_URL.replace(/^https?:\/\//, "") : "not configured"}
          small
          foot={<span>build-time configuration</span>}
        />
        <Stat
          label="Liveness"
          value={service.health?.status ?? "—"}
          tone={service.health?.status === "ok" ? "ok" : service.health ? "warn" : "danger"}
          foot={<span>GET /health</span>}
        />
        <Stat
          label="Readiness"
          value={service.ready_ ? "ready" : service.loading ? "checking" : "not ready"}
          tone={service.ready_ ? "ok" : service.loading ? undefined : "warn"}
          foot={<span>GET /ready — the deploy gate</span>}
        />
        <Stat
          label="Endpoints"
          value={routes.length > 0 ? String(routes.length) : "—"}
          foot={<span>from the service's OpenAPI document</span>}
        />
        <Stat
          label="Process uptime"
          value={duration(service.health?.uptime_seconds)}
          foot={<span>since this instance started</span>}
        />
        <Stat
          label="Service version"
          value={service.health?.version ?? "—"}
          small
          foot={<span>reported by /health</span>}
        />
      </div>

      <Panel
        title="Endpoint inventory"
        hint={openapi.data?.info?.title ?? "read from /openapi.json"}
        actions={
          API_CONFIGURED ? (
            <a className="btn btn--ghost btn--sm" href={`${API_BASE_URL}/docs`} target="_blank" rel="noreferrer">
              open Swagger UI ↗
            </a>
          ) : null
        }
      >
        {openapi.loading && !openapi.data ? (
          <SkeletonLines lines={6} />
        ) : openapi.failure && !openapi.data ? (
          <ErrorState
            title="Could not read the OpenAPI document"
            body={openapi.failure.message}
            hint="Served by FastAPI at /openapi.json; some deployments disable it."
          />
        ) : routes.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Path</th>
                <th>Methods</th>
                <th>Access</th>
                <th>Behaviour</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => {
                const note = ROUTE_NOTES[route.path];
                return (
                  <tr key={route.path}>
                    <td className="mono">{route.path}</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {route.methods.map((method) => (
                          <Badge key={method} tone="muted">
                            {method}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td>
                      {note ? (
                        <Badge tone={note.auth === "admin" ? "warn" : "ok"}>{note.auth}</Badge>
                      ) : (
                        <Badge tone="muted">undocumented here</Badge>
                      )}
                    </td>
                    <td>{note?.purpose ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState title="No endpoints reported" body="The service returned an empty OpenAPI document." />
        )}
      </Panel>

      <div className="grid grid--halves">
        <Panel title="Health semantics" hint="the distinction the deployment relies on">
          <KeyValues
            items={[
              { key: "health", label: "/health", value: service.health?.status ?? "no response" },
              {
                key: "loaded",
                label: "model_loaded",
                value: String(service.health?.model_loaded ?? "—"),
              },
              { key: "ready", label: "/ready", value: service.ready_ ? "200 ready" : "503 not ready" },
              { key: "version", label: "Served version", value: service.model?.model_version ?? "—" },
              { key: "uptime", label: "Uptime", value: duration(service.health?.uptime_seconds) },
            ]}
          />
          <p className="faint small" style={{ marginTop: 14 }}>
            A process with no model reports <strong>alive but not ready</strong>: <code>/health</code>{" "}
            returns 200 with <code>status: degraded</code> so an orchestrator will not restart a
            healthy process over an empty registry, while <code>/ready</code> answers 503 so no
            traffic is routed to an instance that cannot answer. Render's health check is pointed at{" "}
            <code>/ready</code> for exactly this reason.
          </p>
        </Panel>

        <Panel title="Runtime" hint="mlserve_resource_* and model load gauges">
          {metrics.loading && !metrics.data ? (
            <SkeletonLines lines={5} />
          ) : metrics.data ? (
            <>
              <KeyValues
                items={[
                  { key: "rss", label: "Resident memory", value: bytes(rss) },
                  { key: "cpu", label: "CPU", value: cpu != null ? `${fixed(cpu, 1)}%` : "—" },
                  {
                    key: "model-loaded",
                    label: "model_loaded gauge",
                    value: modelLoadedGauge != null ? String(modelLoadedGauge) : "—",
                  },
                  {
                    key: "load-seconds",
                    label: "Last load",
                    value: loadSeconds != null ? seconds(loadSeconds) : "—",
                  },
                  {
                    key: "families",
                    label: "Metric families",
                    value: `${counterFamilies} counters · ${histogramFamilies} histograms · ${gaugeFamilies} gauges`,
                  },
                  { key: "exposition", label: "Exposition size", value: bytes(metrics.data.raw.length) },
                ]}
              />
              <details style={{ marginTop: 14 }}>
                <summary className="faint small" style={{ cursor: "pointer" }}>
                  show the first lines of the exposition
                </summary>
                <pre className="code-block mono" style={{ marginTop: 10 }}>
                  {metrics.data.raw.split("\n").slice(0, 28).join("\n")}
                </pre>
              </details>
            </>
          ) : (
            <ErrorState title="No metrics" body={metrics.failure?.message ?? "No metrics were returned."} />
          )}
        </Panel>
      </div>

      <Panel title="Security posture" hint="what this console can and cannot do">
        <div className="stack">
          <Alert tone="ok" title="This console holds no privileged credential">
            It is a read-only surface over public endpoints and cannot promote, roll back or reload a
            model. The admin token exists only in the deployment environment; it is never built into
            this bundle, never stored in the browser and never sent by this client. Anything prefixed{" "}
            <code>VITE_</code> is inlined into the public bundle, so no secret is placed there — the
            CI pipeline greps the built output to enforce that.
          </Alert>
          <Alert tone="info" title="CORS is an allow-list, not a wildcard">
            The backend accepts cross-origin requests only from the origins configured at deploy time
            (<code>MLSERVE_CORS_ORIGINS</code>) and exposes just the correlation and model-version
            headers. A request from an unlisted origin is refused by the browser before it is read,
            and the deployment verifier asserts both directions: the frontend origin is allowed, an
            unlisted origin is not.
          </Alert>
          <Alert tone="warn" title="Admin operations stay out of the browser by design">
            <code>POST /admin/reload</code> requires <code>X-Admin-Token</code> (or a bearer token)
            when a deployment sets one, and answers <code>401</code> with a structured envelope
            otherwise. It is intentionally not wired to a button here: making the browser a
            privileged operations console would mean shipping a credential to every visitor.
          </Alert>
          <Alert tone="info" title="Operational limits worth knowing">
            Storage is SQLite and filesystem-backed on a single instance with a persistent disk, so
            the deployment runs one instance and does not claim horizontal scaling or zero-downtime
            releases. Telemetry is aggregated rather than stored per request, so there is no
            historical time series. These are properties of the architecture, not oversights — they
            are documented rather than papered over.
          </Alert>
        </div>
      </Panel>

      <Panel title="Deployment context" hint="what this instance is and is not">
        <KeyValues
          items={[
            { key: "base", label: "API base URL", value: API_CONFIGURED ? API_BASE_URL : "—" },
            { key: "docs", label: "OpenAPI docs", value: API_CONFIGURED ? `${API_BASE_URL}/docs` : "—" },
            { key: "metrics", label: "Metrics endpoint", value: API_CONFIGURED ? `${API_BASE_URL}/metrics` : "—" },
            {
              key: "uptime",
              label: "Uptime",
              value: `${duration(service.health?.uptime_seconds)} (${num(service.health?.uptime_seconds)}s)`,
            },
            { key: "polled", label: "Last poll", value: relative(service.updatedAt, now) },
          ]}
        />
      </Panel>
    </AppShell>
  );
}
