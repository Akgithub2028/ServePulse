# Frontend — ServePulse Operations Console

A React 18 + TypeScript operations control plane over the serving API, deployed live on Render:
**[https://serve-pulse-console.onrender.com](https://serve-pulse-console.onrender.com)**.
It is a **read-only** surface: it renders what the platform actually reports and holds no
privileged credential.

---

## Design direction

Dark graphite / obsidian infrastructure console. Near-black surfaces, hairline borders, one
restrained luminous accent, monospace numerals so figures align and read as measurements,
and colour used only to carry meaning — in an operations surface, a coloured thing must mean
something.

Practical consequences:

- **No runtime fetches of anything but the API.** System font stack, CSS-drawn grid, inline
  SVG charts. The bundle renders identically on a cold, offline or preview-only load.
- **Density over decoration.** Information is grouped into panels with clear hierarchy, and
  motion is used only to explain state (loading, change, refresh) — never as ornament.
- **`prefers-reduced-motion` is honoured by removing transitions**, not merely shortening them.

---

## Structure

```
frontend/
├── src/
│   ├── api/          the single typed client: types, client, polling hooks
│   ├── components/   AppShell, UI primitives, hand-built SVG charts
│   ├── lib/          formatters (numbers, durations, ids, timestamps)
│   ├── state/        shared service-state hook (health/ready/model, one cadence)
│   ├── styles/       design tokens + one stylesheet
│   └── views/        the five views
├── tests/e2e/        Playwright specs and backend stubs
├── index.html
├── playwright.config.ts
└── vite.config.ts
```

### The API layer

`src/api/types.ts` transcribes the backend's response models field for field. `src/api/client.ts`
is the only place the application performs I/O:

- every response is typed against the real contract;
- every failure is normalised into a classified `ApiFailure`
  (`validation` · `oversized` · `unavailable` · `unauthorized` · `server` · `transport` · `timeout`),
  carrying the backend's structured envelope — type, message, per-field details, request id;
- correlation headers (`X-Request-ID`, `X-Model-Version`) are captured so they can be shown;
- the base URL comes from `VITE_API_BASE_URL` at build time; no production URL is hardcoded;
- `any` is banned by lint, so a drifted response shape becomes a type error rather than a
  plausible-looking number.

`src/api/hooks.ts` provides polling that pauses while the tab is hidden, cleans up its timers,
and **keeps the last good reading when a refresh fails** — an operator needs "this value, and
here is why it is stale", not a blank panel.

---

## The five views

| View | Live Link | Answers | Notable details |
|---|---|---|---|
| **Control Room** | [`/`](https://serve-pulse-console.onrender.com/) | Is the platform healthy? | Shows liveness and readiness as *two* facts (alive-but-idle is a real state), the served model's identity, uptime, cold-start cost (0.192s), the prediction store's counters, and output/latency distributions parsed from the Prometheus exposition |
| **Inference Lab** | [`/inference`](https://serve-pulse-console.onrender.com/inference) | What does the model answer? | Real `POST /predict`. Client validation mirrors the data contract, so a bad value is refused with the API's own reasoning rather than coerced into something it would accept. All five failure classes render distinctly, including the backend's per-field 422 details |
| **Observability** | [`/observability`](https://serve-pulse-console.onrender.com/observability) | What has the platform recorded? | Traffic, latency, distributions, per-model-version split, event kinds, with a window control that genuinely re-queries `/monitoring/summary`. It states plainly that per-request history is not stored, instead of inventing a trend line |
| **Model Provenance** | [`/provenance`](https://serve-pulse-console.onrender.com/provenance) | Where did this model come from? | A trace: dataset version → training run → behaviour fingerprint → registry version → serving process, with offline metrics and the real input-column contract |
| **Platform / API** | [`/platform`](https://serve-pulse-console.onrender.com/platform) | What is this system? | Endpoint inventory read from the service's own OpenAPI document, health/readiness semantics, runtime facts, and the security posture in plain language |

---

## No fabricated telemetry

Every figure on screen is sourced from an endpoint, and where an endpoint has nothing to
report the UI says so. Concretely:

- distributions come from Prometheus histograms (`mlserve_request_latency_seconds`,
  `mlserve_prediction_score`), not from generated values;
- the dashboard draws **no time series**, because the store keeps a rolling-window aggregate
  and cumulative counters — there is no per-minute history to plot, and a chart of invented
  points would misrepresent the system;
- an empty registry, a disabled monitoring store, a fresh instance and an unreachable backend
  each get their own explicit, actionable state;
- the rendered JSON of `/monitoring/summary` and `/model-info` is available in-place, so a
  displayed number can always be checked against the response it came from.

---

## Security posture

The frontend is an untrusted public client:

- it never holds, requests or stores the admin token — `POST /admin/reload` is intentionally
  not wired to any control;
- nothing secret-shaped goes into `VITE_*`, because those values are inlined into the public
  bundle. The CI frontend job greps the built output for credential patterns and for any
  reference to the admin token, and a browser test asserts the DOM and web storage are clean;
- CORS is enforced server-side by an allow-list; the console simply calls the API directly.

---

## Running it

```bash
cd frontend
npm ci

# backend in another terminal:
#   python scripts/serve.py            # http://127.0.0.1:8077

cp .env.example .env.local            # VITE_API_BASE_URL=http://127.0.0.1:8077
npm run dev                           # http://127.0.0.1:5173
```

There is deliberately **no dev-server proxy**: the deployed site is cross-origin by
construction, so developing against the real CORS configuration is the honest default.

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server, hot reload |
| `npm run typecheck` | `tsc --noEmit` over source and tests |
| `npm run lint` | ESLint (flat config; `no-explicit-any` is an error) |
| `npm run build` | Type-check + production bundle into `dist/` |
| `npm run preview` | Serve the built bundle locally |
| `npm run test:e2e` | Playwright, desktop + mobile |

### Tests

46 browser tests (23 scenarios × desktop and mobile projects) run against the **production
bundle**, built by the Playwright `webServer` so the shipped artefact is what is under test.
They cover: load and navigation across all five views, SPA deep links, live state rendering,
degraded and unreachable backends, successful and rejected predictions, oversized batches,
the structured 422 envelope, window switching, the provenance chain, the endpoint inventory,
narrow-viewport usability without horizontal overflow, keyboard reachability, and the absence
of any credential in the DOM or web storage.

The backend is stubbed at the network layer with payloads mirroring the real response models
(tests cannot depend on a live service). The **real** contract is verified separately against
a running service by [`scripts/deploy/verify_deployment.py`](scripts/deploy/verify_deployment.py),
which the CI docker job runs against the container and which is pointed at the public URL
after a deploy.

---

## Bundle

No charting, state-management or data-fetching dependencies: the two SVG charts, the polling
hooks and the design system are all first-party. Recharts/Redux/React-Query would have added
hundreds of kilobytes to draw two shapes and cache five endpoints.

The four secondary views are code-split, so the landing view does not download the inference
form or the telemetry screens. Approximate production sizes (gzip):

| Chunk | Size |
|---|---|
| `index` (shell + Control Room) | ~75 kB |
| `react` vendor | ~18 kB |
| each of the four secondary views | ~3–4 kB |
| stylesheet | ~4 kB |
