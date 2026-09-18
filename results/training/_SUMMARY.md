# `results/training/` — Recorded training evidence

## Contents

`last_training_summary.json` — the most recent run's split sizes, per-model metrics, leakage report, environment capture, code and data versions, and the behaviour fingerprint. Written by `scripts/train.py`; compared against the baseline by `scripts/verify/check_fingerprint.py`.

## Directive paths

| | |
|---|---|
| Regenerate | see the script named above |
| Aggregate into the top-level results | `../../scripts/collect_results.py` |
| Claim verification | `../../scripts/verify/verify_claims.py` |
