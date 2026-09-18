# `frontend/src/components/` — shared presentation

## Contents

| File | Responsibility |
|---|---|
| `AppShell.tsx` | The shell: brand, navigation between the five views, sticky top bar with the service headline, and the configured-backend footer. Exports `NAV` and the `ServiceHeadline` type |
| `ui.tsx` | Primitives used everywhere so that good and bad news look consistent: `Panel`, `Badge`, `Stat`, `Skeleton`, `EmptyState`, `ErrorState`, `Alert`, `KeyValues`, `BarList` |
| `charts.tsx` | Hand-built SVG charts — `DistributionChart` (histogram buckets), `BucketAxis`, `AmplitudeStrip` — plus `toBuckets()`, which converts cumulative Prometheus buckets into per-bucket counts |

No charting or component library: two shapes did not justify the dependency, and hand-drawn
marks make it easy to render an honest empty state instead of an empty axis.

## Directive paths

| | |
|---|---|
| Navigation definition | `AppShell.tsx` → `NAV` |
| Status headline | `AppShell.tsx` → `ServiceHeadline`; produced by `../state/service.ts` → `headlineFor()` |
| State primitives | `ui.tsx` → `EmptyState`, `ErrorState`, `Skeleton` |
| Chart data conversion | `charts.tsx` → `toBuckets()` |
