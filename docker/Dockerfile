# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Serving image for the mlserve Adult income classifier.
#
# Verified by CI, not by hand: the `docker` job in .github/workflows/ci.yml builds this
# image, runs the first-deploy bootstrap against a mounted volume, boots the service and
# exercises the real API surface (readiness, prediction, error contract, CORS), checks
# that the serving process is non-root, and restarts the container to prove the state
# persisted. Image size and container start-up time are reported by that job and remain
# marked UNVERIFIED in BENCHMARKS.md until the measured numbers are recorded there --
# this repository quotes no number it has not observed.
#
# Two stages so that build tooling never reaches the runtime image: the wheels are
# assembled in `builder` and only the installed site-packages are copied forward.
# ---------------------------------------------------------------------------

# Pinned to an exact patch version, not `3.13-slim` and not `latest`: a floating tag
# means two builds of the same commit can produce different images, which would
# undermine every reproducibility claim this project makes.
FROM python:3.13.9-slim-bookworm AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build

# gcc is needed only if a wheel is unavailable for this platform; it stays in the
# builder stage and never reaches the runtime image.
RUN apt-get update \
 && apt-get install --no-install-recommends -y gcc g++ \
 && rm -rf /var/lib/apt/lists/*

# Requirements are copied before the source so that a code change does not invalidate
# the dependency layer, which is by far the slowest part of the build.
#
# The image installs requirements-deploy.txt = the slim serving set PLUS MLflow and
# pyarrow, because this container keeps the platform's real registry architecture and
# runs the first-deploy bootstrap (scripts/deploy/init_production.py) in place. Both
# import MLflow. requirements.txt alone cannot serve from the registry or train.
COPY requirements.txt requirements-deploy.txt ./
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/venv/bin/pip install --no-cache-dir -r requirements-deploy.txt

COPY pyproject.toml README.md ./
COPY src ./src
RUN /opt/venv/bin/pip install --no-cache-dir --no-deps .

# ---------------------------------------------------------------------------

FROM python:3.13.9-slim-bookworm AS runtime

LABEL org.opencontainers.image.title="mlserve" \
      org.opencontainers.image.description="Adult income classifier serving API" \
      org.opencontainers.image.source="https://github.com/Akgithub2028/ServePulse"

# HOME points at the unprivileged application user's home: without it MLflow and
# plotting caches fall back to /root, which uid 10001 cannot write.
#
# Thread pools are pinned to 1 because intra-op parallelism measurably hurts this
# workload (2.6-5.1x throughput at OMP_NUM_THREADS=1, BENCHMARKS.md): for one-row online
# inference the pool costs more than the work it parallelises, and oversubscription
# across concurrent requests is a common cause of tail latency in model servers.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    MLSERVE_CONFIG=/app/configs/config.yaml \
    MLSERVE_PROJECT_ROOT=/app \
    MLSERVE_DATA_ROOT=/app/data \
    HOME=/home/mlserve \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1

# util-linux is installed explicitly rather than assumed: `debian:bookworm-slim` does not
# ship the `util-linux` package (only bsdutils/libblkid1/libmount1), so `setpriv` cannot be
# taken for granted. The entrypoint needs it to drop from root to the unprivileged
# application user after repairing the persistent-disk mount; if it were missing there,
# the container would refuse to start rather than serve as root, so its presence is
# guaranteed by construction here. No other package is added to the runtime image.
RUN apt-get update \
 && apt-get install --no-install-recommends -y util-linux \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY configs ./configs
COPY src ./src
# scripts/ ships so the first-deploy bootstrap (scripts/deploy/init_production.py,
# run via the Render preDeployCommand) can reuse the existing fetch/train/register
# machinery in place. The other scripts are inert in the container.
COPY scripts ./scripts
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# The image serves a model bundle mounted at /app/artifacts/current. The model is
# deliberately NOT baked in: an image that contains its weights has to be rebuilt to
# promote a model, which defeats the registry. `serving.model_source: file` reads the
# mounted bundle; `registry` reaches an MLflow server instead.
RUN mkdir -p /app/artifacts /app/data /app/data/raw /app/data/processed /app/data/scenarios /app/data/artifacts /app/data/results /app/data/mlruns

# The application user. It owns the app tree and is the identity the *serving process*
# runs as (uid 10001) -- asserted at runtime by the CI docker job, which reads the UID of
# the uvicorn process rather than trusting this file.
#
# NOTE: no `USER` directive is set on purpose. The entrypoint must start as root for one
# reason only: a Render persistent disk (or a docker named volume) is mounted owned by
# root, and a non-root process cannot write to it, which would break the MLflow SQLite
# store, the model registry and the prediction log. `docker/entrypoint.sh` repairs
# ownership of the mount and then drops to uid 10001 before exec'ing uvicorn, so the
# server itself is never privileged (`docker run --user 10001` also works and skips the
# repair). This is the same init pattern the official Postgres/MySQL images use.
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && useradd --create-home --user-group --shell /usr/sbin/nologin --uid 10001 mlserve \
 && chown -R mlserve:mlserve /app

# 8077 is the local default; on Render the port is injected as $PORT at runtime and
# the entrypoint binds that instead. EXPOSE is documentation, not a restriction.
EXPOSE 8077

# Readiness, not liveness: /ready is 503 until a model is actually loaded, so the
# orchestrator will not route traffic to an instance that cannot answer. PORT-aware
# so the check works locally (8077) and in a container ($PORT) with the same image.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import os,sys,urllib.request;p=os.environ.get('PORT','8077');sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{p}/ready',timeout=4).status==200 else 1)"

# The entrypoint resolves $PORT/$HOST and execs uvicorn as PID 1 for graceful
# SIGTERM shutdown. No model state is baked in: the bundle is mounted read-only at
# /app/artifacts/current (file source) or resolved from the registry, so promoting a
# model never requires rebuilding this image.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

