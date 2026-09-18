/**
 * View 4 — Model Provenance.
 *
 * The platform's distinguishing claim is that an answer can be traced back to the exact
 * artefacts that produced it. This view renders that chain as a trace rather than a table:
 * dataset → split → training run → registry version → alias → the process serving it now,
 * with each hop's identifiers and the offline metrics recorded at training time.
 *
 * Every field comes from `GET /model-info`, which the service builds from the registry tags
 * written by the training run.
 */
import { api } from "../api/client";
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
import { duration, fixed, num, relative, shortId, timestamp } from "../lib/format";

const POLL_MS = 20_000;

export default function Provenance() {
  const service = useServiceState(POLL_MS);
  const infoPoll = usePolling(
    async () => {
      try {
        return (await api.modelInfo()).data;
      } catch (error) {
        const { describeError } = await import("../api/client");
        const failure = describeError(error);
        if (failure.kind === "unavailable") return null;
        throw error;
      }
    },
    { intervalMs: POLL_MS },
  );
  const now = useNow(1000);
  const info = infoPoll.data;
  const metricEntries = Object.entries(info?.metrics ?? {}).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <AppShell
      title="Model Provenance"
      subtitle="The chain from dataset to the model answering requests right now"
      headline={headlineFor(service)}
      actions={
        <span className="faint small mono">
          {infoPoll.updatedAt ? `read ${relative(infoPoll.updatedAt, now)}` : "reading…"}
        </span>
      }
    >
      {!service.ready_ && !infoPoll.loading && !info && (
        <Alert tone="warn" title="No model is loaded, so there is no provenance to trace">
          The service is alive but has nothing registered under the configured alias. On a fresh
          deployment the first-deploy bootstrap (<code>scripts/deploy/init_production.py</code>)
          creates that first model and points the alias at it.
        </Alert>
      )}

      {infoPoll.failure && !info && (
        <ErrorState
          title="Could not read model information"
          body={infoPoll.failure.message}
          hint={infoPoll.failure.requestId ? `request id ${infoPoll.failure.requestId}` : undefined}
          action={
            <button className="btn btn--ghost btn--sm" onClick={() => infoPoll.refresh()}>
              retry
            </button>
          }
        />
      )}

      {infoPoll.loading && !info ? (
        <Panel title="Provenance chain">
          <SkeletonLines lines={6} />
        </Panel>
      ) : info ? (
        <>
          <div className="grid grid--stats">
            <Stat label="Model" value={info.model_name} small foot={<span>{info.model_source} source</span>} />
            <Stat
              label="Version"
              value={info.model_version}
              tone="accent"
              foot={<span>registry version serving traffic</span>}
            />
            <Stat
              label="Alias"
              value={info.model_alias ?? "none"}
              small
              foot={<span>the pointer a promotion moves</span>}
            />
            <Stat
              label="Loaded"
              value={relative(Date.parse(info.loaded_at), now)}
              small
              foot={<span>{timestamp(info.loaded_at)}</span>}
            />
            <Stat
              label="Load cost"
              value={fixed(info.load_seconds, 3)}
              unit="s"
              foot={<span>cold-start time for this model</span>}
            />
            <Stat
              label="Serving for"
              value={duration(service.health?.uptime_seconds)}
              foot={<span>process uptime</span>}
            />
          </div>

          <Panel title="Trace" hint="dataset → training run → registry → serving process">
            <div className="chain">
              <TraceStep
                title="Dataset"
                meta={info.dataset_version ?? "not recorded"}
                note="Immutable ingest identity: the SHA-256 of the raw files folded into a version string. A different file yields a different version, so a model can never be silently retrained on changed data."
                badge={<Badge tone="info">ingest</Badge>}
              />
              <TraceStep
                title="Training run"
                meta={info.run_id ?? "not recorded"}
                note="The MLflow run that produced this model. Its params, metrics and the fitted pipeline are recorded against this id."
                badge={<Badge tone="violet">mlflow run</Badge>}
              />
              <TraceStep
                title="Behaviour fingerprint"
                meta={info.training_fingerprint ?? "not recorded"}
                note="SHA-256 over the fitted pipeline's predictions on a fixed probe set, at full float64 precision. Byte-identical across independent environments — this is what makes 'reproducible' a checkable claim rather than a word."
                badge={<Badge tone="accent">reproducibility</Badge>}
              />
              <TraceStep
                title="Registry version"
                meta={`${info.model_name} v${info.model_version}`}
                note="The immutable registry version the alias resolves to. Promotion and rollback move the alias — never this version — which is why an existing version keeps serving until an operator changes it."
                badge={<Badge tone="ok">registry</Badge>}
              />
              <TraceStep
                title="Serving process"
                meta={`${info.model_source} · loaded in ${fixed(info.load_seconds, 3)}s`}
                note="The in-process loader resolved the alias at startup and holds the model in memory. A reload re-resolves the alias and swaps only on success, so a failed replacement leaves the incumbent serving."
                badge={<Badge tone="muted">runtime</Badge>}
                last
              />
            </div>
          </Panel>

          <div className="grid grid--halves">
            <Panel title="Identifiers" hint="as recorded at training time">
              <KeyValues
                items={[
                  { key: "name", label: "Registered name", value: info.model_name },
                  { key: "version", label: "Version", value: info.model_version },
                  { key: "alias", label: "Alias", value: info.model_alias ?? "none" },
                  { key: "source", label: "Source", value: info.model_source },
                  { key: "run", label: "Run id", value: info.run_id ?? "—" },
                  { key: "dataset", label: "Dataset version", value: info.dataset_version ?? "—" },
                  { key: "code", label: "Code version", value: info.code_version ?? "—" },
                  { key: "commit", label: "Git commit", value: info.git_commit ?? "—" },
                  {
                    key: "fingerprint",
                    label: "Fingerprint",
                    value: info.training_fingerprint ?? "—",
                  },
                  { key: "loaded", label: "Loaded at", value: timestamp(info.loaded_at) },
                ]}
              />
              <p className="faint small" style={{ marginTop: 14 }}>
                A short fingerprint, <span className="mono">{shortId(info.training_fingerprint, 16)}</span>,
                is what the CI pipeline compares on every push: if the model that builds in CI no
                longer reproduces this value, the build fails rather than the documentation quietly
                going stale.
              </p>
            </Panel>

            <Panel title="Offline metrics" hint={`${metricEntries.length} recorded at training time`}>
              {metricEntries.length > 0 ? (
                <>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th className="num">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metricEntries.map(([name, value]) => (
                        <tr key={name}>
                          <td className="mono">{name}</td>
                          <td className="num">{fixed(value, 6)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="faint small" style={{ marginTop: 12 }}>
                    These are evaluation-set metrics recorded when the model was trained — not live
                    measurements. The Observability view is where live traffic is reported.
                  </p>
                </>
              ) : (
                <EmptyState
                  title="No metrics recorded for this version"
                  body="This model version carries no evaluation metrics in its registry tags."
                />
              )}
            </Panel>
          </div>

          <Panel
            title="Feature contract"
            hint={`${info.input_columns.length} input columns · ${info.model_features.length} engineered features`}
          >
            <div className="grid grid--halves">
              <div>
                <div className="faint small" style={{ marginBottom: 8 }}>
                  INPUT COLUMNS — EXACTLY WHAT /predict REQUIRES
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {info.input_columns.map((column) => (
                    <Badge key={column} tone="muted">
                      {column}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <div className="faint small" style={{ marginBottom: 8 }}>
                  MODEL FEATURES — AFTER INTERNAL ENGINEERING
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {info.model_features.map((feature) => (
                    <Badge key={feature} tone="muted">
                      {feature}
                    </Badge>
                  ))}
                </div>
                <p className="faint small" style={{ marginTop: 12 }}>
                  The gap between these two lists is the feature pipeline: derived columns are built
                  inside the fitted model object, so the transform cannot drift away from the model
                  that was trained on it.
                </p>
              </div>
            </div>
          </Panel>

          <Panel title="Raw model information" hint="GET /model-info">
            <details>
              <summary className="faint small" style={{ cursor: "pointer" }}>
                show the raw JSON
              </summary>
              <pre className="code-block mono" style={{ marginTop: 10 }}>
                {JSON.stringify(info, null, 2)}
              </pre>
            </details>
          </Panel>
        </>
      ) : (
        <EmptyState
          title="No model information"
          body={`The service reported no loaded model, and ${num(metricEntries.length)} metrics were found.`}
        />
      )}
    </AppShell>
  );
}

function TraceStep({
  title,
  meta,
  note,
  badge,
  last = false,
}: {
  title: string;
  meta: string;
  note: string;
  badge: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className="chain__step">
      <div className="chain__rail">
        <span className="chain__node" />
        {!last && <span className="chain__line" />}
      </div>
      <div className="chain__body">
        <div className="row" style={{ gap: 10, marginBottom: 4 }}>
          <span className="chain__title">{title}</span>
          {badge}
        </div>
        <div className="chain__meta">{meta}</div>
        <p className="faint small" style={{ margin: "6px 0 0", maxWidth: "78ch" }}>
          {note}
        </p>
      </div>
    </div>
  );
}
