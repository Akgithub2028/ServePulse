#!/bin/sh
# Container entrypoint for the mlserve serving API.
#
# Three jobs, in order:
#
# 1. Resolve runtime configuration. Render (and most PaaS) inject the port to bind as
#    $PORT, which is not known at image-build time. The same image must bind 8077
#    locally and $PORT on Render, so the port is resolved here from the environment.
#    $PORT is deliberately NOT read by mlserve.config: a stray PORT in a developer
#    shell must not silently change local behaviour, so only this entrypoint consumes it.
#
# 2. Repair ownership of the persistent data root, then drop privileges. A mounted
#    persistent disk (Render) or named volume (docker) arrives owned by root, and a
#    non-root process cannot write to it -- which breaks the MLflow SQLite store, the
#    model registry and the prediction log. This is the standard init pattern: the
#    entrypoint starts as root, fixes ownership of the *mount* only, and hands off to
#    the unprivileged application user. The server process itself never runs as root
#    (CI asserts the serving process UID is 10001, not 0). Repair is skipped when the
#    tree is already owned by the app user, so restarts are cheap and idempotent.
#
# 3. `exec` uvicorn so it becomes PID 1 and receives SIGTERM directly -- which is what
#    makes shutdown graceful (stop accepting, drain in-flight requests) rather than a
#    hard kill, and what Render's maxShutdownDelaySeconds relies on.
#
# Intra-op thread pools stay capped at 1: this is the measured 2.6-5.1x throughput
# finding (BENCHMARKS.md), not a guess.
set -eu

PORT="${PORT:-8077}"
HOST="${MLSERVE_HOST:-0.0.0.0}"
WORKERS="${MLSERVE_WORKERS:-1}"
APP_USER="${MLSERVE_APP_USER:-mlserve}"
APP_UID="${MLSERVE_APP_UID:-10001}"
APP_GID="${MLSERVE_APP_GID:-10001}"
DATA_ROOT="${MLSERVE_DATA_ROOT:-/app/data}"
PYTHON_BIN="/opt/venv/bin/python"
if [ ! -x "$PYTHON_BIN" ]; then
    PYTHON_BIN="python"
fi

export OMP_NUM_THREADS="${OMP_NUM_THREADS:-1}"
export OPENBLAS_NUM_THREADS="${OPENBLAS_NUM_THREADS:-1}"
export MKL_NUM_THREADS="${MKL_NUM_THREADS:-1}"
export VECLIB_MAXIMUM_THREADS="${VECLIB_MAXIMUM_THREADS:-1}"
export NUMEXPR_NUM_THREADS="${NUMEXPR_NUM_THREADS:-1}"

# Values are interpolated into a command line, so refuse anything unexpected rather
# than letting a malformed value reach uvicorn through the privilege-drop fallback.
case "$PORT" in
    '' | *[!0-9]*) echo "mlserve: refusing to start: PORT must be numeric, got '$PORT'" >&2; exit 1 ;;
esac
case "$HOST" in
    '' | *[!A-Za-z0-9.:_-]*) echo "mlserve: refusing to start: MLSERVE_HOST '$HOST' is not a valid bind address" >&2; exit 1 ;;
esac
case "$WORKERS" in
    '' | *[!0-9]*) echo "mlserve: refusing to start: MLSERVE_WORKERS must be numeric, got '$WORKERS'" >&2; exit 1 ;;
esac

# An explicit command wins (docker run <image> <cmd>), which is what Render's
# preDeployCommand uses to run scripts/deploy/init_production.py through this same
# entrypoint -- so the bootstrap gets the same ownership repair and the same
# unprivileged user as the server. With no command, the default is the API server.
BOOTSTRAP_PRODUCTION=0
if [ "$#" -eq 0 ]; then
    BOOTSTRAP_PRODUCTION=1
    set -- uvicorn mlserve.serving.main:app \
        --host "$HOST" \
        --port "$PORT" \
        --workers "$WORKERS" \
        --no-access-log
    echo "mlserve: starting the API on ${HOST}:${PORT} with ${WORKERS} worker(s); OMP_NUM_THREADS=${OMP_NUM_THREADS}"
else
    echo "mlserve: running command: $*"
fi

if [ "$(id -u)" != "0" ]; then
    # Already unprivileged (e.g. `docker run --user 10001`). Nothing to drop or repair;
    # if the data root is unwritable the app reports it clearly instead of failing silently.
    echo "mlserve: running as $(id -un) (uid $(id -u))"
    if [ "$BOOTSTRAP_PRODUCTION" -eq 1 ]; then
        "$PYTHON_BIN" scripts/deploy/init_production.py || true
    fi
    exec "$@"
fi

if [ -n "$DATA_ROOT" ]; then
    mkdir -p "$DATA_ROOT" 2>/dev/null || true
    if [ -d "$DATA_ROOT" ]; then
        if [ -n "$(find "$DATA_ROOT" ! -user "$APP_UID" -print -quit 2>/dev/null)" ]; then
            echo "mlserve: repairing ownership of ${DATA_ROOT} for uid ${APP_UID}"
            chown -R "$APP_UID:$APP_GID" "$DATA_ROOT" 2>/dev/null || \
                echo "mlserve: WARNING could not chown ${DATA_ROOT}; the service may fail to persist state" >&2
        fi
    fi
fi

# Ensure /app/artifacts is also present and owned by app user
mkdir -p /app/artifacts 2>/dev/null || true
if [ -d /app/artifacts ]; then
    if [ -n "$(find /app/artifacts ! -user "$APP_UID" -print -quit 2>/dev/null)" ]; then
        chown -R "$APP_UID:$APP_GID" /app/artifacts 2>/dev/null || true
    fi
fi

if command -v setpriv >/dev/null 2>&1; then
    if [ "$BOOTSTRAP_PRODUCTION" -eq 1 ]; then
        echo "mlserve: ensuring production model is bootstrapped..."
        setpriv --reuid="$APP_UID" --regid="$APP_GID" --init-groups "$PYTHON_BIN" scripts/deploy/init_production.py || true
    fi
    exec setpriv --reuid="$APP_UID" --regid="$APP_GID" --init-groups "$@"
fi

# Fallback for a base image without util-linux. `su -c` needs one command string, so the
# argv assembled above is re-joined -- safe because every component was validated above.
if command -v su >/dev/null 2>&1; then
    echo "mlserve: setpriv unavailable, dropping privileges with su"
    if [ "$BOOTSTRAP_PRODUCTION" -eq 1 ]; then
        echo "mlserve: ensuring production model is bootstrapped..."
        su -s /bin/sh "$APP_USER" -c "$PYTHON_BIN scripts/deploy/init_production.py" || true
    fi
    exec su -s /bin/sh "$APP_USER" -c "$*"
fi

# Refuse to run the server as root. A deployment that fails here fails predictably and
# visibly, which is strictly better than silently serving with unnecessary privileges.
echo "mlserve: refusing to start as root: no privilege-drop tool (setpriv/su) found" >&2
exit 1
