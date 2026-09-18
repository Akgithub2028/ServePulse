# `frontend/src/api/` — the API layer

The single boundary between the console and the backend.

## Contents

| File | Responsibility |
|---|---|
| `types.ts` | The backend contract transcribed from the response models: `HealthResponse`, `ReadyResponse`, `ModelInfo`, `PredictResponse`, `MonitoringSummary`, the error envelope, and the classified `ApiFailure` |
| `client.ts` | `fetch` wrapper: build-time base URL, timeout and abort handling, error normalisation into `ApiFailure` kinds (`validation`, `oversized`, `unavailable`, `unauthorized`, `server`, `transport`, `timeout`), correlation-header capture, and a hand-written Prometheus exposition parser |
| `hooks.ts` | `usePolling` (pauses while the tab is hidden, cleans up timers, keeps the last good value when a refresh fails), `useAction`, `useNow` |

## Directive paths

| | |
|---|---|
| Base URL | `client.ts` → `API_BASE_URL` (from `VITE_API_BASE_URL`) |
| Endpoints | `client.ts` → `api` object |
| Failure taxonomy | `client.ts` → `classify()` |
| Metrics parsing | `client.ts` → `parsePrometheus()` |
| Response shapes | `types.ts` |
