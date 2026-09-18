# `ml-serving-monitoring-platform/` — repository root

An end-to-end, locally reproducible ML platform on the UCI Adult dataset: validated data →
reproducible training → MLflow tracking and registry → FastAPI serving → Prometheus
monitoring → statistical drift detection → gated retraining with promotion and rollback.
Everything is pinned, and every number quoted in the documentation is produced by a script
in this repository.

## Contents

- `src/mlserve/` — the Python package (configuration, data, features, models, serving,
  monitoring, retraining).
- `scripts/` — executable pipelines: data fetch, train, serve, smoke test, load test, drift
  and retraining experiments, plus `deploy/` and `verify/` tooling.
- `tests/` — the backend test suite (validation, contract, API, drift, retraining, registry,
  failure injection, deployment security, deploy tooling).
- `frontend/` — the React + TypeScript operations console deployed as a static site.
- `configs/config.yaml` — the single configuration file every script reads.
- `docker/` — the serving image and entrypoint; `render.yaml` — the Render Blueprint.
- `results/`, `artifacts/`, `mlruns/` — recorded evidence and runtime state (the last two are
  gitignored; `results/` holds the committed evidence files).
- Top-level `*.md` — the documentation set (see below).

## Directive paths

| | |
|---|---|
| Deploy this repo | `render.yaml`, `DEPLOYMENT.md` |
| What CI gates | `.github/workflows/ci.yml`, `CI_CD.md` |
| Public API contract | `API.md`, `src/mlserve/serving/app.py` |
| The data contract | `src/mlserve/data/schema.py`, `DATA_VALIDATION.md` |
| Training and registry | `scripts/train.py`, `src/mlserve/models/`, `MLFLOW.md`, `TRAINING.md` |
| Serving | `src/mlserve/serving/`, `scripts/serve.py`, `BENCHMARKS.md` |
| Drift and retraining | `src/mlserve/monitoring/`, `src/mlserve/retraining/`, `DRIFT_DETECTION.md`, `RETRAINING.md` |
| Benchmarks and evidence | `BENCHMARKS.md`, `results/`, `TEST_RESULTS.md` |
| Verify the claims | `scripts/verify/verify_claims.py` |
| Frontend | `frontend/`, `FRONTEND.md` |
