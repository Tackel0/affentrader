# Persistent native series presentation — 2026-10-27

Native course-series settings now belong to the chart cell and survive reload, named layouts and validated workspace backups. Covered fields are candle bodies/borders/wicks and their six colors; OHLC bar colors; line color/width; area line/fill colors and width; baseline line/fill colors, width and percentage level; shared spacing; zoom/pan/autoscale/reveal switches and live-price animation.

The browser first reproduced Body=false returning to true after reload. Existing chart-type storage retained the selected type but did not retain native presentation values.

## Implementation

`lib/chart/seriesPreferences.ts` defines a complete explicit schema using the installed ChartConfig types. Native bounds are width1–10, baseline0–100 and spacing0.1–10. All nested fields are required and bounded, booleans are strict, and colors share the bounded chart-color validator. Native config extraction copies values; patches omit chart type, absolute baseline price, transforms, canvas, scale mode and timezone.

`lib/chart/seriesBinding.ts` restores state atomically and captures native edits through public config notifications. Equivalent/unrelated events do not write; restoration cannot echo into storage. Null/missing legacy preferences use the initial native defaults. Missing/applying/removed owners cannot publish. Native and host subscriptions detach on disposal. The same host serves primary and satellite charts; satellite appearance-only changes are excluded from renderer recreation.

Zustand chart persistence, workspace capture/application, saved layouts and backup chart/cell validation include the new field. Old documents without it remain valid. Motion changes retain the engine's configured durations. Reveal affects the next native load; this checkpoint verifies switch persistence, not animation-frame timing or performance equivalence.

## Verification

- **100 files / 1,193 tests passed**, production build and standalone TypeScript passed. Logs: `artifacts/series-tests.log`, `series-build.log`, `series-typecheck.log`.
- Seven new contracts cover complete validation/bounds, copied narrow projections, all-family startup restoration/no feedback, native-edit filtering, defaults/disposal/missing ownership, independent cells/layouts/backup round trips, malformed imports and applying/removed-owner fences.
- Actual final production browser: candle Body=false, Borders=true, Wick=false, upColor#2962ff and spacing1.5 survive reload. Zoom/Pan/Autoscale=false and Live-price/Reveal=true also persist.
- Actual Line: color#ab47bc and width4 survive reload and render as a visible purple line. Area width3 remains after a later reload and type switch. Baseline level35/width4 survives reload. Area and Baseline restored to width2/level50 afterward.
- Two columns: cell2 starts with Body=true, spacing1 and default motion. Its spacing2 survives activation while cell1 retains Line width4 and Zoom=false. Cell2 spacing restored1.
- Mobile375: native Symbol dialog shows Line width4; changing to5 survives reload. Document width remains375. Mobile dialog and purple desktop line screenshots visually inspected.
- Final original single BTC/5m/Candles/UTC/Dark chart restored. Bodies/wicks on, borders off, upColor#089981, spacing1, Line width2/color#3b82f6, Area width2 and Baseline level50/width2. Zoom/Pan/Autoscale on, live-price/reveal off. EMA20/Volume, watchlist and collapsed bottom retained. Restoration itself verified after reload. Explicit defaults remain stored. No studies/alerts/orders created, warnings/errors captured empty, viewport reset and checked preview retained.

## Evidence and limits

`artifacts/series-browser.json`, `series-candles-settings.png`, `series-line.png`, `series-mobile.png`, `series-production.png`.

OHLC-bar colors and every individual area/baseline fill were not separately edited in-browser; they have schema and binding test coverage. This does not prove plugin-specific per-type settings, derived transform math, all theme/style/provider/device combinations, visual animation timing or full TradingView equivalence. Full chart-layout/design parity remains active work; broker execution and social features remain deferred.
