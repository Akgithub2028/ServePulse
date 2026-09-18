# `src/mlserve/models/` — training, evaluation and the registry

## Contents

| Module | Responsibility |
|---|---|
| `train.py` | Fits the estimator and the linear baseline on the training split, evaluates on validation, selects the best model, and computes the **behaviour fingerprint** (a SHA-256 over the fitted model's predictions on a fixed probe set at full float64 precision — the thing that makes reproducibility checkable) |
| `evaluate.py` | Metrics: ROC-AUC, PR-AUC, accuracy, F1, Brier, log loss, confusion matrix, calibration |
| `tracking.py` | MLflow runs: parameters, metrics, tags (dataset and code versions), and the model artefact |
| `registry.py` | The registry: version creation and alias management (`production`, `previous`, `candidate`). Aliases are used deliberately instead of deprecated stages |

## Directive paths

| | |
|---|---|
| Training entry point | `train.py` → `train_model()`; script wrapper `../../scripts/train.py` |
| Fingerprint definition | `train.py` → `training_fingerprint()` |
| Metric definitions | `evaluate.py` |
| Alias semantics | `registry.py` → `promote()`, `rollback()`, `production()` |
| What the server reports | `../serving/model_loader.py` |
