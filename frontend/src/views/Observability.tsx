/**
 * View 3 — Observability.
 *
 * Renders the platform's own recorded telemetry: the prediction store's snapshot and the
 * Prometheus exposition. A deliberate constraint shapes this page — **nothing here is
 * synthesised**. There is no historical time series, because the backend does not keep one:
 * the store aggregates over a rolling window and the histograms are cumulative counters. So
 * instead of drawing a fake trend line, the page shows what genuinely exists — counts,
 * distributions, windowed aggregates, per-version splits, event kinds — and states plainly
 * what the platform does *not* record.
 */
import { useState } from "react";
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
import { duration, fixed, ms, num, relative, seconds } from "../lib/format";

const POLL_MS = 8_000;
const WINDOWS = [
  { label: "all", seconds: undefined },
  { label: "15m", seconds: 900 },
  { label: "1h", seconds: 3600 },
  { label: "24h", seconds: 86_400 },
] as const;

export default function Observability() {
  const service = useServiceState(POLL_MS);
  const [windowIndex, setWindowIndex] = useState(0);
  const windowSeconds = WINDOWS[windowIndex]?.seconds;

  const summaryPoll = usePolling(
    () => api.monitoringSummary(windowSeconds).then((result) => result.data),
    { intervalMs: POLL_MS, deps: [windowIndex] },
  );
  const metricsPoll = usePolling(() => api.metrics().then((result) => result.data), {
    intervalMs: POLL_MS,
  });
  const now = useNow(1000);

  const summary = summaryPoll.data;
  const metrics = metricsPoll.data;
  const latency = metrics?.histograms["mlserve_request_latency_seconds"]?.[0];
  const score = metrics?.histograms["mlserve_prediction_score"]?.[0];

  const requestCounters = (metrics?.counters["mlserve_requests_total"] ?? []).map((sample) => ({
    label: `${sample.labels.endpoint ?? "?"} · ${sample.labels.status ?? "?"}`,
    value: sample.value,
  }));
  const errorCounters = (metrics?.counters["mlserve_errors_total"] ?? []).map((sample) => ({
    label: `${sample.labels.endpoint ?? "?"} · ${sample.labels.error_type ?? "?"}`,
    value: sample.value,
  }));
  const classCounters = (metrics?.counters["mlserve_predicted_class"] ?? []).map((sample) => ({
    label: `class ${sample.labels.label ?? sample.labels.predicted_class ?? "?"}`,
    value: sample.value,
  }));
  const modelGauges = (metrics?.gauges["mlserve_model_info"] ?? []).map((sample) => ({
    label: sample.labels.model_version ?? sample.labels.version ?? "unknown",
    value: sample.value,
  }));

  const versionSplit = Object.entries(summary?.by_model_version ?? {}).sort((a, b) => b[1] - a[1]);
  const eventSplit = Object.entries(summary?.events ?? {}).sort((a, b) => b[1] - a[1]);
  const stored = summary?.n_predictions ?? 0;

  return (
    <AppShell
      title="Observability"
      subtitle="Telemetry the platform actually records — no interpolated or synthetic series"
      headline={headlineFor(service)}
      actions={
        <>
          <span className="faint small mono">
            {summaryPoll.data ? `polled ${relative(summaryPoll.updatedAt, now)}` : "not polled yet"}
          </span>
          <div className="segmented" role="group" aria-label="Aggregation window">
            {WINDOWS.map((option, index) => (
              <button
                key={option.label}
                aria-pressed={index === windowIndex}
                onClick={() => setWindowIndex(index)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      }
    >
      {summaryPoll.failure && summary && (
        <Alert tone="warn" title="Showing the last successful reading">
          {summaryPoll.failure.message} The values below were captured{" "}
          {relative(summaryPoll.updatedAt, now)} and have not been refreshed since.
        </Alert>
      )}

      {!summary?.enabled && summary && (
        <Alert tone="warn" title="Monitoring is disabled on this instance">
          The prediction store is off, so no traffic, latency or distribution history exists to
          display. Enable it via the <code>monitoring.enabled</code> configuration to populate
          this view.
        </Alert>
      )}

      <div className="grid grid--stats">
        <Stat
          label="Predictions"
          value={num(stored)}
          foot={
            <span>
              {windowSeconds ? `window ${WINDOWS[windowIndex]?.label}` : "all recorded"} ·{" "}
              {summary?.enabled ? "prediction store" : "store disabled"}
            </span>
          }
        />
        <Stat
          label="Mean latency"
          value={ms(summary?.mean_latency_ms)}
          foot={<span>server-side, per request</span>}
        />
        <Stat
          label="Mean probability"
          value={fixed(summary?.mean_probability, 4)}
          foot={
            <span>
              range {fixed(summary?.min_probability, 3)} – {fixed(summary?.max_probability, 3)}
            </span>
          }
        />
        <Stat
          label="Throughput"
          value={
            stored > 0 && summary?.uptime_seconds
              ? (stored / Math.max(summary.uptime_seconds, 1)).toFixed(3)
              : "—"
          }
          unit="rec/s"
          foot={<span>average since process start</span>}
        />
        <Stat
          label="Model versions seen"
          value={String(versionSplit.length)}
          foot={<span>from the prediction log</span>}
        />
        <Stat
          label="Event kinds"
          value={String(eventSplit.length)}
          tone={eventSplit.length > 0 ? "warn" : "ok"}
          foot={<span>errors and lifecycle events</span>}
        />
      </div>

      <div className="grid grid--halves">
        <Panel
          title="Prediction distribution"
          hint="mlserve_prediction_score · cumulative histogram"
          actions={<Badge tone="muted">{score ? `${num(score.count)} samples` : "no data"}</Badge>}
        >
          {metricsPoll.loading && !metrics ? (
            <SkeletonLines lines={4} />
          ) : score && score.count > 0 ? (
            <>
              <DistributionChart buckets={toBuckets(score.buckets, (le, previous) => `${previous ?? 0}–${le}`)} />
              <BucketAxis buckets={toBuckets(score.buckets, (le) => le.toFixed(2))} />
              <p className="faint small" style={{ marginTop: 12 }}>
                Probability mass by bucket since process start. Watch for the mass collapsing toward
                0 or 1 — that is the shape a drifting input distribution produces.
              </p>
            </>
          ) : (
            <EmptyState
              title="No scored records yet"
              body="The histogram is empty because this instance has not scored anything since it started."
            />
          )}
        </Panel>

        <Panel title="Latency distribution" hint="mlserve_request_latency · cumulative histogram">
          {metricsPoll.loading && !metrics ? (
            <SkeletonLines lines={4} />
          ) : latency && latency.count > 0 ? (
            <>
              <DistributionChart
                buckets={toBuckets(latency.buckets, (le, previous) => `${previous ?? 0}–${le}s`)}
                accent="var(--info)"
              />
              <BucketAxis buckets={toBuckets(latency.buckets, (le) => `${le}s`)} />
              <div className="row row--between" style={{ marginTop: 12 }}>
                <span className="faint small mono">
                  {num(latency.count)} requests · {fixed(latency.sum, 2)}s total
                </span>
                <span className="faint small mono">
                  mean {seconds(latency.sum / Math.max(latency.count, 1))}
                </span>
              </div>
            </>
          ) : (
            <EmptyState title="No request timings yet" body="Latency buckets fill in as traffic arrives." />
          )}
        </Panel>
      </div>

      <div className="grid grid--thirds">
        <Panel title="Traffic by endpoint" hint="mlserve_requests_total">
          {requestCounters.length > 0 ? (
            <BarList items={requestCounters} />
          ) : (
            <EmptyState title="No traffic counters" body="No requests have been recorded on this instance." />
          )}
        </Panel>

        <Panel title="Errors by type" hint="mlserve_errors_total">
          {errorCounters.length > 0 ? (
            <BarList items={errorCounters} />
          ) : (
            <EmptyState
              icon="✓"
              title="No errors recorded"
              body="No failing request has been counted since this instance started."
            />
          )}
        </Panel>

        <Panel title="Predicted classes" hint="mlserve_predicted_class">
          {classCounters.length > 0 ? (
            <BarList items={classCounters} />
          ) : (
            <EmptyState title="No predictions yet" body="Class counters appear with the first scored record." />
          )}
        </Panel>
      </div>

      <div className="grid grid--halves">
        <Panel title="Traffic by model version" hint="from the prediction store">
          {versionSplit.length > 0 ? (
            <>
              <BarList items={versionSplit.map(([version, count]) => ({ label: version, value: count }))} />
              <p className="faint small" style={{ marginTop: 12 }}>
                This is the record that makes a hot-swap auditable: after a promotion or rollback,
                new predictions carry the new version while older rows keep the version that served
                them.
              </p>
            </>
          ) : modelGauges.length > 0 ? (
            <KeyValues
              items={modelGauges.map((entry, index) => ({
                key: String(index),
                label: entry.label,
                value: "currently served",
              }))}
            />
          ) : (
            <EmptyState
              title="No per-version traffic"
              body="Either no predictions have been recorded, or the monitoring store is disabled."
            />
          )}
        </Panel>

        <Panel title="Recorded events" hint="validation, capacity and lifecycle events">
          {eventSplit.length > 0 ? (
            <BarList items={eventSplit.map(([kind, count]) => ({ label: kind, value: count }))} />
          ) : summary?.enabled ? (
            <EmptyState
              icon="✓"
              title="No events recorded"
              body="No validation rejection, oversized payload, reload failure or unauthorised admin call has been recorded in this window."
            />
          ) : (
            <EmptyState title="Event log unavailable" body="The monitoring store is disabled on this instance." />
          )}
        </Panel>
      </div>

      <Panel title="Raw monitoring snapshot" hint="GET /monitoring/summary">
        {summaryPoll.loading && !summary ? (
          <SkeletonLines lines={6} />
        ) : summaryPoll.failure && !summary ? (
          <ErrorState
            title="Could not read the monitoring snapshot"
            body={summaryPoll.failure.message}
            hint={summaryPoll.failure.requestId ? `request id ${summaryPoll.failure.requestId}` : undefined}
          />
        ) : (
          <>
            <KeyValues
              items={[
                { key: "enabled", label: "Store enabled", value: String(summary?.enabled ?? false) },
                {
                  key: "window",
                  label: "Window",
                  value: summary?.window_seconds != null ? `${summary.window_seconds}s` : "all time",
                },
                { key: "predictions", label: "Predictions", value: num(summary?.n_predictions) },
                { key: "served", label: "Serving", value: summary?.served_model_version ?? "—" },
                { key: "uptime", label: "Uptime", value: duration(summary?.uptime_seconds) },
              ]}
            />
            <details style={{ marginTop: 14 }}>
              <summary className="faint small" style={{ cursor: "pointer" }}>
                show the raw JSON
              </summary>
              <pre className="code-block mono" style={{ marginTop: 10 }}>
                {JSON.stringify(summary ?? {}, null, 2)}
              </pre>
            </details>
          </>
        )}
      </Panel>

      <Alert tone="info" title="What this platform does not record">
        Request-level history is aggregated, not stored per request: the store keeps a rolling
        window of totals and the Prometheus counters are cumulative. There is therefore no
        per-minute time series to plot, and this view does not invent one. Historical trends,
        retention and alerting are deployment concerns that would need a metrics backend or a
        store change — the platform deliberately ships neither.
      </Alert>
    </AppShell>
  );
}
