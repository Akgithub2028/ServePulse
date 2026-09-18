# `frontend/src/` — console application source

## Contents

| Directory | Responsibility |
|---|---|
| `api/` | The only place the app performs I/O: contract types, the typed client with failure classification, and polling hooks |
| `components/` | `AppShell` (navigation and top bar), UI primitives (panels, stats, badges, states), hand-built SVG charts |
| `lib/` | Formatters for numbers, durations, identifiers and timestamps |
| `state/` | The shared service-state hook (health/readiness/model on one cadence) and its headline mapping |
| `styles/` | Design tokens and the single stylesheet |
| `views/` | The five views |
| `App.tsx`, `main.tsx` | Router (Control Room eager, the other four code-split) and mount point |

## Directive paths

| | |
|---|---|
| Entry point | `main.tsx` → `index.html` |
| Routes | `App.tsx` → `<Routes>` |
| Shell and navigation | `components/AppShell.tsx` → `NAV` |
| Design tokens | `styles/tokens.css` |
| Client conventions | `api/client.ts` |
