# CI / CD

The pipeline is the release gate. Both Render services declare `autoDeployTrigger: checksPass`,
so **nothing deploys unless this workflow is green on `main`** — there is no second path to
production.

Workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml) · Runs:
<https://github.com/Akgithub2028/GitPushTern/actions>

The pipeline runs green on `main`: all ten jobs pass, and the container job's evidence is
recorded in [BENCHMARKS.md](BENCHMARKS.md#docker--measured-in-ci) — image built (89 s,
839.7 MB), first-deploy bootstrap executed in-container, bootstrap re-run proving idempotency,
service ready, deployed API verified (23/23 checks), serving process confirmed non-root
(uid 10001), SIGTERM exit code 0, and the model intact after a restart on the same volume.

> **History, stated plainly.** During the original development of this platform, no container
> runtime was available on the development machine and the workflow had not been executed on
> GitHub Actions. Those facts are preserved below because they are why a Docker verification
> job exists at all. The status of each job *now* is the table in this section; the
> historical caveats are kept in [Historical notes](#historical-notes).

| Job | What it does | Gate |
|---|---|---|
| `lint` | `ruff check` + `black --check` over `src`, `tests`, `scripts` | hard fail |
| `secrets` | Scans every tracked file and the Blueprint for credentials | hard fail |
| `blueprint` | Structural deployment invariants + Render's official JSON schema | hard fail |
| `test` | Full suite on **Python 3.12 and 3.13** | hard fail |
| `pipeline` | train → **reproducibility** → smoke test → drift experiment | hard fail |
| `docker` | Builds the image, runs the real bootstrap, boots and verifies the API | hard fail |
| `frontend` | `npm ci`, type-check, lint, production build, bundle secret scan, `npm audit`, Playwright | hard fail |
| `audit` | `pip-audit` on the serving and deployment pin sets | hard fail |
| `release-readiness` | `main` only, after every other job — states exactly what is being released | gate |

Every job runs on free `ubuntu-latest` runners: no GPU, no paid runner, no cloud account and
no secret. The only network dependency is the pinned UCI dataset, cached by checksum.

---

## What each job actually verifies

**`lint`** — `ruff check src tests scripts` and `black --check --diff` over the same tree.
One formatting policy (black) with ruff for lint; the repository is clean under both.

**`secrets`** — [`scripts/deploy/scan_secrets.py`](scripts/deploy/scan_secrets.py) fails the
build on high-signal credential patterns (GitHub tokens, cloud keys, private-key blocks,
provider API keys, JWTs) and on assignment-shaped secrets that are not obvious placeholders.
It additionally enforces two deployment invariants: the Blueprint must **generate** the admin
token rather than carry one, and no `VITE_`-prefixed variable — those are inlined into the
public bundle — may be secret-shaped.

**`blueprint`** — [`scripts/deploy/validate_blueprint.py`](scripts/deploy/validate_blueprint.py)
checks what the deployment must be true of:

- one instance (SQLite/filesystem storage is not multi-writer safe),
- `/ready` as the health check, not `/health`,
- a persistent disk whose `mountPath` equals `MLSERVE_DATA_ROOT`,
- an idempotent `preDeployCommand` bootstrap,
- `autoDeployTrigger: checksPass`,
- a **generated** admin token and a non-wildcard CORS allow-list,
- a static frontend with an SPA rewrite and an environment-driven API URL.

It then validates the file against Render's official schema
(<https://render.com/schema/render.yaml.json>) and reports the *leaf* errors rather than the
misleading `anyOf`/`unevaluatedProperties` cascade. This is not theoretical: the schema check
is what caught that a static site must not declare `plan` or `region` — fields that would
otherwise have failed in the Render dashboard instead of in CI.

**`test`** — matrix over **3.12 and 3.13**. 3.12 is the floor declared in `pyproject.toml`;
testing it is what makes `requires-python` a claim rather than a guess. The floor was raised
from 3.11 when the declared range and the pinned dependency stack were reconciled:
`numpy==2.5.3` ships cp312+ wheels only, so "supports 3.11" was never true of the pinned
environment (verified with a `pip download --python-version 311 --only-binary=:all:`
resolution probe). Steps: install pins, restore the dataset from cache, verify the pinned
checksums, run the data-contract tests separately so a contract failure is legible in the job
list, then the full suite with a JUnit artefact.

**`pipeline`** — trains, registers, runs the 24-check HTTP smoke test against the real
server, then a reduced drift experiment. It also holds the reproducibility claim to account:
[`scripts/verify/check_fingerprint.py`](scripts/verify/check_fingerprint.py) compares the
behaviour fingerprint of the model just trained against the recorded baseline in
`results/summary.json`. A mismatch fails the build — the build breaks, not the documentation.

**`docker`** — the job that turns the image from "authored" into "verified". It builds with
buildx and layer caching, then:

1. creates an **empty volume owned by root**, exactly like a Render persistent disk;
2. runs the real first-deploy bootstrap through the real entrypoint
   (`python scripts/deploy/init_production.py`) and asserts `INIT_PRODUCTION_OK`;
3. re-runs it and asserts `INIT_PRODUCTION_SKIP` — the idempotency the redeploy path depends on;
4. boots the service and waits for `/ready` (**readiness**, not liveness);
5. verifies the served API with [`scripts/deploy/verify_deployment.py`](scripts/deploy/verify_deployment.py)
   — the *same* tool pointed at a public Render URL after a deploy;
6. asserts the running uvicorn process is **uid 10001**, i.e. that the privilege drop is real
   and not merely declared in the Dockerfile;
7. stops the container with SIGTERM and requires exit code **0** — draining, not a kill;
8. restarts on the same volume with an injected `$PORT` and requires the service to come back
   ready with its model intact.

**`frontend`** — `npm ci`, `tsc`, ESLint, production build, then a grep of `dist/` for
credential patterns and for any reference to the admin token, `npm audit --audit-level=high`,
and the Playwright suite (desktop + mobile) against the built bundle. The job states its
contract explicitly: a `frontend/` directory without a `package.json` is an **error**, not a
silent skip.

**`audit`** — `pip-audit`. `requirements.txt` (the serving pins) is clean and gated with **no
exceptions**. `requirements-deploy.txt` adds MLflow and pyarrow for the container; their known
advisories are recorded in [`scripts/deploy/audit_baseline.txt`](scripts/deploy/audit_baseline.txt)
with exposure analysis and a remediation path, the full findings table is printed *before* the
exception list is applied, and any advisory not on the list still fails the job.

**`release-readiness`** — on `main` only, after every other job, it prints what is being
released and confirms the deployable artefacts are present. Because Render deploys on
`checksPass`, reaching this job is the release decision.

---

## Release flow

```
developer push / PR
  → CI (all jobs above)
    → red?  stop. Render never sees it.
    → merged/pushed to main, CI green
      → Render deploys both services
        → preDeployCommand bootstrap (idempotent)
          → /ready gate
            → traffic
```

Verify the result from outside:

```bash
python scripts/deploy/verify_deployment.py \
  --backend-url https://mlserve-backend.onrender.com \
  --frontend-url https://mlserve-frontend.onrender.com
```

It is **non-mutating**: it never promotes, rolls back or reloads a model, and its only
admin-endpoint check is that an unauthorised `POST /admin/reload` is refused with `401`.

---

## Reproducibility measures

- Dependencies pinned exactly in `requirements.txt`, `requirements-deploy.txt` and
  `requirements-dev.txt`; a full transitive lock is in `requirements-lock.txt`.
- `PYTHONHASHSEED=42` and single-threaded BLAS/OpenMP, so runner-to-runner timing variation
  does not change results — and so the training fingerprint stays comparable to the baseline.
- The 6 MB raw dataset is cached under a key containing both file checksums, keeping CI off
  the UCI servers while still verifying the pinned digests on every run.
- `concurrency` cancels superseded runs.
- The frontend builds from `package-lock.json` via `npm ci`, cached by lock hash.

---

## Verified locally

Every check below was executed in this repository's development environment. The container
checks are executed by the `docker` job (no container runtime was available locally) and the
browser suite runs headless Chromium.

| Check | Result |
|---|---|
| `ruff check src tests scripts` | pass, 0 findings |
| `black --check src tests scripts` | pass, no reformatting |
| `pytest` (full backend suite) | **434 passed**, 0 failed locally; **467 passed** in CI on 3.12 and 3.13 |
| `pytest tests/test_deploy_tooling.py` | **33 passed** — proves each new gate actually fires |
| `scripts/deploy/validate_blueprint.py` | 26/26 invariants + official schema pass |
| `scripts/deploy/scan_secrets.py` | clean over all tracked files |
| `scripts/deploy/init_production.py` | first run bootstraps and prints `INIT_PRODUCTION_OK`; second prints `INIT_PRODUCTION_SKIP` |
| `scripts/verify/check_fingerprint.py` | pass — reproduces `54122c6ae121…` exactly |
| `pytest tests/test_validation.py tests/test_schema_contract.py` | **88 passed** |
| `python scripts/smoke_test.py` | **24 of 24 checks passed** |
| `python scripts/drift_experiment.py --trials 5` | pass |
| `npm run typecheck` / `npm run lint` / `npm run build` | pass; ~105 kB gzipped, four views code-split |
| `npx playwright test` | **46 passed** (23 scenarios × desktop + mobile) |
| Docker build / boot / API verification | executed by the `docker` job on every push (no local runtime available in the development environment) |

Image build time, image size and container start-up time are no longer unmeasured: the
`docker` job produces them on every push and they are recorded, with their provenance, in
[BENCHMARKS.md](BENCHMARKS.md#docker--measured-in-ci). They are runner measurements — quoted
as such, and reproducible by re-running the job rather than by trusting this document.

---

## Running CI locally

```bash
make lint                       # ruff + black
make test                       # full backend suite
python scripts/train.py && python scripts/smoke_test.py
python scripts/verify/check_fingerprint.py
python scripts/deploy/validate_blueprint.py
python scripts/deploy/scan_secrets.py
python scripts/drift_experiment.py --trials 5 --no-plots

cd frontend && npm ci && npm run typecheck && npm run lint && npm run build && npm run test:e2e
```

To run the container path locally (requires Docker):

```bash
docker build -f docker/Dockerfile -t mlserve:local .
docker volume create mlserve-data
docker run --rm -v mlserve-data:/var/data -e MLSERVE_DATA_ROOT=/var/data \
  -e MLSERVE_MODEL_SOURCE=registry mlserve:local python scripts/deploy/init_production.py
```

---

## Historical notes

Preserved because they explain why the current pipeline looks the way it does:

- **No container runtime during development.** The Dockerfile was written and statically
  reviewed but never built, so image size and container start-up were recorded as UNVERIFIED
  in [BENCHMARKS.md](BENCHMARKS.md) and quoted nowhere. The `docker` job now builds, boots and
  exercises the image on every push; the unquoted numbers stay unquoted until they are
  recorded as evidence.
- **CI had not run on GitHub Actions.** The workflow was authored and each step executed
  locally. The pipeline now runs on every push and pull request.
- **The black gate did not pass.** The repository is now formatted with black and both gates
  pass; formatting was a separate commit from any behavioural change.
- **Python 3.11 was declared but unsupported.** The pin set has no cp311 wheels. The policy is
  now one coherent floor: **3.12**, with 3.13 as the development version, asserted by the CI
  matrix.
