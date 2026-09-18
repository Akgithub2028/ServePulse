#!/bin/sh
# Container entrypoint for the mlserve serving API.
#
# Why a script and not a bare `uvicorn` ENTRYPOINT:
#   * Render (and most PaaS) inject the port to bind as $PORT at runtime; it is not
#     known at image-build time. The same image must bind 8077 locally and $PORT on
#     Render, so the port is resolved here from the environment.
#   * `exec` replaces this shell with uvicorn so uvicorn becomes PID 1 and receives
#     SIGTERM directly -- which is what makes shutdown graceful (stop accepting,
#     drain in-flight requests) rather than a hard kill.
#
# Intra-op thread pools stay capped at 1: this is the measured 2.6-5.1x throughput
# finding (BENCHMARKS.md), not a guess. They are already ENV in the image and are
# re-asserted here so the compose path gets the same behaviour.
set -eu

PORT="${PORT:-8077}"
HOST="${MLSERVE_HOST:-0.0.0.0}"
WORKERS="${MLSERVE_WORKERS:-1}"

export OMP_NUM_THREADS="${OMP_NUM_THREADS:-1}"
export OPENBLAS_NUM_THREADS="${OPENBLAS_NUM_THREADS:-1}"
export MKL_NUM_THREADS="${MKL_NUM_THREADS:-1}"
export VECLIB_MAXIMUM_THREADS="${VECLIB_MAXIMUM_THREADS:-1}"
export NUMEXPR_NUM_THREADS="${NUMEXPR_NUM_THREADS:-1}"

echo "mlserve: binding ${HOST}:${PORT} with ${WORKERS} worker(s); OMP_NUM_THREADS=${OMP_NUM_THREADS}"

exec uvicorn mlserve.serving.main:app \
    --host "$HOST" \
    --port "$PORT" \
    --workers "$WORKERS" \
    --no-access-log
