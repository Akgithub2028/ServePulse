# Engineering report — productionization

What was added to turn a locally reproducible ML platform into a deployed one, what was
deliberately left alone, the defects found along the way, and — separately and honestly —
what has not been verified.

The platform's own method applies here: claims below are either backed by a file in this
repository or explicitly listed as unverified at the end.

---

## 1. Scope

The backend was treated as the baseline. Its behaviour — data contract, validation, feature
engineering, model, training, evaluation, MLflow tracking, registry aliases, drift detection,
retraining criteria, rollback, hot-swap, error contract, Prometheus metrics, monitoring store,
benchmark methodology — was **not** redesigned. The work was deployment, security, CI,
verification, frontend and documentation.

The only backend changes were the minimum needed for a public deployment:

| Change | File | Why it was unavoidable |
|---|---|---|
| Environment-config overlay | `src/mlserve/config.py` (`_apply_env_overrides`) | A deployed service cannot write to the image layer; `MLSERVE_DATA_ROOT` relocates the MLflow store, artefacts, prediction DB, data and results onto the persistent disk. `PORT` was deliberately excluded from this layer |
| Admin-token guard | `src/mlserve/serving/app.py` | An unauthenticated model-swap endpoint on a public URL is not acceptable; the guard is additive and the reload semantics (resolve → load → swap on success → keep incumbent on failure) are untouched |
| CORS allow-list | `src/mlserve/serving/app.py` | A separate static frontend is cross-origin by construction; allow-listed, no credentials, no wildcard |
| Deployment keys in config | `configs/config.yaml` | `serving.cors_allow_origins` and `serving.admin_token` defaults; both inert unless set |
| Host/port plumbing | `scripts/serve.py` | Read `MLSERVE_HOST`/`PORT` for container use while local defaults stay identical |

Everything else in `src/mlserve/` is unchanged, and the recorded evidence (fingerprints,
metrics, benchmarks) still reproduces — asserted in CI.

---

## 2. Files added

### Deployment
| File | Purpose |
|---|---|
| `render.yaml` | The Blueprint: backend Docker web service (persistent disk, single instance, `/ready` health check, idempotent bootstrap) and frontend static site, both `autoDeployTrigger: checksPass` |
| `requirements-deploy.txt` | The image's pin set: slim serving pins **plus** MLflow and pyarrow (the container serves from the registry and runs the bootstrap in place) |
| `docker/entrypoint.sh` | Resolves `$PORT`/`MLSERVE_HOST`, repairs ownership of the mounted data root, drops privileges to uid 10001, `exec`s the given command (or uvicorn) as PID 1 |
| `scripts/deploy/init_production.py` | Idempotent first-deploy bootstrap reusing `fetch_data.py` + `train.py` verbatim |
| `scripts/deploy/verify_deployment.py` | Non-mutating deployed-state verification against a public URL |
| `scripts/deploy/validate_blueprint.py` | Structural deployment invariants plus Render's official JSON schema |
| `scripts/deploy/scan_secrets.py` | Secret gate over tracked files and the Blueprint |
| `scripts/deploy/audit_baseline.txt` | Generated advisory baseline for the deployment pin set, with exposure analysis and remediation path |
| `scripts/verify/check_fingerprint.py` | Fails the build if a fresh training run no longer reproduces the recorded model |

### Frontend (`frontend/`)
React + TypeScript console: five views (`ControlRoom`, `InferenceLab`, `Observability`,
`Provenance`, `Platform`), a typed API client with classified failures, hand-written polling
hooks and SVG charts, a design-token system, and `46` Playwright tests. Detailed in
[FRONTEND.md](FRONTEND.md).

### Tests
`tests/test_deployment_security.py` (16) and `tests/test_deploy_tooling.py` (33).

### Documentation
[DEPLOYMENT.md](DEPLOYMENT.md), [FRONTEND.md](FRONTEND.md), this report, plus a
`_SUMMARY.md` in every directory of the repository (contents + directive paths).

---

## 3. CI failures and defects found, and how each was resolved

The pipeline was not merely extended; writing it surfaced real defects. Each is fixed in a
commit that explains it.

| # | Defect | Consequence if shipped | Fix |
|---|---|---|---|
| 1 | **A static site declared `plan` and `region`** in `render.yaml` | Render's official Blueprint schema rejects both keys on `runtime: static`; the Blueprint would have failed in the dashboard | Caught by validating against the official schema in CI; keys removed and the validator taught to report leaf errors instead of the misleading `anyOf`/`unevaluatedProperties` cascade |
| 2 | **Formatting gate could not pass** | `black --check` failed independently of the tests | One formatter policy (black) applied in a dedicated commit with no behavioural change, separated from every functional change |
| 3 | **Declared Python support was false** | `requires-python` claimed 3.11 while the pins have no cp311 wheels (numpy 2.5.3 ships cp312+) | One coherent policy — floor **3.12**, development 3.13 — enforced by the CI matrix across `pyproject.toml`, requirements, the Docker base image, the Render runtime and the docs |
| 4 | **The container could never write its own persistent disk** | Render mounts the disk owned by root; the image ran as uid 10001 with no repair step. The MLflow store, registry and prediction log would have been unwritable on the first deploy | The init pattern used by the official Postgres/MySQL images: entrypoint repairs ownership of the mount only when needed, then drops to uid 10001 before `exec`. CI asserts the running server's UID rather than trusting the Dockerfile |
| 5 | **`setpriv` was assumed to exist** | `debian:bookworm-slim` ships only `bsdutils`, `libblkid1` and `libmount1` from util-linux, so the privilege-drop binary was not guaranteed. The container would have started as root or refused to start | `util-linux` is installed explicitly in the runtime stage; the entrypoint falls back to `su`, and refuses to start at all if neither is present |
| 6 | **The entrypoint discarded an explicit command** | `docker run <image> python scripts/deploy/init_production.py` would have started the API instead of the bootstrap — Render's `preDeployCommand` could never have worked | An explicit command now wins, which also means the bootstrap runs through the same entrypoint, as the same unprivileged user, after the same ownership repair |
| 7 | **MLflow was missing from the image** | Serving with `model_source: registry` calls `mlflow.sklearn.load_model`; the original `requirements.txt` deliberately excluded MLflow because the container path was file-bundle only. The deployed service would have failed to load any model | `requirements-deploy.txt` adds MLflow and pyarrow for the image only; the benchmarked `requirements.txt` is untouched |
| 8 | **The Docker job only tested a degraded boot** | It asserted the container starts with no model and answers 503 — it never proved the container can *serve* | The job now seeds a root-owned volume like a Render disk, runs the real bootstrap, asserts `INIT_PRODUCTION_OK` then `INIT_PRODUCTION_SKIP`, boots, waits for `/ready`, verifies the API with the same tool used against production, checks SIGTERM exits 0, and restarts on the same volume (with an injected `$PORT`) to prove the model persisted |
| 9 | **Dependency audit could not be a gate** | `pip-audit` reports 28 advisories in the MLflow/pyarrow/cryptography closure the container needs | `requirements.txt` is audited with **no** exceptions (clean). The deployment set's advisories are recorded in a **generated** baseline with exposure analysis, the full findings are printed before the exception list is applied, and anything new still fails the job. The remediation path (MLflow ≥ 3.15) is written down rather than implied |
| 10 | **Reproducibility was asserted, not checked** | Nothing stopped a model change from silently invalidating the recorded fingerprint and the documentation built on it | `scripts/verify/check_fingerprint.py` compares a fresh run against `results/summary.json` on every push; a mismatch fails the build |
| 11 | **`validate_blueprint.py` crashed on non-repo paths** (found by its own tests) | The tool was unusable for a Blueprint path outside the repository | Display helper falls back to the absolute path; regression test added |
| 12 | **One secret pattern was toothless** (found by its own tests) | The Google-API-key pattern required 35 characters after `AIza`; a canonical key failed to match — i.e. a scanner that would silently miss real keys | Pattern corrected and every pattern now has a test asserting it matches its canonical sample |

Items 11 and 12 are worth calling out: they were caught by tests written *for* the tooling,
which is the reason `tests/test_deploy_tooling.py` asserts that each gate fires rather than
only that the committed configuration passes.

---

## 4. Deployment architecture

```
GitHub repo ──► GitHub Actions (the release gate) ──► Render (deploy only on checksPass)
                                                        │
                              ┌─────────────────────────┴────────────────────────┐
                              ▼                                                  ▼
                 mlserve-backend (Docker web service)                mlserve-frontend (static)
                 FastAPI + MLflow/SQLite, /var/data disk             React console → HTTPS API
```

- **Backend**: Docker runtime from `docker/Dockerfile`, plan `starter`, **one instance** with a
  1 GB persistent disk at `/var/data`, health check `/ready`, `maxShutdownDelaySeconds: 30`,
  `preDeployCommand` bootstrap, `autoDeployTrigger: checksPass`.
- **Frontend**: static site, `npm ci && npm run build`, publish `frontend/dist`, SPA rewrite
  `/*` → `/index.html`, `VITE_API_BASE_URL` supplied from the Blueprint.
- **Cross-references**: `MLSERVE_CORS_ORIGINS` (backend) and `VITE_API_BASE_URL` (frontend)
  point at each other; both are documented as the two values to update if Render assigns
  different names.

Full detail in [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 5. Persistent state strategy

`MLSERVE_DATA_ROOT` relocates **all** filesystem state onto the disk: MLflow tracking store
(`sqlite:////var/data/mlflow.db`), artefacts (`file:/var/data/mlruns`), the prediction database,
model bundles, raw/processed data and results. The override is inert unless the variable is
set, so a developer checkout still resolves to the committed `config.yaml` and the recorded
`config_digest` is unchanged.

The first deploy creates the model through the project's own machinery (fetch → validate →
train → register → alias), and every later deploy is a no-op: the bootstrap detects the
existing `production` alias and changes nothing, so an operator's promotion or rollback
survives redeploys.

---

## 6. Security changes

| Area | Before | Now |
|---|---|---|
| `/admin/reload` | Unauthenticated (documented as a known limitation for the local platform) | Requires `X-Admin-Token` or `Authorization: Bearer` when `MLSERVE_ADMIN_TOKEN` is set; structured `401` with no token echoed, an `admin_unauthorized` event recorded, and no reload attempted. `hmac.compare_digest` for the comparison. Open when unset, so local development is unchanged |
| CORS | n/a (no browser client) | Explicit allow-list from `MLSERVE_CORS_ORIGINS`, no credentials, only the correlation headers exposed, backend keeps its error envelopes readable cross-origin |
| Secrets | n/a | The admin token is generated by Render (`generateValue: true`), never committed, never logged, never sent to the browser. A scanner enforces this on every push, and the frontend job greps the built bundle |
| Container | Ran as uid 10001 but could not write its disk | Repairs ownership of the mount, then serves as uid 10001 — asserted by CI against the running process |
| Dependencies | Not audited | `pip-audit` in CI, with a generated, justified baseline for the deployment set only |

The frontend deliberately holds no admin capability: making the browser a privileged console
would mean shipping a credential to every visitor.

---

## 7. Frontend architecture

Five views over the real endpoints — Control Room, Inference Lab, Observability, Model
Provenance, Platform/API — with one typed API client, hand-written polling hooks and SVG
charts, and no fabricated telemetry: where the backend has no data, the view says so rather
than drawing an empty or invented chart. The console renders the backend's own distinction
between "alive" and "ready", distinguishes all five failure classes the API can produce, and
holds no privileged credential. Details, including the bundle breakdown, in
[FRONTEND.md](FRONTEND.md).

---

## 8. Tests added

| Suite | Count | What it proves |
|---|---|---|
| `tests/test_deployment_security.py` | 16 | Deployment configuration is environment-driven, the admin guard behaves correctly (open/required/header/bearer/401-without-echo/no-reload-on-denial), reads stay open, and the overlay is inert when unset |
| `tests/test_deploy_tooling.py` | 33 | The Blueprint validator, secret scanner and fingerprint checker each fail when they should — including one assertion per secret pattern |
| `frontend/tests/e2e/console.spec.ts` | 46 (23 × 2 projects) | Shell and navigation, all five views, live/degraded/unreachable states, successful and rejected predictions, oversized batches, the 422 envelope, window switching, provenance chain, endpoint inventory, narrow viewport, keyboard access, no credential in the DOM or storage |

Backend total: **434 tests**. The existing suite was not weakened, and no test was deleted to
make CI pass.

---

## 9. Verification

**Verified locally in this repository's environment**

| Check | Result |
|---|---|
| `pytest -q` (backend, incl. the two new suites) | 434 passed, 0 failed |
| `pytest tests/test_deploy_tooling.py` | 33 passed |
| `ruff check src tests scripts` / `black --check src tests scripts` | clean |
| `scripts/deploy/validate_blueprint.py` | 26/26 invariants + Render's official schema pass |
| `scripts/deploy/scan_secrets.py` | clean over all tracked files; gate proven to fire on an incomplete baseline |
| `scripts/deploy/init_production.py` | First run created the model and printed `INIT_PRODUCTION_OK`; second run printed `INIT_PRODUCTION_SKIP` |
| `scripts/verify/check_fingerprint.py` | Reproduces `54122c6ae121…` and fails on a tampered fingerprint |
| `scripts/verify/verify_claims.py` | 30/30 evidence rows, 30/30 deliverables, no unqualified overclaims |
| `npm run typecheck` / `npm run lint` / `npm run build` | pass; ~105 kB gzipped with four views code-split |
| `npx playwright test` | 46 passed (desktop + mobile) |

**Verified by CI on `main`** — the full pipeline is green, all ten jobs, on the pushed
commits. The container job's recorded evidence:

| Observed | Value |
|---|---|
| Image built (cold, `buildx`, no layer cache) | 89 s · 839.7 MB |
| First-deploy bootstrap in-container | `INIT_PRODUCTION_OK: production alias now at version 1` (15 s) |
| Bootstrap re-run (idempotency) | `INIT_PRODUCTION_SKIP: production alias already at version 1` (3 s) |
| Service ready after start | `/ready` = 200 on the 3rd poll (~10 s) |
| Deployed API verification | `VERIFY_DEPLOYMENT_OK` — 23/23 checks |
| Serving process identity | `uvicorn pid 4079 runs as uid 10001` |
| Shutdown on SIGTERM | `exit code after SIGTERM: 0` |
| State after restart (injected `$PORT`) | `model version after restart: 1` |
| Backend suite on 3.12 and 3.13 | 467 passed (88 data-contract tests reported separately) |
| Frontend job | `npm ci` → typecheck → lint → build → bundle secret scan → `npm audit` → 46 browser tests |

These figures are recorded with their provenance in
[BENCHMARKS.md](BENCHMARKS.md#docker--measured-in-ci) and are reproducible by re-running the
job.

---

## 10. Known limitations

Stated because a report that omits them is not a report.

1. **Single instance, by construction.** SQLite plus filesystem storage is not multi-writer
   safe, so the deployment runs one instance with a persistent disk. No horizontal scaling is
   claimed.
2. **No zero-downtime releases.** Render disables zero-downtime deploys for services with an
   attached disk. A restart is a brief outage. This is documented in
   [DEPLOYMENT.md](DEPLOYMENT.md), not hidden.
3. **No historical telemetry.** The store aggregates over a rolling window and the Prometheus
   counters are cumulative; there is no per-request history, so no trend chart exists and the
   console does not draw one.
4. **One shared admin secret, not an identity model.** The admin guard is a deployment control,
   not authentication of users. It does not make the service multi-tenant.
5. **Advisories in the deployment dependency closure.** MLflow 3.6.0 and pyarrow 22.0.0 carry
   known advisories; the exposure analysis and the remediation path (MLflow ≥ 3.15.0, as a
   separate tested change) are recorded in `scripts/deploy/audit_baseline.txt`.
6. **Retraining is operator-invoked.** There is no scheduler, no queue and no background job —
   by design, and documented.
7. **Model behaviour limits are unchanged**: drift detection sees input-distribution drift, not
   concept drift; no fairness assessment despite strong demographic associations in the data;
   benchmarks remain single-machine, single-worker, loopback.

---

## 11. Explicitly unverified

Honesty section. None of the following has been executed or confirmed:

- **A live Render deployment.** The Blueprint validates against Render's official schema and the
  container path is verified in CI, but no Blueprint has been applied in a Render account from
  this environment, so the first real deploy — service creation, disk attachment, generated
  token, the pre-deploy bootstrap, the `/ready` gate — has not been observed end to end.
- **The public URLs.** `https://mlserve-backend.onrender.com` and
  `https://mlserve-frontend.onrender.com` are the names the Blueprint requests. Render may
  assign different ones if the names are taken; the two cross-referencing environment values
  must then be updated (documented in [DEPLOYMENT.md](DEPLOYMENT.md)).
- **The two-service local Docker composition** (`docker/docker-compose.yml`, API + MLflow
  server) — reviewed, never executed; the deployed topology does not use it.
- **Persistence across a real Render restart.** The equivalent is verified in CI against a
  Docker volume; the Render disk path itself has not been exercised.
- **Browser behaviour on a real deployed frontend**, since the browser tests run against a
  locally served production bundle with a stubbed backend. The real API contract is verified
  separately by `scripts/deploy/verify_deployment.py`.
