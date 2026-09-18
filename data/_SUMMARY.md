# `data/` — datasets

## Contents

- `raw/` — the UCI Adult files, downloaded and checksum-verified by `scripts/fetch_data.py`.
  The files themselves are **not committed** (≈6 MB); the SHA-256 of both is pinned in
  `src/mlserve/data/ingest.py` and verified on every load, so the data is reproducible
  without being redistributed.

`processed/` and `scenarios/` are generated at runtime (splits; synthetic drift scenarios) and
are gitignored.

## Directive paths

| | |
|---|---|
| Pinned checksums | `../src/mlserve/data/ingest.py` |
| Download + verify | `../scripts/fetch_data.py` |
| Where the paths are configured | `../configs/config.yaml` → `paths:` |
| Deployed location of this directory | `MLSERVE_DATA_ROOT/raw` on the persistent disk (`../DEPLOYMENT.md`) |
