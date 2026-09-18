# `src/mlserve/features/` — feature engineering and preprocessing

## Contents

- `pipeline.py` — builds the scikit-learn `Pipeline` (derived columns → encoding → estimator).
  The transform lives **inside** the fitted model object, so it travels with the model through
  the registry and cannot drift away from the estimator it was trained with.

This is why the served model accepts 12 raw input columns while scoring 20+ engineered
features: the gap is closed inside the model, not in two places that could disagree.

## Directive paths

| | |
|---|---|
| Preprocessing and derived features | `pipeline.py` |
| The raw input contract | `../data/schema.py` |
| Model features reported by the API | `../serving/model_loader.py` → `ModelInfo.model_features` |
