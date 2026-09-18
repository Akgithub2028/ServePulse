# `src/mlserve/retraining/` — gated retraining

## Contents

| Module | Responsibility |
|---|---|
| `decide.py` | The acceptance criteria: a candidate is promoted only if it satisfies the configured gates (for example a meaningful ROC-AUC improvement, no regression on the held-out set, sufficient drift evidence) — a candidate that merely matches the incumbent is rejected |
| `orchestrator.py` | Runs the loop end to end: detect drift → train a candidate → evaluate against the incumbent → promote (moving the `production` alias and recording `previous`) or reject, with every step recorded |

Retraining is explicitly **operator-invoked**; there is no scheduler, and the documentation says
so rather than implying a background service.

## Directive paths

| | |
|---|---|
| Acceptance thresholds | `decide.py`, `../../configs/config.yaml` → `retraining:` |
| Promotion and rollback mechanics | `orchestrator.py`, `../models/registry.py` |
| Experiment driver | `../../scripts/retrain_experiment.py` |
| Rollback through the live service | `../../scripts/rollback_through_serving.py` |
| Methodology and results | `../../RETRAINING.md`, `../../ROLLBACK.md`, `../../results/retraining/` |
