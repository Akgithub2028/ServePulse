# `configs/` — configuration

## Contents

- `config.yaml` — the single configuration file for the whole platform: paths, data split,
  model and baseline estimator parameters, evaluation metrics and decision threshold, MLflow
  tracking URIs and registered model name, serving settings (host, port, batch limits, CORS
  allow-list, admin token), monitoring (latency and prediction histogram buckets, drift
  window) and retraining thresholds.

Nothing hardcodes a path, threshold or seed: every script loads this file, and the resolved
config is hashed and written into each training run, so a result always traces back to the
settings that produced it.

Local development reads this file exactly as committed. The deployed service overlays a small
set of environment variables on top of it (`MLSERVE_DATA_ROOT`, `MLSERVE_HOST`,
`MLSERVE_CORS_ORIGINS`, `MLSERVE_ADMIN_TOKEN`, `MLSERVE_MODEL_SOURCE`, `MLSERVE_MODEL_ALIAS`)
via `mlserve.config._apply_env_overrides`; the override is inert unless those variables are
set, so a developer checkout sees the committed values and the recorded `config_digest` is
unchanged. `PORT` is deliberately **not** read here.

## Directive paths

| | |
|---|---|
| Paths and seeds | `config.yaml` → `project:`, `paths:` |
| Model and baseline params | `config.yaml` → `model:` |
| Metrics and threshold | `config.yaml` → `evaluation:` |
| MLflow store and model name | `config.yaml` → `mlflow:` |
| Serving host/port/batch/CORS/admin token | `config.yaml` → `serving:` |
| Drift and retraining thresholds | `config.yaml` → `monitoring:`, `retraining:` |
| The loader and env overlay | `../src/mlserve/config.py` |
