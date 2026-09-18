# `src/mlserve/data/` — the data contract and ingestion

## Contents

| Module | Responsibility |
|---|---|
| `schema.py` | The contract: feature names, types, ranges, allowed categorical levels, target definition and the example record. Everything downstream — validation, request models, tests — derives from this one definition |
| `ingest.py` | Reads the raw files, verifies the pinned SHA-256 checksums, folds them into an immutable `dataset_version`, and reports the split's `split_id` |
| `validate.py` | Enforces the contract: schema, ranges, categorical levels, missing values, duplicates, target balance |
| `split.py` | Builds the train/validation/test split with stratification, and measures leakage (shared rows and index overlap) |

## Directive paths

| | |
|---|---|
| The contract itself | `schema.py` → `FEATURE_NAMES`, `TARGET`, `NUMERIC_FEATURES`, `CATEGORICAL_FEATURES` |
| Pinned checksums | `ingest.py` → the SHA-256 constants |
| Dataset identity | `ingest.py` → `dataset_id` / `dataset_version` |
| Validation entry point | `validate.py` |
| Split and leakage report | `split.py` → `make_split()`, `overlap_report()` |
