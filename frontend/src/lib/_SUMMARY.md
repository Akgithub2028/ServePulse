# `frontend/src/lib/` — formatting helpers

## Contents

- `format.ts` — one consistent way to render a value: `num`, `fixed`, `percent`, `ms`,
  `seconds`, `bytes`, `duration`, `relative`, `shortId`, `timestamp`, `titleCase`.

Every formatter returns an explicit unknown marker (`—`) for `null`/`undefined`/non-finite
input rather than `NaN`, `undefined` or `Invalid Date`. An operations console showing a
plausible-looking wrong number is worse than one showing that it does not know.

## Directive paths

| | |
|---|---|
| Unknown marker | `format.ts` → `UNKNOWN` |
| Number and duration formatting | `format.ts` → `num()`, `ms()`, `duration()` |
| Identifier shortening | `format.ts` → `shortId()` |
