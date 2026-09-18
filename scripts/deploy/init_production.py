#!/usr/bin/env python
"""First-deployment bootstrap for the production service.

Render's persistent disk starts empty, and the serving app is only *ready* once a
model is registered and the ``production`` alias resolves. This script performs that
one-time initialization by **reusing the existing project machinery** -- the same
``scripts/fetch_data.py`` (download + pinned-checksum verify) and ``scripts/train.py``
(validate -> split -> train -> evaluate -> MLflow-track -> register -> set alias)
that a developer runs locally. There is no alternate training path here.

It is **idempotent**, which matters because Render runs the ``preDeployCommand`` on
*every* deploy, not just the first:

* If the ``production`` alias already resolves, it does nothing and exits 0 -- it never
  re-fetches, re-trains, re-registers, or (critically) moves the production pointer.
  A redeploy therefore cannot implicitly change which model version is live, and a
  promotion/rollback an operator performed survives restarts.
* Only when no production model exists does it fetch the data (itself idempotent:
  ``fetch_data`` skips files whose checksum already matches) and train+register the
  first model. ``train.py`` sets the ``production`` alias only when it is unset, so
  even the training step will not clobber an existing pointer.

Run automatically by Render (``preDeployCommand``); can also be run by hand:

    MLSERVE_DATA_ROOT=/var/data python scripts/deploy/init_production.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# scripts/deploy/ -> scripts/ so we can import the existing entrypoints verbatim.
SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from mlserve.config import load_config  # noqa: E402
from mlserve.models.registry import ModelRegistry  # noqa: E402


def _production_ref():
    """Resolve the production alias, or None if the registry is empty/unreachable.

    Building the registry initialises the (SQLite) tracking store on the persistent
    disk if it does not yet exist, which is the correct, idempotent behaviour for a
    first deploy.
    """
    try:
        return ModelRegistry(load_config()).production()
    except Exception as exc:  # a brand-new disk can raise before the store exists
        print(f"registry not initialised yet ({type(exc).__name__}: {exc})")
        return None


def main(argv: list[str] | None = None) -> int:
    existing = _production_ref()
    if existing is not None:
        print(
            f"INIT_PRODUCTION_SKIP: production alias already at version {existing.version}; "
            "leaving model state untouched (no re-fetch, no retrain, no re-register)"
        )
        return 0

    print("INIT_PRODUCTION: no production model found; bootstrapping via the existing scripts")

    import fetch_data  # noqa: E402  (imported late: only needed on the first deploy)
    import train  # noqa: E402

    print("--> scripts/fetch_data.py")
    rc = fetch_data.main([])
    if rc != 0:
        print("INIT_PRODUCTION_FAILED: data fetch/verify returned non-zero", file=sys.stderr)
        return rc

    print("--> scripts/train.py")
    rc = train.main([])
    if rc != 0:
        print("INIT_PRODUCTION_FAILED: training/registration returned non-zero", file=sys.stderr)
        return rc

    ref = _production_ref()
    if ref is None:
        print(
            "INIT_PRODUCTION_FAILED: bootstrap ran but production alias is still unset",
            file=sys.stderr,
        )
        return 1
    print(f"INIT_PRODUCTION_OK: production alias now at version {ref.version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
