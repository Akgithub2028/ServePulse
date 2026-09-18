# `frontend/` — operations console

A React + TypeScript control plane over the existing API, deployed as a Render static site.
Read-only by design: it renders what the platform reports and holds no privileged credential.

## Contents

- `src/` — the application (API layer, components, views, styles, shared state).
- `tests/e2e/` — Playwright specs and faithful backend stubs.
- `index.html`, `vite.config.ts`, `tsconfig*.json`, `eslint.config.js` — build and quality
  configuration.
- `package.json` / `package-lock.json` — dependencies, pinned via the lock file (`npm ci`).
- `.env.example` — the build-time API URL template.

## Directive paths

| | |
|---|---|
| API contract and client | `src/api/types.ts`, `src/api/client.ts` |
| Polling behaviour | `src/api/hooks.ts` |
| Shared service state | `src/state/service.ts` |
| Design tokens | `src/styles/tokens.css` |
| The five views | `src/views/` |
| Browser tests | `tests/e2e/console.spec.ts` |
| Why it is built this way | `../FRONTEND.md` |
| How it is deployed | `../render.yaml` (static site), `../DEPLOYMENT.md` |
