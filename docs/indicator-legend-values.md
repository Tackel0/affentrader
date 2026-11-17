# Per-instance indicator values in the chart legend

Core-function checkpoint, 2026-10-27. Full TradingView equivalence remains unproven; broker/social expansion stays deferred.

## Implemented behavior

The host indicator chips now show their native plot values alongside the name and length. They follow the same crosshair, latest-bar and revealed-Replay readout as the Data window, preserving plot formatting and colors. Hidden/error studies and unavailable/loading/interrupted chart states do not keep old numeric values visible.

Values are matched through application indicator id → native handle id → native model id. No title matching or insertion-order guessing is used, so two EMA studies with identical native titles and different lengths remain distinct. The Data window also includes the configured length where available, making those same-title instances readable there.

The pinned Vela readout adapter adds stable model ids and separate `legendRows` to each native group. It asks the renderer for each plot surface separately: data-window-only plots do not leak into the legend, and legend-only groups are retained without creating empty Data window headings. Existing native formatting, plot visibility and scale rules remain authoritative. The adapter now validates four anchors in each of five pinned non-minified bundles; unexpected versions/shapes fail before writes. It remains idempotent and uses temporary-file replacement.

`useChartReadout` shares one native binding/timer between indicator chips and an open Data window. The external store detaches only after its final consumer leaves, fences obsolete primary-chart callbacks and supports independent duplicate listener registrations. Polling also observes late native-handle mappings even when numeric values did not change. The native values and both surface arrays are copied before publication.

A real mobile PineTS check exposed fixed-height clipping in a multi-plot chip. Chips now grow and wrap within their legend width, and the scrollable legend permits a larger visible height. This retains all returned values without widening the document.

## Verification

- **92 test files / 1,131 tests passed**; final production build and standalone TypeScript passed. Logs: `artifacts/legend-values-tests.log`, `legend-values-build.log`, `legend-values-typecheck.log`. The final length headings and responsive CSS additionally have final build/typecheck and actual browser evidence.
- Twelve new tests cover duplicate-title/reordered native groups, stale/missing handles, plot-surface separation, loading/error/recovery gates, per-plot formatting/colors, the actual installed native group extension, one binding for multiple consumers, delayed id mappings, stale chart callbacks and independent/idempotent disposals. The focused native/readout/legend group passed 38 tests.
- Actual Hyperliquid BTC/5m browser: added a temporary second EMA and changed it to 50. In the final duplicate case, EMA20 showed 80,159.73 and EMA50 showed 80,036.44, matching their separate Data window groups, now titled `(20)` and `(50)`. Volume 285.88 also matched. Hiding/showing the second EMA affected only that instance's values.
- Actual Replay at 05:30 UTC showed EMA20 79,776.29 and EMA50 79,844.36, with volume 23.94, matching the historical Data window. Exiting restored live values. Reconnect removed every chip-value group and showed interrupted-history status; fresh native candles restored them.
- Native Bollinger Bands displayed all three returned plot values at 375px, with document scroll width 375px. A temporary PineTS Ichimoku script delivered four current plot values; before correction, the last extended below its row. In the final mobile build all four values were inside both their row and visible legend, with document width/scroll width both 375px. This is actual PineTS worker/native rendering evidence, not a synthetic value fixture.
- Temporary EMA50, Bollinger Bands and Ichimoku studies were removed. Final desktop: original EMA20/Volume with numeric chips, BTC/5m/Candles/UTC, original watchlist visible, bottom collapsed, Replay exited, no horizontal overflow at 1280px. Captured warnings/errors empty. Viewport override reset; no alert or order command created.

Artifacts: `artifacts/legend-values-browser.json`, `legend-values-duplicate.png`, `legend-values-replay.png`, `legend-values-mobile.png`, `legend-values-pinets-mobile.png`, `legend-values-production.png`.

## Boundaries

These are the actual native plotted values, with the engine's existing calculation/settling behavior; they are not independently recomputed indicators. Browser evidence covers native EMA/Volume/Bollinger and this bundled PineTS Ichimoku script, not every library script, plot style, offset, input schema, device or secondary chart cell. Missing plot values remain missing rather than fabricated. Length disambiguation applies where a study exposes that input; full native legend folding, every parameter/title convention and complete TradingView behavior remain separate parity work.
