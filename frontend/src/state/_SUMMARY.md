# `frontend/src/state/` — shared application state

## Contents

- `service.ts` — `useServiceState()` and `headlineFor()`.

The console distinguishes two facts the backend distinguishes, instead of blending them into
one "up/down": `/health` answers 200 whenever the process is alive (reporting `degraded` when
no model is loaded), while `/ready` answers 503 until a model is genuinely loadable. The hook
therefore exposes `ready_`, `degraded` and `unreachable` separately, and `headlineFor()`
maps them to the top-bar badge.

## Directive paths

| | |
|---|---|
| Liveness vs readiness | `service.ts` → `useServiceState()` |
| Top-bar status mapping | `service.ts` → `headlineFor()` |
| Consumers | `../views/ControlRoom.tsx`, `../views/Platform.tsx`, `../components/AppShell.tsx` |
