/**
 * View 2 — Inference Lab.
 *
 * A workspace over the real `POST /predict`. Two rules shape it:
 *
 * 1. **No client-side coercion.** Validation mirrors the backend's contract (ranges and
 *    allowed levels come from the served model's own `input_columns` where available) so an
 *    invalid value is rejected *here* with the same reasoning the API would use, rather than
 *    being silently repaired into something the API would accept. If the API still rejects
 *    the payload, its structured error is rendered verbatim — type, message, per-field
 *    details and request id.
 *
 * 2. **The failure taxonomy is visible.** Validation, oversized payload, model unavailable,
 *    server-side inference failure and transport failure are five different things and are
 *    presented as such, because "it didn't work" is useless to an operator.
 */
import { useMemo, useState } from "react";
import { api, describeError } from "../api/client";
import { usePolling } from "../api/hooks";
import { AppShell } from "../components/AppShell";
import {
  Alert,
  Badge,
  EmptyState,
  KeyValues,
  Panel,
  SkeletonLines,
  Stat,
} from "../components/ui";
import { headlineFor, useServiceState } from "../state/service";
import { fixed, ms, percent } from "../lib/format";
import type { ApiFailure, PredictResponse } from "../api/types";

/**
 * The example record the API documents, plus the field constraints from the data contract
 * (src/mlserve/serving/schemas.py). Kept in one place so the form, the validator and the
 * "load example" action cannot disagree.
 */
const EXAMPLE = {
  age: 39,
  workclass: "State-gov",
  education_num: 13,
  marital_status: "Never-married",
  occupation: "Adm-clerical",
  relationship: "Not-in-family",
  race: "White",
  sex: "Male",
  capital_gain: 2174,
  capital_loss: 0,
  hours_per_week: 40,
  native_country: "United-States",
} as const;

type FieldSpec =
  | { name: string; kind: "number"; min: number; max: number; help: string }
  | { name: string; kind: "text"; help: string };

/** Field-level constraints from the request model. Ranges are inclusive, as in the schema. */
const FIELDS: FieldSpec[] = [
  { name: "age", kind: "number", min: 17, max: 90, help: "17–90" },
  { name: "workclass", kind: "text", help: "categorical" },
  { name: "education_num", kind: "number", min: 1, max: 16, help: "1–16" },
  { name: "marital_status", kind: "text", help: "categorical" },
  { name: "occupation", kind: "text", help: "categorical" },
  { name: "relationship", kind: "text", help: "categorical" },
  { name: "race", kind: "text", help: "categorical" },
  { name: "sex", kind: "text", help: "Male | Female" },
  { name: "capital_gain", kind: "number", min: 0, max: 100_000, help: "0–99999" },
  { name: "capital_loss", kind: "number", min: 0, max: 10_000, help: "0–4356" },
  { name: "hours_per_week", kind: "number", min: 1, max: 99, help: "1–99" },
  { name: "native_country", kind: "text", help: "categorical" },
];

type Draft = Record<string, string>;

function draftFromExample(): Draft {
  const draft: Draft = {};
  for (const field of FIELDS) {
    draft[field.name] = String(EXAMPLE[field.name as keyof typeof EXAMPLE]);
  }
  return draft;
}

interface FieldIssues {
  [field: string]: string | undefined;
}

/** Mirror of the backend contract. Returns per-field messages, not a boolean. */
function validate(draft: Draft): FieldIssues {
  const issues: FieldIssues = {};
  for (const field of FIELDS) {
    const raw = (draft[field.name] ?? "").trim();
    if (!raw) {
      issues[field.name] = "required";
      continue;
    }
    if (field.kind === "number") {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        issues[field.name] = "must be a number";
      } else if (!Number.isInteger(value)) {
        issues[field.name] = "must be an integer";
      } else if (value < field.min || value > field.max) {
        issues[field.name] = `must be between ${field.min} and ${field.max}`;
      }
      continue;
    }
    if (field.name === "sex" && !["Male", "Female"].includes(raw)) {
      issues[field.name] = "must be Male or Female";
    }
  }
  return issues;
}

function buildRecord(draft: Draft): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const field of FIELDS) {
    const raw = (draft[field.name] ?? "").trim();
    record[field.name] = field.kind === "number" ? Number(raw) : raw;
  }
  return record;
}

/** The five failure classes, each rendered with its own explanation and remedy. */
function failureCopy(failure: ApiFailure): { title: string; tone: "danger" | "warn" | "info"; body: string } {
  switch (failure.kind) {
    case "validation":
      return {
        title: "Rejected by the data contract",
        tone: "warn",
        body: "The service validated the payload against the same contract the model was trained on and refused it. The field-level reasons are below.",
      };
    case "oversized":
      return {
        title: "Batch too large",
        tone: "warn",
        body: "The request exceeded the configured maximum batch size. Reduce the batch and resubmit.",
      };
    case "unavailable":
      return {
        title: "Model unavailable",
        tone: "danger",
        body: "The process is alive but no model is loaded, so it cannot score anything yet.",
      };
    case "unauthorized":
      return {
        title: "Not authorised",
        tone: "danger",
        body: "This endpoint requires an admin token.",
      };
    case "timeout":
      return {
        title: "Timed out",
        tone: "warn",
        body: "The request was still open when the client budget elapsed — typical right after a cold start.",
      };
    case "transport":
      return {
        title: "Could not reach the service",
        tone: "danger",
        body: "The request never produced a response.",
      };
    default:
      return {
        title: "Server-side failure",
        tone: "danger",
        body: "The service accepted the request but failed while scoring it.",
      };
  }
}

export default function InferenceLab() {
  const service = useServiceState(15_000);
  const [draft, setDraft] = useState<Draft>(() => draftFromExample());
  const [batchSize, setBatchSize] = useState(1);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PredictResponse | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [roundTripMs, setRoundTripMs] = useState<number | null>(null);

  // The model's own input columns drive the batch preview: this is the same list the API
  // expects, taken from the service rather than assumed from the source.
  const modelInfo = usePolling(
    async () => {
      try {
        return (await api.modelInfo()).data;
      } catch {
        return null;
      }
    },
    { intervalMs: 0 },
  );
  // Derived, not stored: the count is whatever /model-info last reported.
  const columnCount = modelInfo.data?.input_columns?.length ?? null;

  const issues = validate(draft);
  const issueCount = Object.values(issues).filter(Boolean).length;
  const canSubmit = issueCount === 0 && !submitting && batchSize <= 512;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setFailure(null);
    setResult(null);
    try {
      const records = Array.from({ length: batchSize }, () => buildRecord(draft));
      const response = await api.predict(records);
      setResult(response.data);
      setRoundTripMs(response.meta.roundTripMs);
    } catch (error) {
      setFailure(describeError(error));
      setRoundTripMs(null);
    } finally {
      setSubmitting(false);
    }
  }

  const distribution = useMemo(() => {
    if (!result) return null;
    const positive = result.predictions.filter((item) => item.prediction === 1).length;
    const mean = result.predictions.reduce((total, item) => total + item.probability, 0) / result.predictions.length;
    return { positive, mean, total: result.predictions.length };
  }, [result]);

  return (
    <AppShell
      title="Inference Lab"
      subtitle="Score records against the live model through the real /predict contract"
      headline={headlineFor(service)}
    >
      {service.degraded && (
        <Alert tone="warn" title="Predictions will fail until a model loads">
          No model is currently loaded, so <code>/predict</code> answers{" "}
          <code>503 model_not_loaded</code>. The form is still useful to inspect the payload
          contract.
        </Alert>
      )}

      <div className="grid grid--stats">
        <Stat
          label="Endpoint"
          value="POST /predict"
          small
          foot={<span>batch of records, one response</span>}
        />
        <Stat
          label="Input columns"
          value={columnCount != null ? String(columnCount) : "—"}
          foot={<span>reported by /model-info</span>}
        />
        <Stat
          label="Decision threshold"
          value={result ? fixed(result.threshold, 3) : "—"}
          foot={<span>probability ≥ threshold → positive class</span>}
        />
        <Stat
          label="Max batch"
          value="512"
          foot={<span>above this the API answers 413</span>}
        />
      </div>

      <div className="grid grid--halves">
        <Panel
          title="Input record"
          hint={issueCount > 0 ? `${issueCount} invalid field(s)` : "valid against the contract"}
          actions={
            <>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  setDraft(draftFromExample());
                  setTouched({});
                }}
              >
                load example
              </button>
            </>
          }
        >
          <div className="form-grid">
            {FIELDS.map((field) => {
              const invalid = touched[field.name] && issues[field.name];
              return (
                <label className="field" key={field.name}>
                  <span className="field__label">
                    {field.name}
                    <span className="field__hint">{field.help}</span>
                  </span>
                  <input
                    value={draft[field.name] ?? ""}
                    aria-invalid={invalid ? "true" : "false"}
                    aria-label={field.name}
                    inputMode={field.kind === "number" ? "numeric" : "text"}
                    onChange={(event) =>
                      setDraft((previous) => ({ ...previous, [field.name]: event.target.value }))
                    }
                    onBlur={() => setTouched((previous) => ({ ...previous, [field.name]: true }))}
                  />
                  {invalid && <span className="field__error">{issues[field.name]}</span>}
                </label>
              );
            })}
          </div>

          <div className="row row--between" style={{ marginTop: 18 }}>
            <label className="field" style={{ maxWidth: 220 }}>
              <span className="field__label">
                batch size
                <span className="field__hint">same record, scored N times</span>
              </span>
              <input
                type="number"
                min={1}
                max={512}
                value={batchSize}
                aria-label="batch size"
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setBatchSize(Number.isFinite(next) ? Math.max(1, Math.min(512, Math.trunc(next))) : 1);
                }}
              />
            </label>
            <button className="btn btn--primary" onClick={() => void submit()} disabled={!canSubmit}>
              {submitting ? "scoring…" : `score ${batchSize} record${batchSize === 1 ? "" : "s"}`}
            </button>
          </div>

          {columnCount != null && columnCount !== FIELDS.length && (
            <Alert tone="info" title="The served model expects a different column set">
              <code>/model-info</code> reports {columnCount} input columns while this form sends{" "}
              {FIELDS.length}. The API will reject the payload — the form mirrors the documented
              contract, and the served model is the authority.
            </Alert>
          )}
        </Panel>

        <Panel title="Result" hint={result ? "200 OK" : "awaiting a request"}>
          {submitting && (
            <div className="stack">
              <SkeletonLines lines={3} />
              <span className="faint small">waiting for the service…</span>
            </div>
          )}

          {!submitting && failure && (
            <div className="stack">
              {(() => {
                const copy = failureCopy(failure);
                return (
                  <Alert tone={copy.tone === "info" ? "info" : copy.tone} title={copy.title}>
                    {copy.body}
                  </Alert>
                );
              })()}
              <KeyValues
                items={[
                  { key: "status", label: "HTTP status", value: failure.status ?? "—" },
                  { key: "type", label: "Error type", value: failure.type ?? "—" },
                  { key: "message", label: "Message", value: failure.message },
                  { key: "request", label: "Request id", value: failure.requestId ?? "—" },
                ]}
                plainKeys={["message"]}
              />
              {failure.details.length > 0 && (
                <div>
                  <div className="faint small" style={{ marginBottom: 6 }}>
                    FIELD-LEVEL DETAILS
                  </div>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Location</th>
                        <th>Message</th>
                        <th>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failure.details.map((detail, index) => (
                        <tr key={index}>
                          <td className="mono">{String(detail["location"] ?? detail["loc"] ?? "—")}</td>
                          <td>{String(detail["message"] ?? detail["msg"] ?? "—")}</td>
                          <td className="mono faint">{String(detail["type"] ?? "—")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {!submitting && !failure && result && (
            <div className="stack">
              <div className="grid grid--stats">
                {distribution && (
                  <>
                    <Stat
                      label="Positive rate"
                      value={percent(distribution.positive / Math.max(distribution.total, 1), 0)}
                      foot={<span>{distribution.positive} of {distribution.total} above threshold</span>}
                    />
                    <Stat
                      label="Mean probability"
                      value={fixed(distribution.mean, 4)}
                      foot={<span>P(income &gt; 50K)</span>}
                    />
                    <Stat
                      label="Server latency"
                      value={ms(result.latency_ms)}
                      foot={<span>self-reported by the service</span>}
                    />
                    <Stat
                      label="Round trip"
                      value={ms(roundTripMs)}
                      foot={<span>browser-observed, incl. network</span>}
                    />
                  </>
                )}
              </div>

              <KeyValues
                items={[
                  { key: "request", label: "Request id", value: result.request_id },
                  { key: "model", label: "Model", value: result.model_name },
                  { key: "version", label: "Version", value: result.model_version },
                  { key: "alias", label: "Alias", value: result.model_alias ?? "none" },
                  { key: "threshold", label: "Threshold", value: fixed(result.threshold, 3) },
                  { key: "records", label: "Records", value: result.n_records },
                ]}
              />

              <div>
                <div className="faint small" style={{ marginBottom: 6 }}>
                  PREDICTIONS
                </div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th className="num">Probability</th>
                      <th>Class</th>
                      <th>Label</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.predictions.slice(0, 25).map((prediction, index) => (
                      <tr key={index}>
                        <td className="mono">{index + 1}</td>
                        <td className="num">{fixed(prediction.probability, 4)}</td>
                        <td>
                          <Badge tone={prediction.prediction === 1 ? "accent" : "muted"}>
                            {prediction.prediction}
                          </Badge>
                        </td>
                        <td>{prediction.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.predictions.length > 25 && (
                  <p className="faint small" style={{ marginTop: 8 }}>
                    showing the first 25 of {result.predictions.length} predictions
                  </p>
                )}
              </div>
            </div>
          )}

          {!submitting && !failure && !result && (
            <EmptyState
              icon="▷"
              title="No request yet"
              body="Edit the record and submit. The response — probability, class, model version, request id and latency — appears here, and the request itself is recorded by the platform's monitoring store, which feeds the Observability view."
            />
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
