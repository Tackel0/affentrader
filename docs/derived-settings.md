# Independent derived chart parameters — 2026-10-27

Renko, Range, Kagi, Line break and Point & Figure now read their owning chart cell's transform settings. The browser reproduced a global-state defect: setting cell1 Renko to Fixed100 made a newly selected cell2 Renko also show Fixed100 instead of ATR14. The renderer's custom painters previously read the active global settings for every cell.

## Changes

`lib/chart/derivedSettings.ts` provides the shared cell resolver, validated copied updates, selected-family reset and repaint subscription. The primary host-layer alias resolves to the active cell; satellite painters resolve their actual cell ID. Applying/missing/removed owners are fenced. Inactive edits update only the named cell, and equivalent/unrelated changes do not request repaint. Both subscriptions detach on disposal.

Workspace cells now capture/apply `chartTypeSettings`; named layouts and backup chart/cell/layout validation retain them. Missing legacy cells use explicit defaults instead of inheriting whichever cell was last active. ATR lengths are integers1–200, reversal/line counts integers1–10, positive sizing values finite and bounded. UI constraints match validation. Reset changes only the selected family. A settings dialog closes if its chart type or owner changes, and updates still target the owner captured at opening.

`lib/chart/styles.ts` now uses the cell resolver for all five transform painters. Parameter changes directly invalidate the cell's host canvas layers, without renderer recreation, new data requests or a next-tick dependency. No transform formulas were changed in this checkpoint.

## Verification

- **101 files / 1,201 tests passed**, production build and standalone TypeScript passed. Logs: `artifacts/derived-tests.log`, `derived-build.log`, `derived-typecheck.log`.
- Eight new contracts cover strict schema/bounds, independent cells and copied updates, different actual Renko outputs from two cell-owned inputs, selected-family reset, immediate targeted repaint/subscription disposal, cell/layout/backup persistence and legacy defaults, malformed chart/cell/layout imports, and invalid/applying/missing-owner writes.
- Actual production browser: cell1 Renko Fixed100; cell2 now initially ATR14, then Fixed200. Both independently survive activation and reload.
- Actual Reset: after setting Range0.5%, resetting Renko preserves Range0.5%. Range restored0.25% and Renko restoredATR14 afterward.
- Paused Replay: changing Renko100→200 visibly changes the derived marks immediately while the cursor stays at2026-10-27T11:40 UTC and99 bars remain. Both screenshots visually inspected. This proves repaint under a fixed revealed history; it does not prove TradingView Renko algorithm equivalence.
- Mobile375: Fixed150 survives reload. Entering ATR length999 yields200. Native host settings remain operable and document width375. Mobile screenshot captured.
- Original single BTC/5m/Candles/UTC/Dark, EMA20/Volume, watchlist and collapsed bottom restored; Replay exited, both tested cells returned to Candles/RenkoATR14, Range0.25%. Viewport reset and preview retained. No studies/orders/alerts created. Captured warnings/errors empty.

## Evidence and limits

`artifacts/derived-browser.json`, `derived-second-cell.png`, `derived-replay-100.png`, `derived-replay-200.png`, `derived-mobile.png`, `derived-production.png`.

Hollow/Volume candle cosmetics and other plugin-specific native settings are still separate work. Derived marks retain their existing source-bar/free-slot placement rather than a complete TradingView non-time axis. ATR/percent historical recalculation, intrabar-path assumptions, transform computational limits for extremely small boxes, all chart styles/providers/devices and complete layout/design parity remain open audits. Broker execution and social features remain deferred; the full1:1 goal remains active.
