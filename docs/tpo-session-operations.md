# TPO session operations

Right-clicking an observed TPO cell now opens a native, keyboard-accessible menu:
Expand/Collapse TPO, Merge to previous/following TPO, Unmerge TPO, Unmerge all
TPOs and TPO Settings. Missing neighbors and inapplicable unmerge actions are
disabled. Settings opens the TPO section directly. These actions follow the
official reference inspected on 2026-11-04:
https://docs.luxalgo.com/platform/charts/order-flow/tpo

The menu captures its target once; changing market, settings, layer identity or
session membership prevents a stale command from applying to another profile.
Hit testing shares the painter's cell geometry. Per-session expansion overrides
the global Split setting. The binding is installed on primary and satellite
charts, with cleanup when the chart is destroyed.

## Composite calculation and persistence

Merges form links between adjacent loaded session openings. Chained links group
sessions before calculation. The model recomputes the composite price grid,
opportunity rows, POC, value area and structure from contributing candles rather
than averaging old levels. Initial Balance uses the composite opening window.
Expected coverage sums the actual member session windows, excluding intervening
non-session time. Incomplete source windows remain incomplete and cannot publish
completed reference levels.

Composite block indices concatenate each member's block slots, retaining gaps
within a session. Separate period spans preserve each block's real UTC window,
including overnight breaks and 23/25-hour DST days. Expanded composites project
those spans through the chart coordinate system. Missing linked members are not
invented, skipped over or pulled from an unrevealed Replay future.

Bounded operation settings travel through existing per-cell native series,
layout and backup persistence. Operations are scoped to symbol, interval,
calendar and block settings. They do not leak to another market or calendar.
Selected Unmerge removes only the component's links; Unmerge all clears all
links in the scope. Original per-session expansion choices remain available.
No historical market events or live alert closes are republished.

## Verification

- Twelve regressions in `tests/tpo-operations.test.ts`: composite row/POC and
  coverage recomputation, chaining, selective/all unmerge, prefix/unloaded
  member isolation, missing data, auto grid/structure, real-time span geometry,
  scope and serialization, cache/history repair, bounds, hit tests, 25-hour DST
  and Data readout with cloned persisted operations.
- Full suite: **1,894 tests in 173 files passed**, TypeScript and production
  build. Logs: `artifacts/tpo-operations-tests.log`,
  `artifacts/tpo-operations-typecheck.log`, `artifacts/tpo-operations-build.log`.
- `scripts/verify-tpo-operations-live.ts` independently groups the retained public
  Kraken response in `artifacts/tpo-split-live.json` (720 closed hourly bars).
  Four-session composites with full-day windows match all raw price-row/block
  memberships, 96 bars, 195 opportunities and POC 82,800. Short one-hour windows
  match four bars, ten opportunities and POC 83,300. Report:
  `artifacts/tpo-operations-live.json`. This is retained real-source verification,
  not a new live classified execution-history claim.
- Isolated production browser: individual Collapse and Expand, following then
  previous Merge (two then three members), three-member reload persistence,
  recomputed Data fields, selected Unmerge, mobile Merge and Unmerge all/reload.
  A fresh final-build browser shows one member and no warning/error logs.
- Native TPO Settings section selection and opaque themed menu verified after
  correcting initial section-id/theme-host errors. At 414px all menu items fit
  on screen. Screenshots: `artifacts/tpo-operations-composite.png`,
  `artifacts/tpo-operations-menu.png`, `artifacts/tpo-operations-mobile-menu.png`.
  A superseded tab encountered an old asset chunk timeout while its server build
  was being replaced; fresh final-build verification passed.

## Remaining boundaries

This is not complete Vela parity. Direct Vela visual/composite-formula comparison,
populated multi-chart, full-capacity performance, touch-device long-press and
browser recorded Replay verification remain open. Undo/Redo semantics for these
host-owned operations have not been established. Trading-hour calendars/presets,
TPO metric themes, volume ladder, markers, hover and the remaining Orderflow
families still require implementation or verification.
