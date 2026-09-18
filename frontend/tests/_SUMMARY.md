# `frontend/tests/` — browser tests

## Contents

- `e2e/` — the Playwright suite and its fixtures.

The suite runs against the **production bundle** (the `webServer` entry in
`../playwright.config.ts` builds and previews it), so what is tested is the artefact that
ships. Scenarios: load and navigation across all five views, SPA deep links, live state
rendering, degraded and unreachable backends, successful and rejected predictions, oversized
batches, the structured 422 envelope, window switching, the provenance chain, the endpoint
inventory, narrow-viewport usability, keyboard reachability, and the absence of any credential
in the DOM or web storage.

## Directive paths

| | |
|---|---|
| Scenarios | `e2e/console.spec.ts` |
| Backend stubs | `e2e/fixtures.ts` |
| Configuration and CI invocation | `../playwright.config.ts`, `../../.github/workflows/ci.yml` |
