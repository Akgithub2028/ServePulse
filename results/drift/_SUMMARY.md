# `results/drift/` — Recorded drift evidence

## Contents

Per-scenario detection rates and performance deltas (`drift_experiment.json`), per-feature PSI, trial-level records, and detection latency (`drift_detection_latency.csv`). Produced by `scripts/drift_experiment.py`; methodology in `DRIFT_DETECTION.md`.

## Directive paths

| | |
|---|---|
| Regenerate | see the script named above |
| Aggregate into the top-level results | `../../scripts/collect_results.py` |
| Claim verification | `../../scripts/verify/verify_claims.py` |
