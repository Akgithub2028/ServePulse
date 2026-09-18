# `src/mlserve/` — the platform package

## Contents

| Module / package | Responsibility |
|---|---|
| `config.py` | Loads `configs/config.yaml`, resolves paths, computes the code version, captures environment facts, and applies the deployment environment overlay (`_apply_env_overrides`) |
| `logging_utils.py` | Structured JSON logging with request-id propagation |
| `data/` | The data contract and the pipeline that enforces it: schema, ingest (checksum-pinned), validate, split |
| `features/` | Derived features and the preprocessing pipeline, fitted inside the model object |
| `models/` | Training, evaluation, MLflow tracking, and the registry (aliases, not stages) |
| `serving/` | FastAPI application, request/response schemas, model loader with hot-swap, Prometheus metrics |
| `monitoring/` | SQLite prediction store, drift detection (KS, chi-square, PSI), synthetic drift scenarios |
| `retraining/` | Acceptance criteria and the orchestrator that promotes, rejects or rolls back |

## Directive paths

| | |
|---|---|
| Configuration API | `config.py` → `load_config()`, `Config.require()`, `Config.path()` |
| Deployment overlay | `config.py` → `_apply_env_overrides()` |
| Public HTTP surface | `serving/app.py` → `create_app()` |
| Registry semantics | `models/registry.py` |
| Drift statistics | `monitoring/drift.py` |
| Retraining decision | `retraining/decide.py` |
