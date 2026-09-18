# `scripts/` — executable pipelines

Thin entry points over `src/mlserve/`. Each script loads `configs/config.yaml`, does one job,
prints a clear success marker, and exits non-zero on failure — which is what makes them usable
both interactively and as CI steps.

## Contents

| Script | Job |
|---|---|
| `fetch_data.py` | Download the UCI Adult files and verify their pinned SHA-256 |
| `train.py` | validate → split → train (+ baseline) → evaluate → track in MLflow → register → set the `production` alias if unset |
| `serve.py` | Run the API locally (thread-pinned) |
| `smoke_test.py` | 24 checks against a real running server |
| `load_test.py` | Reproducible HTTP benchmark (pinned and unpinned thread configurations) |
| `drift_experiment.py` | Controlled drift experiment across scenarios |
| `retrain_experiment.py` | Retraining acceptance: promotion, rejection, rollback |
| `rollback_through_serving.py` | Rollback verified through the live service under load |
| `collect_results.py` | Aggregate every measurement into the top-level CSV/JSON results |

## Directive paths

| | |
|---|---|
| The pipeline that CI runs | `train.py`, `smoke_test.py`, `drift_experiment.py` |
| Deployment tooling | `deploy/` |
| Claim and reproducibility verification | `verify/` |
| Library code these wrap | `../src/mlserve/` |
