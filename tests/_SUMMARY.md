# `tests/` — backend test suite

The suite is deliberately not a set of mocks: it trains a real (small) model once per session
and exercises the real pipeline, because the claims this project makes are about behaviour.
Fixtures never touch a developer's real MLflow store or prediction database — every stateful
test builds its own under `tmp_path`.

## Contents

| File | Covers |
|---|---|
| `conftest.py` | Session fixtures: a small real split, a fitted model, isolated configs and stores |
| `test_validation.py`, `test_schema_contract.py` | The data contract: ranges, levels, missing values, duplicates, and that the API's request model matches the training contract |
| `test_features.py` | Feature engineering and the preprocessing pipeline |
| `test_split.py` | Stratification, sizes, and leakage reports |
| `test_training.py` | Training, evaluation, fingerprints and determinism |
| `test_registry.py` | Registry versions and alias semantics (`production`/`previous`/`candidate`) |
| `test_api.py`, `test_api_errors.py` | The HTTP surface and the structured error contract |
| `test_monitoring.py` | The prediction store and its summary |
| `test_drift.py` | The drift statistics and their thresholds |
| `test_retraining.py` | Acceptance criteria, promotion, rejection and rollback |
| `test_failure_injection.py` | Degraded and failing paths (missing model, bad artefacts, load failure) |
| `test_deployment_security.py` | Deployment behaviour: environment-driven configuration, admin-token enforcement, CORS allow-listing, `MLSERVE_DATA_ROOT` relocation |
| `test_deploy_tooling.py` | That the deployment tooling actually fails when it should: bad Blueprint fields, a hardcoded admin token, wildcard CORS, a fingerprint mismatch, and that every secret pattern matches its canonical sample |

## Directive paths

| | |
|---|---|
| Run everything | `python -m pytest -q` (from the repository root) |
| Isolated fixtures | `conftest.py` |
| Deployment behaviour | `test_deployment_security.py` |
| Deployment gates | `test_deploy_tooling.py` |
| Recorded results | `../results/tests/` |
