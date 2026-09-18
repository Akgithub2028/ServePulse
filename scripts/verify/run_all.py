#!/usr/bin/env python
"""Run every acceptance check in order.

    python scripts/verify/run_all.py            # fast checks (claims + deliverables)
    python scripts/verify/run_all.py --full     # also rebuild a clean venv and compare

Fast path: `verify_claims.py` (evidence table integrity, overclaim scan,
deliverables). `--full` adds `verify_clean_env_repro.py`, which builds a fresh
virtualenv from the pinned requirements and compares the training fingerprint
and metrics against the recorded baseline (slow: several minutes).
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def run(script: str, python: str) -> int:
    print(f"\n{'=' * 70}\n{script}\n{'=' * 70}")
    return subprocess.call([python, str(HERE / script)])


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--full", action="store_true", help="also run the clean-environment reproducibility check"
    )
    args = parser.parse_args()

    python = sys.executable
    failed = []
    if run("verify_claims.py", python) != 0:
        failed.append("verify_claims.py")
    if args.full and run("verify_clean_env_repro.py", python) != 0:
        failed.append("verify_clean_env_repro.py")

    if failed:
        print(f"\nVERIFY_FAILED: {', '.join(failed)}", file=sys.stderr)
        return 1
    print("\nVERIFY_ALL_OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
