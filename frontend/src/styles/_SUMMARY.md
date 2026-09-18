# `frontend/src/styles/` — design system

## Contents

| File | Responsibility |
|---|---|
| `tokens.css` | The design tokens: surfaces, hairlines, text ramp, semantic accents (state colours only — never decoration), type scale, spacing, radii, shadows, transitions, sidebar width |
| `app.css` | The single stylesheet: shell, panels, stats, tables, badges, states, charts, forms, and the responsive rules |

`prefers-reduced-motion` is handled by removing transitions rather than shortening them, and
the background grid is drawn with CSS gradients, so the console renders identically with no
network access at all.

## Directive paths

| | |
|---|---|
| Colours and scales | `tokens.css` → `:root` |
| Reduced-motion policy | `app.css` → `@media (prefers-reduced-motion: reduce)` |
| Responsive behaviour | `app.css` → `@media (max-width: 900px)` |
| Applied by | `../main.tsx` |
