# `frontend/tests/e2e/` — browser test specifications

## Contents

| File | Responsibility |
|---|---|
| `fixtures.ts` | Backend stubs. The payloads mirror the real response models in `src/mlserve/serving/schemas.py` field for field, including the structured error envelopes, so the tests exercise the documented contract rather than a loose approximation. `mockApi()` installs them with per-test overrides and can simulate an unreachable backend |
| `console.spec.ts` | The scenarios, grouped by view: shell and navigation, control room (live, degraded, unreachable), inference lab (success, batch, client rejection, backend 422, oversized 413, missing model), observability (telemetry, window switching, disabled store), provenance (trace, columns, empty registry), platform (endpoint inventory, no credential exposed), responsive behaviour, and accessibility basics |

## Directive paths

| | |
|---|---|
| Scenarios | `console.spec.ts` |
| Stubs and overrides | `fixtures.ts` → `mockApi()`, `MockOptions` |
| Run them | `npm run test:e2e` from `frontend/` |
| CI invocation | `../../.github/workflows/ci.yml` → `frontend` job |
