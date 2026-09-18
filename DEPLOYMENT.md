# Deployment

How this platform is deployed, what the deployment actually guarantees, and — just as
importantly — what it deliberately does not.

The short version: **a production-style, single-instance deployment of the real
architecture.** The platform's storage is SQLite and filesystem-backed, so the deployed
service runs one instance with a persistent disk. It does not claim horizontal scaling or
zero-downtime releases, because Render disables zero-downtime deploys for services with an
attached disk and the storage design is not multi-writer safe. Those are properties of the
architecture, documented rather than hidden.

---

## Topology

```
GitHub repository ──► GitHub Actions CI ──► Render (deploy only if checks passed)
                                              │
                           ┌──────────────────┴───────────────────┐
                           ▼                                      ▼
              mlserve-backend (Docker web service)      mlserve-frontend (static site)
              FastAPI + MLflow/SQLite on a disk          React console, HTTPS → API
              /var/data  (persistent, 1 GB)              VITE_API_BASE_URL from env
```

Both services declare `autoDeployTrigger: checksPass`, so a commit that fails CI is never
deployed. There is no second deployment path.

| Component | Where | Notes |
|---|---|---|
| Blueprint | [`render.yaml`](render.yaml) | Validated in CI against Render's official JSON schema |
| Image | [`docker/Dockerfile`](docker/Dockerfile) | Multi-stage, non-root at runtime, no model baked in |
| Entrypoint | [`docker/entrypoint.sh`](docker/entrypoint.sh) | Resolves `$PORT`, repairs the disk mount, drops privileges, execs uvicorn as PID 1 |
| Runtime pins | [`requirements-deploy.txt`](requirements-deploy.txt) | Serving pins **plus** MLflow and pyarrow |
| First-deploy bootstrap | [`scripts/deploy/init_production.py`](scripts/deploy/init_production.py) | Idempotent; reuses the project's own fetch/train/register machinery |
| Deployed-state verifier | [`scripts/deploy/verify_deployment.py`](scripts/deploy/verify_deployment.py) | Non-mutating smoke test against a public URL |
| Blueprint validator | [`scripts/deploy/validate_blueprint.py`](scripts/deploy/validate_blueprint.py) | Structural invariants + official schema |
| Secret scanner | [`scripts/deploy/scan_secrets.py`](scripts/deploy/scan_secrets.py) | Runs on every push |

---

## Services

### Backend — `mlserve-backend`

| Setting | Value | Why |
|---|---|---|
| Runtime | Docker, context `.`, Dockerfile `./docker/Dockerfile` | The container is the deployment artefact; CI builds, boots and exercises it |
| Plan | `starter` | A persistent disk requires a paid instance type |
| Instances | **1** | SQLite + filesystem state is not safe for concurrent multi-instance writers |
| Health check | `/ready` | Readiness, not liveness — see [Health semantics](#health-semantics) |
| Shutdown delay | 30 s | uvicorn is PID 1 and drains in-flight requests on SIGTERM |
| Disk | `mlserve-data`, mounted at `/var/data`, 1 GB | Every piece of filesystem state lives here |
| Bootstrap | `preDeployCommand: python scripts/deploy/init_production.py` | Idempotent, runs on every deploy |
| Auto-deploy | `checksPass` | CI is the release gate |

### Frontend — `mlserve-frontend`

| Setting | Value |
|---|---|
| Runtime | `static` (Render serves static sites free of charge and region-agnostically — the service intentionally declares **no** `plan` and **no** `region`, which the official Blueprint schema rejects on a static service) |
| Build | `cd frontend && npm ci && npm run build` |
| Publish | `./frontend/dist` |
| Routing | SPA rewrite `/*` → `/index.html`, so client-side routes survive a refresh |
| Auto-deploy | `checksPass` |

---

## Persistent state

Render's service filesystem is ephemeral: without a disk, the model registry, its artefacts
and the prediction log would disappear on every restart and redeploy.

Rather than rewriting the storage layer, the deployment relocates it. `MLSERVE_DATA_ROOT`
is read by `mlserve.config._apply_env_overrides` and remaps **every** filesystem path:

| State | Local (repository) | Deployed (`/var/data`) |
|---|---|---|
| MLflow tracking store | `mlflow.db` | `/var/data/mlflow.db` (`sqlite:////var/data/mlflow.db`) |
| MLflow artefacts | `./mlruns` | `/var/data/mlruns` (`file:/var/data/mlruns`) |
| Prediction store | `artifacts/predictions.sqlite` | `/var/data/predictions.sqlite` |
| Model bundles | `artifacts/` | `/var/data/artifacts/` |
| Raw data, processed data, scenarios | `data/…` | `/var/data/{raw,processed,scenarios}` |
| Results | `results/` | `/var/data/results/` |

Three properties make this safe:

1. **Local development is untouched.** The override is inert unless the variable is set, so
   a developer checkout resolves to exactly the committed `config.yaml` — the same digest
   the recorded results were produced under.
2. **`PORT` is deliberately excluded** from the config layer. Render injects a generic
   `PORT`; reading it into config would let a stray `PORT` in a developer shell change local
   behaviour. Only the container entrypoint consumes it.
3. **The application user owns the data.** The entrypoint repairs ownership of the mount and
   then drops to uid 10001 before starting the server, so the MLflow store is writable by a
   non-root process.

---

## First-deploy bootstrap

The deployed service must not need a human to prepare model state. Render's
`preDeployCommand` runs [`scripts/deploy/init_production.py`](scripts/deploy/init_production.py)
on every deploy, which is **idempotent by design**:

```
production alias resolves?
├── yes → INIT_PRODUCTION_SKIP; exit 0
│         no re-fetch, no retrain, no re-register, and critically no alias movement,
│         so an operator's promotion or rollback survives every redeploy
└── no  → INIT_PRODUCTION: run the project's own machinery, unchanged
          scripts/fetch_data.py  (download + pinned-checksum verify)
          scripts/train.py       (validate → split → train → evaluate → track → register
                                  → set the production alias, only if unset)
```

There is **no alternate training path for deployment**: the bootstrap imports and calls the
same entry points a developer runs locally. Because `train.py` sets the `production` alias
only when it is unset, even the training step cannot silently move a pointer an operator set.

> **Note on `initialDeployHook`.** An earlier design considered Render's
> `initialDeployHook` for one-time seeding. It is not used: the hook is a one-shot and this
> bootstrap must also be correct on redeploys, which is exactly what `preDeployCommand`
> plus an idempotent guard provides. The bootstrap itself is the substitution.

---

## Health semantics

The platform distinguishes two questions, and the deployment must respect the difference:

| Endpoint | Answers | Behaviour |
|---|---|---|
| `/health` | "is the process alive?" | Always **200** while the process runs. With no model loaded it reports `status: degraded` — a restart cannot fix an empty registry, so a liveness probe must not trigger one |
| `/ready` | "can this instance serve traffic?" | **200** only when a model is genuinely loadable; otherwise **503** with a `model_not_loaded` envelope |

Render's `healthCheckPath` is therefore `/ready`. Wiring it to `/health` would route traffic
to an instance that cannot answer a prediction.

---

## Environment variables (backend)

| Variable | Source | Purpose |
|---|---|---|
| `MLSERVE_DATA_ROOT` | Blueprint (`/var/data`) | Relocates all filesystem state onto the disk |
| `MLSERVE_HOST` | Blueprint (`0.0.0.0`) | Containers must bind all interfaces |
| `MLSERVE_MODEL_SOURCE` | Blueprint (`registry`) | Serve through the real registry (aliases, promotion, rollback) |
| `MLSERVE_MODEL_ALIAS` | Blueprint (`production`) | Which alias is served |
| `MLSERVE_ADMIN_TOKEN` | `generateValue: true` | Guards `POST /admin/reload`. Generated by Render; never committed, never logged, never sent to the browser |
| `MLSERVE_CORS_ORIGINS` | Blueprint (frontend origin) | Explicit allow-list. **Never a wildcard** |
| `OMP_NUM_THREADS`, `OPENBLAS_NUM_THREADS`, `MKL_NUM_THREADS` | Blueprint (`1`) | The measured 2.6–5.1× throughput finding — see [BENCHMARKS.md](BENCHMARKS.md) |
| `PORT` | Injected by Render | Consumed by `docker/entrypoint.sh` and `scripts/serve.py`, never by config |
| `MLSERVE_CONFIG` | Image (`/app/configs/config.yaml`) | Points at the committed configuration |

Frontend (build-time only — everything `VITE_`-prefixed is public):

| Variable | Value | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | backend URL | The API base the static bundle calls |

---

## Security posture

- **Administrative surface stays out of the browser.** `POST /admin/reload` requires
  `X-Admin-Token` (or `Authorization: Bearer`) whenever `MLSERVE_ADMIN_TOKEN` is set, and
  returns a structured `401` otherwise. The console deliberately does not call it: making
  the browser a privileged operations console would mean shipping a credential to every
  visitor.
- **CORS is an allow-list.** Only the configured frontend origin is accepted, no credentials
  are allowed, and only the correlation headers (`X-Request-ID`, `X-Model-Version`) are
  exposed. Both directions are asserted by the deployment verifier and by
  `tests/test_deployment_security.py`.
- **No secrets in the bundle.** The CI frontend job greps the built output for credential
  patterns and for any reference to the admin token, and `scripts/deploy/scan_secrets.py`
  scans every tracked file plus the Blueprint on each push.
- **Containers do not run as root.** The server process is uid 10001; CI reads the UID of the
  running uvicorn process rather than trusting the Dockerfile.
- **Dependency advisories are tracked, not ignored.** `requirements.txt` is audited with no
  exceptions. The deployment set adds MLflow + pyarrow, whose known advisories are recorded
  — with exposure analysis and a remediation path — in
  [`scripts/deploy/audit_baseline.txt`](scripts/deploy/audit_baseline.txt); anything not on
  that list fails the build.

---

## Operating it

**Verify a deployment** (non-mutating; never promotes, rolls back or reloads):

```bash
python scripts/deploy/verify_deployment.py \
  --backend-url https://mlserve-backend.onrender.com \
  --frontend-url https://mlserve-frontend.onrender.com
```

It checks HTTPS reachability, `/health`, `/ready`, `/model-info`, `/predict` (valid,
out-of-range, empty and oversized payloads), the documented error envelope, the correlation
and model-version headers, `/metrics`, `/monitoring/summary`, that `/admin/reload` is
**401 without a token**, that the frontend origin is allowed by CORS while an unlisted origin
is not, and that the frontend serves a real built bundle instead of a dev page.

**Validate the Blueprint before pushing:**

```bash
python scripts/deploy/validate_blueprint.py    # invariants + Render's official schema
```

**Promote or roll back** — registry semantics are unchanged from the local platform: the
alias moves, the version does not. Reload the deployed service afterwards to pick the change
up without a restart:

```bash
curl -X POST https://mlserve-backend.onrender.com/admin/reload \
  -H "X-Admin-Token: $MLSERVE_ADMIN_TOKEN"     # read the value from the Render dashboard
```

The incumbent keeps serving until the replacement loads successfully; if loading fails, the
reload returns `503` **and the previous model stays live**.

### First deployment, in order

1. Push to `main`. CI must pass — Render will not deploy otherwise.
2. Optionally create both services from `render.yaml` in the Render dashboard
   (**New → Blueprint**, pointed at the repository).
3. Confirm `MLSERVE_ADMIN_TOKEN` was generated and copy it into your own secret store.
4. Watch the pre-deploy log: the first deploy prints `INIT_PRODUCTION_OK` after creating the
   first model; later deploys print `INIT_PRODUCTION_SKIP`.
5. Point `MLSERVE_CORS_ORIGINS` (backend) and `VITE_API_BASE_URL` (frontend) at each other's
   real URLs if Render assigned different names than `mlserve-backend` / `mlserve-frontend`.
6. Run the verifier above against both public URLs.

---

## Limits of this deployment

| Limit | Consequence | Would need |
|---|---|---|
| SQLite + filesystem storage | One instance only; no multi-writer scaling | A shared database and object store |
| Single instance | A restart is a brief outage | Multiple instances + external state |
| Persistent disk | Render disables zero-downtime deploys for disk-backed services | Diskless instances + external state |
| Aggregated monitoring | No per-request history, so no historical trend charts | A metrics backend or a store change |
| No queue, cache or scheduler | Retraining and drift runs are operator-invoked scripts, not background jobs | A scheduler and a job store |
| In-process MLflow client | The container imports MLflow; no MLflow server is exposed | A managed tracking server |

The platform is deliberately **not** called "production-scale" or "horizontally scalable".
It is a production-style deployment of a single-instance architecture, with the constraints
above stated rather than glossed.
