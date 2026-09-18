# `docker/` — container image and local composition

## Contents

- `Dockerfile` — two-stage serving image: `python:3.13.9-slim-bookworm` pinned to an exact
  patch version, compilers kept in the builder stage, only the virtualenv copied forward.
  Installs `requirements-deploy.txt` (the slim serving set **plus** MLflow and pyarrow,
  because the container serves from the registry and runs the first-deploy bootstrap).
  Pins BLAS/OpenMP threads to 1, adds `util-linux` for `setpriv`, creates uid 10001, and
  deliberately sets **no** `USER` directive — see below.
- `entrypoint.sh` — resolves `$PORT`/`MLSERVE_HOST`, repairs ownership of the mounted data
  root, drops privileges to uid 10001, and `exec`s the given command (or uvicorn) as PID 1.
- `docker-compose.yml` — local composition of the API with an MLflow tracking server.

No model is baked into the image: an image containing its weights would have to be rebuilt to
promote a model, which would defeat the registry.

The image is built, booted and exercised by the `docker` job in
[`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) on every push: root-owned volume
like a Render disk, real bootstrap, readiness, API verification, non-root check, clean SIGTERM
shutdown, and model persistence across a restart.

## Directive paths

| | |
|---|---|
| Entry point of the image | `entrypoint.sh` (referenced by the Dockerfile `ENTRYPOINT`) |
| Runtime dependencies | `../requirements-deploy.txt` |
| Port handling | `entrypoint.sh` (`$PORT`) and `../scripts/serve.py` |
| Bootstrap it runs on deploy | `../scripts/deploy/init_production.py` |
| Local composition | `docker-compose.yml` |
| The deployment it serves | `../render.yaml`, `../DEPLOYMENT.md` |
