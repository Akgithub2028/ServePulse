/**
 * View 1 — Control Room.
 *
 * The landing question is "is this platform healthy?", answered from the live service
 * rather than from cached prose: liveness, readiness, the served model's identity, uptime,
 * browser-observed API responsiveness, the monitoring store's own counters, and the output
 * distribution read out of the Prometheus exposition.
 *
 * Everything on this page comes from an endpoint. Where an endpoint reports that it has no
 * data (fresh instance, monitoring store disabled), the panel says so instead of drawing an
 * empty chart.
 */
import { api } from "../api/client";
import { usePolling, useNow } from "../api/hooks";
import { AppShell } from "../components/AppShell";
import { BucketAxis, DistributionChart, toBuckets } from "../components/charts";
import {
  Alert,
  Badge,
  BarList,
  EmptyState,
  ErrorState,
  KeyValues,
  Panel,
  SkeletonLines,
  Stat,
} from "../components/ui";
import { headlineFor, useServiceState } from "../state/service";
import { bytes, duration, fixed, ms, num, relative, shortId, timestamp } from "../lib/format";

const POLL_MS = 10_000;

export default function ControlRoom() {
  const service = useServiceState(POLL_MS);
  const monitoring = usePolling(() => api.monitoringSummary().then((result) => result.data), {
    intervalMs: POLL_MS,
  });
  // The round-trip time the *browser* observes is worth showing next to the server's own
  // latency figure, so the meta travels with the parsed exposition.
  const metrics = usePolling(
    async () => {
      const result = await api.metrics();
      return { parsed: result.data, roundTripMs: result.meta.roundTripMs };
    },
    { intervalMs: POLL_MS },
  );
  const now = useNow(1000);

  const summary = monitoring.data;
  const metricsData = metrics.data?.parsed;
  const latencyHistogram = metricsData?.histograms["mlserve_request_latency_seconds"]?.[0];
  const scoreHistogram = metricsData?.histograms["mlserve_prediction_score"]?.[0];
  const rss = metricsData?.gauges["mlserve_resource_rss_bytes"]?.[0]?.value;
  const cpu = metricsData?.gauges["mlserve_resource_cpu_percent"]?.[0]?.value;

  const errorCounts = Object.entries(summary?.events ?? {}).filter(([kind]) =>
    [
      "validation_error",
      "payload_too_large",
      "model_not_loaded",
      "inference_error",
      "model_reload_failed",
      "admin_unauthorized",
      "error",
    ].includes(kind),
  );
  const totalErrors = errorCounts.reduce((total, [, count]) => total + count, 0);

  return (
    <AppShell
      title="Control Room"
      subtitle="Live state of the serving platform and the model it is answering with"
      headline={headlineFor(service)}
      actions={
        <>
          {service.updatedAt && (
            <span className="faint small mono">updated {relative(service.updatedAt, now)}</span>
          )}
          <button className="btn btn--ghost btn--sm" onClick={service.refresh} disabled={service.refreshing}>
            {service.refreshing ? "refreshing…" : "refresh"}
          </button>
        </>
      }
    >
      {service.unreachable && (
        <Alert tone="danger" title="The browser cannot reach the backend">
          {service.failure?.message} The console stays usable and keeps retrying every{" "}
          {POLL_MS / 1000}s.
        </Alert>
      )}

      {service.degraded && (
        <Alert tone="warn" title="Alive but not ready: no model is loaded">
          The process answered <code>/health</code> with <code>status: degraded</code>, which means
          it is running correctly and simply has nothing to serve — typically a fresh instance
          whose registry is still empty. <code>/ready</code> reports{" "}
          <code>503 model_not_loaded</code>, and a deployment will not receive traffic until it
          resolves.
        </Alert>
      )}

      <div className="grid grid--stats">
        <Stat
          label="Service"
          value={service.health ? (service.health.model_loaded ? "ready" : "degraded") : "—"}
          tone={service.ready_ ? "ok" : service.health ? "warn" : "danger"}
          foot={
            service.health ? (
              <span className="mono">v{service.health.version}</span>
            ) : (
              <span>no response</span>
            )
          }
        />
        <Stat
          label="Uptime"
          value={duration(service.health?.uptime_seconds)}
          foot={<span>since process start</span>}
        />
        <Stat
          label="Model version"
          value={service.model?.model_version ?? "—"}
          small
          tone="accent"
          foot={
            service.model?.model_alias ? (
              <Badge tone="accent">alias {service.model.model_alias}</Badge>
            ) : (
              <span>source {service.model?.model_source ?? "—"}</span>
            )
          }
        />
        <Stat
          label="Load time"
          value={fixed(service.model?.load_seconds, 3)}
          unit="s"
          foot={<span>cold-start cost of this process</span>}
        />
        <Stat
          label="Predictions logged"
          value={num(summary?.n_predictions)}
          foot={
            summary?.window_seconds != null ? (
              <span>window {Math.round(summary.window_seconds)}s</span>
            ) : (
              <span>all recorded traffic</span>
            )
          }
        />
        <Stat
          label="Mean latency"
          value={ms(summary?.mean_latency_ms)}
          tone={
            summary?.mean_latency_ms != null && summary.mean_latency_ms > 50 ? "warn" : undefined
          }
          foot={<span>server-side, from the prediction store</span>}
        />
        <Stat
          label="Error events"
          value={num(totalErrors)}
          tone={totalErrors > 0 ? "warn" : "ok"}
          foot={<span>{errorCounts.length} distinct kinds</span>}
        />
        <Stat
          label="Last poll"
          value={relative(metrics.updatedAt ?? monitoring.updatedAt, now)}
          small
          foot={<span>telemetry refresh cadence {POLL_MS / 1000}s</span>}
        />
      </div>

      <div className="grid grid--halves">
        <Panel
          title="Served model"
          hint={service.model ? service.model.model_source : "loading"}
        >
          {service.loading && !service.model ? (
            <SkeletonLines lines={4} />
          ) : service.model ? (
            <KeyValues
              items={[
                { key: "name", label: "Model", value: service.model.model_name },
                { key: "version", label: "Version", value: service.model.model_version },
                { key: "alias", label: "Alias", value: service.model.model_alias ?? "none" },
                { key: "source", label: "Source", value: service.model.model_source },
                { key: "run", label: "Run id", value: shortId(service.model.run_id, 16) },
                {
                  key: "fingerprint",
                  label: "Fingerprint",
                  value: shortId(service.model.training_fingerprint, 20),
                },
                { key: "loaded", label: "Loaded at", value: timestamp(service.model.loaded_at) },
              ]}
            />
          ) : (
            <ErrorState
              title="No model information"
              body="The service is not reporting a loaded model, so there is no provenance to show."
              action={
                <button className="btn btn--ghost btn--sm" onClick={service.refresh}>
                  retry
                </button>
              }
            />
          )}
        </Panel>

        <Panel title="Prediction output distribution" hint="mlserve_prediction_score">
          {metrics.loading && !metricsData ? (
            <SkeletonLines lines={4} />
          ) : metrics.failure ? (
            <ErrorState
              title="No metrics"
              body={metrics.failure.message}
              hint="The distribution is read from the Prometheus exposition, which this instance did not return."
            />
          ) : scoreHistogram && scoreHistogram.count > 0 ? (
            <>
              <DistributionChart
                buckets={toBuckets(scoreHistogram.buckets, (le, previous) =>
                  `${previous ?? 0}–${le}`,
                )}
              />
              <BucketAxis
                buckets={toBuckets(scoreHistogram.buckets, (le) => le.toFixed(2))}
              />
              <div className="row row--between" style={{ marginTop: 12 }}>
                <span className="faint small mono">
                  {num(scoreHistogram.count)} records scored · mean{" "}
                  {fixed(scoreHistogram.sum / Math.max(scoreHistogram.count, 1), 4)}
                </span>
                <Badge tone="muted">server-side histogram</Badge>
              </div>
            </>
          ) : (
            <EmptyState
              title="No predictions observed yet"
              body="This instance has recorded no scored records, so there is no output distribution to draw. Run a prediction in the Inference Lab and this fills in."
            />
          )}
        </Panel>
      </div>

      <div className="grid grid--halves">
        <Panel title="Request latency" hint="mlserve_request_latency (cumulative buckets)">
          {metrics.loading && !metricsData ? (
            <SkeletonLines lines={4} />
          ) : latencyHistogram && latencyHistogram.count > 0 ? (
            <>
              <DistributionChart
                buckets={toBuckets(latencyHistogram.buckets, (le, previous) =>
                  `${previous ?? 0}–${le}s`,
                )}
                accent="var(--info)"
              />
              <BucketAxis
                buckets={toBuckets(latencyHistogram.buckets, (le) => `${le}s`)}
              />
              <div className="row row--between" style={{ marginTop: 12 }}>
                <span className="faint small mono">
                  {num(latencyHistogram.count)} requests · total{" "}
                  {fixed(latencyHistogram.sum, 2)}s
                </span>
                <span className="faint small mono">
                  browser round-trip {ms(metrics.data?.roundTripMs ?? null)}
                </span>
              </div>
            </>
          ) : (
            <EmptyState
              title="No request timings yet"
              body="Latency buckets appear once the service has handled traffic."
            />
          )}
        </Panel>

        <Panel title="Monitoring store" hint={summary?.enabled ? "recording" : "disabled"}>
          {monitoring.loading && !summary ? (
            <SkeletonLines lines={4} />
          ) : monitoring.failure ? (
            <ErrorState title="Monitoring unavailable" body={monitoring.failure.message} />
          ) : !summary?.enabled ? (
            <EmptyState
              title="Monitoring store is disabled"
              body="This instance runs without the prediction store, so no traffic history, event counts or model-version distribution is recorded. The service still serves predictions; it simply keeps no record of them."
            />
          ) : (
            <>
              <KeyValues
                items={[
                  { key: "predictions", label: "Predictions", value: num(summary.n_predictions) },
                  {
                    key: "mean-prob",
                    label: "Mean probability",
                    value: fixed(summary.mean_probability, 4),
                  },
                  {
                    key: "range",
                    label: "Range",
                    value: `${fixed(summary.min_probability, 3)} – ${fixed(summary.max_probability, 3)}`,
                  },
                  {
                    key: "mean-latency",
                    label: "Mean latency",
                    value: ms(summary.mean_latency_ms),
                  },
                  {
                    key: "served",
                    label: "Serving",
                    value: summary.served_model_version ?? "—",
                  },
                  {
                    key: "store-uptime",
                    label: "Since boot",
                    value: duration(summary.uptime_seconds),
                  },
                ]}
              />
              {errorCounts.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div className="faint small" style={{ marginBottom: 6 }}>
                    RECORDED EVENTS
                  </div>
                  <BarList
                    items={errorCounts
                      .sort((a, b) => b[1] - a[1])
                      .map(([kind, count]) => ({ label: kind, value: count }))}
                  />
                </div>
              )}
            </>
          )}
        </Panel>
      </div>

      <Panel title="Process resources" hint="sampled on scrape">
        {metricsData ? (
          <div className="grid grid--stats">
            <Stat label="Resident memory" value={bytes(rss)} foot={<span>mlserve_resource_rss_bytes</span>} />
            <Stat
              label="CPU"
              value={cpu != null ? `${fixed(cpu, 1)}%` : "—"}
              foot={<span>mlserve_resource_cpu_percent</span>}
            />
            <Stat
              label="Exposition size"
              value={bytes(metricsData.raw.length)}
              foot={<span>text/plain Prometheus</span>}
            />
            <Stat
              label="Servlet uptime"
              value={duration(service.health?.uptime_seconds)}
              foot={<span>reported by /health</span>}
            />
          </div>
        ) : (
          <SkeletonLines lines={2} />
        )}
      </Panel>
    </AppShell>
  );
}
