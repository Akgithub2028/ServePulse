# `scripts/deploy/` — deployment tooling

Everything needed to bootstrap, validate and verify the Render deployment. All four tools run
standalone (no `mlserve` import except the bootstrap), so they work against a remote
deployment as readily as against a local container.

## Contents

| Script | Purpose |
|---|---|
| `init_production.py` | The first-deploy bootstrap, run by Render's `preDeployCommand`. Idempotent: if the `production` alias resolves it prints `INIT_PRODUCTION_SKIP` and changes nothing; otherwise it reuses `fetch_data.py` + `train.py` verbatim to create the first model |
| `verify_deployment.py` | Non-mutating deployed-state verification against a public URL: health/readiness, model info, valid + invalid + oversized predictions, the error envelope, correlation headers, metrics, monitoring snapshot, that `/admin/reload` is 401 without a token, and CORS in both directions |
| `validate_blueprint.py` | Structural invariants for `render.yaml` (single instance, `/ready` gate, disk matching `MLSERVE_DATA_ROOT`, idempotent bootstrap, `checksPass`, generated admin token, non-wildcard CORS, SPA rewrite) plus validation against Render's official JSON schema |
| `scan_secrets.py` | Secret gate: credential patterns and assignment-shaped secrets in every tracked file, plus the rule that `VITE_*` values are public and the Blueprint must generate the admin token |
| `audit_baseline.txt` | The recorded, generated advisory baseline for `requirements-deploy.txt`, with exposure analysis and the remediation path |

## Directive paths

| | |
|---|---|
| Bootstrapping logic | `init_production.py` → `main()` |
| What "deployed and healthy" means | `verify_deployment.py` → `verify_backend()` |
| Deployment invariants | `validate_blueprint.py` → `validate_structure()` |
| Advisory exceptions | `audit_baseline.txt` |
| Where these are invoked | `../../.github/workflows/ci.yml`, `../../render.yaml` |
