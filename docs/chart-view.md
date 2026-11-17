# Persistent chart view controls — 2026-10-27

Native view controls now persist per chart cell: vertical/horizontal grid visibility, inverted scale, axis labels, last-price line/label, countdown, and crosshair style/width/opacity. Previously the native dialog changed the renderer only; a browser test reproduced Vertical=false becoming true after reload.

`ChartViewPreferences` is an explicit bounded schema. A public `getConfig`/`onConfigChanged` binding copies these controls into Zustand and applies imported/cell/layout changes through narrow `applyConfig` patches. It ignores unrelated native config changes, deduplicates equivalent values, suppresses feedback during restoration and detaches both subscriptions at disposal. Missing/applying cell owners cannot write. An omitted/null preference uses the renderer's initial view defaults; old workspace documents remain valid.

The new field participates in chart persistence, workspace-cell capture, saved layouts and validated backups. Inactive-cell view changes use the live binding rather than the cell's renderer-recreation signature. Native patches exclude price style, logarithmic mode, timezone, colors and other independently owned settings. This preserves their existing ownership; it does not establish durable storage for every cosmetic control.

## Verification

- **97 files / 1,170 tests passed**; final production build and standalone TypeScript passed. Logs: `artifacts/chart-view-tests.log`, `chart-view-build.log`, `chart-view-typecheck.log`.
- Eight added contracts exercise strict/bounded nested validation, narrow/copy-safe config extraction, startup restoration without echo, native-edit capture and unrelated-event filtering, external/legacy restores, disposal, unsupported config surfaces, actual cell/layout/backup persistence and malformed/missing/applying owners. Crosshair width bounds0.5–8 follow the installed native config normalizer and dialog control.
- Actual before-fix browser: Vertical toggled false, reload returned true. After correction, Vertical/Horizontal both remain false after reload.
- Actual native Scales and lines: invert=true; price line/label/countdown/axis labels=false; crosshair Dotted/width0.5 all survive reload. The chart remains Candles with the same market/interval.
- Actual independent cells: cell2 retains default grids/invert=false while cell1 retains both grids off/invert=true. A cell2-only horizontal-grid change also survives switching away/back. Test values for both cells were then restored to their original displayed defaults.
- Mobile375: changing Countdown to bar close=false, reloading, and reopening through More chart controls → Chart settings → Sections → Scales and lines retains false. Native mobile screenshot visually inspected; document scrollWidth375. Countdown restored true afterward.
- Final BTC/5m/Candles/UTC single chart, both grids on, regular/non-inverted scale, price/axis labels and countdown on, dashed width1 crosshair, EMA20/Volume, watchlist and collapsed bottom restored. Explicit default view preferences remain saved. No alert/order/indicator commands created. Final captured warning/error logs empty; desktop1280 has no document overflow, viewport reset and checked preview retained.

Evidence: `artifacts/chart-view-browser.json`, `chart-view-reload.png`, `chart-view-mobile.png`, `chart-view-production.png`.

Color/font/margin/theme preferences, percent/indexed scale modes, every native style/plot/device, inactive-dialog flows and full TradingView settings/layout equivalence remain separate or unproven. This checkpoint retains the selected view controls; the broader1:1 goal stays active.
