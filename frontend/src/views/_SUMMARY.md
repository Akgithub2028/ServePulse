# `frontend/src/views/` — the five views

| File | View | Question it answers |
|---|---|---|
| `ControlRoom.tsx` | Control Room (`/`) | Is the platform healthy? Liveness vs readiness, served model identity, uptime, load cost, prediction-store counters, output and latency distributions from the Prometheus exposition |
| `InferenceLab.tsx` | Inference Lab (`/inference`) | What does the model answer? A real `POST /predict` workspace with contract-mirroring validation and all five failure classes rendered distinctly |
| `Observability.tsx` | Observability (`/observability`) | What has the platform recorded? Windowed traffic, latency and distributions, per-version split, event kinds — and a plain statement of what is *not* recorded |
| `Provenance.tsx` | Model Provenance (`/provenance`) | Where did this model come from? The trace from dataset version to behaviour fingerprint to registry version to the serving process |
| `Platform.tsx` | Platform / API (`/platform`) | What is this system? Endpoint inventory from the service's own OpenAPI document, health semantics, runtime facts, security posture |

None of them fabricates data: where an endpoint has nothing to report, the view renders an
explicit empty or degraded state.

## Directive paths

| | |
|---|---|
| Routing | `../App.tsx` (Control Room eager, the rest code-split) |
| Shared state | `../state/service.ts` |
| Charts and state primitives | `../components/charts.tsx`, `../components/ui.tsx` |
| Browser tests for these views | `../../tests/e2e/console.spec.ts` |
