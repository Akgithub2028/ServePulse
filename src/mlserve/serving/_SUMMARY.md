# `src/mlserve/serving/` — the HTTP service

## Contents

| Module | Responsibility |
|---|---|
| `app.py` | The FastAPI application: routes, request-id middleware, the structured error contract, the admin-token guard, CORS, and startup model loading |
| `schemas.py` | Request/response models generated from the same contract the model was trained against (`PredictRequest`, `PredictResponse`, `ErrorResponse`, `ModelInfoResponse`, …) |
| `model_loader.py` | Resolves the model from the registry alias or a file bundle, records provenance, and performs the **hot-swap**: load the replacement first, swap only on success, keep the incumbent if loading fails |
| `metrics.py` | Prometheus instruments: request/error counters, latency and prediction histograms, predicted-class counters, per-feature histograms, model info and resource gauges |
| `main.py` | The ASGI entry point (`mlserve.serving.main:app`) referenced by the container and by `scripts/serve.py` |

## Directive paths

| | |
|---|---|
| Endpoints | `app.py` → `router` (`/health`, `/ready`, `/model-info`, `/predict`, `/metrics`, `/monitoring/summary`, `/admin/reload`) |
| Error contract | `app.py` → `_error_response()`; documented in `../../API.md` |
| Admin guard | `app.py` → `_admin_token_ok()`, `_admin_auth_failure()` |
| Reload semantics | `model_loader.py` → `reload()` |
| Metric definitions | `metrics.py` |
| Container entry point | `main.py` (via `../../docker/entrypoint.sh`) |
