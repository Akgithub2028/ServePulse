# `src/mlserve/monitoring/` — prediction store and drift detection

## Contents

| Module | Responsibility |
|---|---|
| `store.py` | SQLite prediction store: per-request feature rows, scores and latencies, plus an events table; exposes `summary()` (the rolling-window snapshot behind `GET /monitoring/summary`) and `recent_features()` |
| `drift.py` | Drift detection: Kolmogorov–Smirnov for numeric features, chi-square for categorical levels, PSI as the decision statistic (≥ 0.25 with p < 0.01), Wasserstein distance to report magnitude |
| `scenarios.py` | Synthetic drift scenarios used by the drift experiment, so detection rates are measured against known ground truth |

## Directive paths

| | |
|---|---|
| Prediction storage | `store.py` → `log_predictions()`, `summary()` |
| Drift statistics and thresholds | `drift.py` |
| Scenario definitions | `scenarios.py` |
| Experiment driver | `../../scripts/drift_experiment.py` |
| Methodology and results | `../../DRIFT_DETECTION.md`, `../../results/drift/` |
