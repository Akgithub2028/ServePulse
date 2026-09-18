#!/usr/bin/env python
"""Assert that this environment reproduces the recorded training result.

The platform claims reproducibility, and ``REPRODUCIBILITY.md`` records the evidence:
a clean environment refits the model and produces *byte-identical predictions* on a
fixed probe set, summarised by the training fingerprint. That claim is only meaningful
if it is re-checked whenever the code, the pins or the machine changes.

This script compares the fingerprint produced by the training run that just happened
(``results/training/last_training_summary.json``, written by ``scripts/train.py``)
against the fingerprint recorded in the committed baseline
(``results/summary.json``, the recorded evidence table), and exits non-zero if they
differ.

Why this is a fair comparison across machines: the fingerprint hashes the fitted
model's ``predict_proba`` output on a fixed probe set at full float64 precision
(``mlserve.models.train.training_fingerprint``). HistGradientBoosting inference is
deterministic integer/threshold arithmetic with a fixed traversal order and no BLAS
reduction, so it does not vary with CPU SIMD width. It has already been reproduced
across two platforms (the recorded macOS/arm64 run and an independent Linux/x86-64
run), so a mismatch here means the *model* changed -- a real regression, not noise.

    python scripts/verify/check_fingerprint.py
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASELINE = ROOT / "results" / "summary.json"
REPRO_DOC = ROOT / "REPRODUCIBILITY.md"
DEFAULT_OBSERVED = ROOT / "results" / "training" / "last_training_summary.json"

#: The repo records the digest in full in summary.json, but REPRODUCIBILITY.md shows a
#: truncated form (``54122c6a...``); accept either as a baseline.
FINGERPRINT_RE = re.compile(r"^\s*\|?\s*Training fingerprint\s*\|.*?([0-9a-f]{32})", re.MULTILINE)


def _display(path: Path) -> str:
    """Path shown in output; falls back to the absolute path for non-repo locations."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def _dig(payload, *keys):
    cur = payload
    for key in keys:
        if not isinstance(cur, dict) or key not in cur:
            return None
        cur = cur[key]
    return cur


def baseline_fingerprint() -> tuple[str, str]:
    """Return (fingerprint, source description) from committed evidence."""
    if BASELINE.exists():
        data = json.loads(BASELINE.read_text())
        fp = _dig(data, "registered", "tags", "training_fingerprint")
        if isinstance(fp, str) and len(fp) >= 32:
            return fp, "results/summary.json (registered.tags.training_fingerprint)"
    if REPRO_DOC.exists():
        m = FINGERPRINT_RE.search(REPRO_DOC.read_text())
        if m:
            return m.group(1), "REPRODUCIBILITY.md (truncated to 32 hex chars)"
    raise SystemExit("could not find a recorded training fingerprint in the repository")


def observed_fingerprint(path: Path) -> str:
    if not path.exists():
        raise SystemExit(
            f"{_display(path)} not found -- run scripts/train.py first "
            "(this check compares a fresh training run against the recorded baseline)"
        )
    data = json.loads(path.read_text())
    fp = _dig(data, "registered", "tags", "training_fingerprint")
    if fp:
        return fp
    runs = data.get("runs") or []
    selected = data.get("selected_run")
    for run in runs:
        if selected is None or run.get("run_name") == selected or run.get("estimator") == selected:
            if run.get("training_fingerprint"):
                return run["training_fingerprint"]
    for run in runs:
        if run.get("training_fingerprint"):
            return run["training_fingerprint"]
    raise SystemExit(f"no training_fingerprint found in {_display(path)}")


def compare(expected: str, observed: str) -> bool:
    """Compare on the shortest common prefix (the documented baseline may be truncated)."""
    n = min(len(expected), len(observed))
    return expected[:n] == observed[:n]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--observed",
        type=Path,
        default=DEFAULT_OBSERVED,
        help="training summary produced by the run under test",
    )
    args = parser.parse_args(argv)

    expected, source = baseline_fingerprint()
    observed = observed_fingerprint(args.observed)

    print(f"baseline : {expected}  ({source})")
    print(f"observed : {observed}  ({_display(args.observed)})")
    if compare(expected, observed):
        print("FINGERPRINT_CHECK_OK: this environment reproduces the recorded model")
        return 0

    print(
        "\nFINGERPRINT_CHECK_FAILED: the model produced here differs from the recorded one.\n"
        "The fitted model's predictions changed, which means one of: input data, split,\n"
        "feature pipeline, estimator params, or the pinned library versions. Investigate\n"
        "before updating any recorded evidence.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
