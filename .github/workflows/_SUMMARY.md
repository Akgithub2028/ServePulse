# `.github/workflows/` — CI workflow definitions

## Contents

- `ci.yml` — nine jobs on free `ubuntu-latest` runners, no secrets and no paid infrastructure:
  `lint`, `secrets`, `blueprint`, `test` (3.12 + 3.13 matrix), `pipeline` (train →
  reproducibility → smoke → drift), `docker` (build → bootstrap → boot → verify API →
  non-root check → clean shutdown → restart persistence), `frontend` (install → type-check →
  lint → build → bundle secret scan → `npm audit` → Playwright), `audit` (`pip-audit`), and
  `release-readiness` (main only, after every other job).

## Directive paths

| | |
|---|---|
| Triggers | `ci.yml` → `on:` (`push` to main, all PRs, manual dispatch) |
| The deploy gate | `ci.yml` → `release-readiness` job; paired with `autoDeployTrigger: checksPass` in `../../render.yaml` |
| Container verification | `ci.yml` → `docker` job |
| Round-trip verification tool | `../../scripts/deploy/verify_deployment.py` |
| Why each step exists | `../../CI_CD.md` |
