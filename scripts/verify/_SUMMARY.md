# `scripts/verify/` — claim and reproducibility verification

The repository's self-audit. These scripts exist because a project that quotes numbers
should be able to prove them, and because the documentation itself is a thing that can drift
out of date.

## Contents

| Script | Purpose |
|---|---|
| `verify_claims.py` | Three checks: every row of the evidence table in the evidence table names a file that exists, a number that actually appears in that file, and a script that exists; no document uses an unqualified overclaim ("production-ready", "zero-downtime", "100% reproducible"); every promised document and result file is present and non-trivial |
| `check_fingerprint.py` | Compares the behaviour fingerprint of a fresh training run against the recorded baseline, so the reproducibility claim is re-checked on every push rather than asserted |
| `verify_clean_env_repro.py` | Builds a fresh virtualenv from the pinned requirements and compares the training fingerprint and metrics against the recorded baseline |
| `run_all.py` | Runs the checks in order (`--full` adds the clean-environment rebuild) |

## Directive paths

| | |
|---|---|
| Overclaim policy | `verify_claims.py` → `FORBIDDEN_UNLESS_QUALIFIED` |
| Recorded baseline | `../../results/summary.json`, `../../REPRODUCIBILITY.md` |
| CI invocation | `../../.github/workflows/ci.yml` → `pipeline` job |
| Run everything | `python scripts/verify/run_all.py [--full]` |
