# Hollow and Volume candle controls — 2026-10-27

Hollow and Volume candles now expose active native Vela SDK settings pages: Body, Borders and Wick each have independent visibility and bullish/bearish colors. Volume candles additionally offer Color based on previous close. Before this change, the actual native settings dialog showed no paint controls for Hollow candles, and the custom painters always drew their hard-coded geometry/colors.

## Behavior and architecture

`lib/chart/candleLayers.ts` separates typed paint preferences, SDK descriptors, color/fill classification and Canvas painting. Hollow color compares the current close with the preceding close; hollow/filled shape compares the current close with its own open. Volume candles use open/close colors by default, with an explicit previous-close option. Body, border and wick visibility are independent. Doji and narrow/zero-volume geometry remain finite, higher-volume bodies are wider, and inverted coordinates retain valid body geometry. Style resolution happens once per layer frame.

The reference rules were checked against TradingView's official [Hollow candle explanation](https://www.tradingview.com/support/solutions/43000745270-hollow-candle-charts-explained/) and [Volume candle explanation](https://www.tradingview.com/support/solutions/43000724995-understanding-volume-candle-charts/). Those sources establish the separate Hollow comparisons and the Volume comparison option; they do not establish our exact pixel scaling.

Registered native SDK pages appear directly after Symbol and become the initially selected settings page for the active style. They use the engine's native controls, color picker, mobile Sections navigation and reset integration. This is an SDK page beside Symbol rather than proof of identical TradingView tab placement. Vela package code is unchanged for this checkpoint.

`SeriesPreferences.pluginCandles` is an optional bounded extension. Both per-type bags validate complete known color/boolean fields, while renderer-side partial bags resolve explicit defaults without losing false. Native config patches affect only these two bags and preserve other plugin data. The existing cell-owned series binding carries choices through local persistence, workspace cells, named layouts and validated backups. Older eight-field series preferences remain valid and restore initial plugin defaults.

## Verification

- **103 files / 1,221 tests passed**, final production build and standalone TypeScript passed. Logs: `artifacts/candle-layers-tests.log`, `candle-layers-build.log`, `candle-layers-typecheck.log`.
- Nine new contracts cover all four Hollow color/fill combinations, Volume comparison modes/first-bar fallback, independent geometry visibility and inks, volume widths/doji safety, actual SDK registration, strict schemas/partial defaults, cell/layout/backup round trips, legacy restoration and preservation of unrelated native bags. Existing series tests remain green.
- Actual before-fix browser: Hollow had no Body/Borders/Wick controls. New native SDK page exposes all three plus named bullish/bearish color buttons.
- Production browser: Hollow blue#33adeb/orange#eb8933 and Wick=false survive reload. Body=false with Borders/Wick=false removes all custom candle marks while EMA/Volume remain visible; the hidden state itself survives reload. Both visible/hidden screenshots visually inspected.
- Actual cells: cell2 starts with green#089981 and Wick=true while cell1 retains blue/Wick=false. A cell2-only Borders=true survives switching away/back; cell1 remains Borders=false. Cell2 restored before returning to Candles.
- Actual Volume: previous-close=true, body#ab47bc and Wick=false survive reload. Switching back to Hollow retains its independent colors/visibility. Purple Volume screenshot visually inspected.
- Mobile375: previous-close changed back to false and retained after reload. Native plugin page fits without document overflow; settled mobile screenshot visually inspected. Initial color-picker attempts hit the still-open palette and were discarded as verification evidence; final values were selected/checked after complete popup dismissal. No product persistence fix was needed for that test interaction.
- Final original single BTC/5m/Candles/UTC/Dark, EMA20/Volume, watchlist and collapsed bottom restored. Both plugin styles returned to green/red, Body/Wick=true, Borders=false; Volume previous-close=false. Exact restored colors and flags checked through the UI. No studies/orders/alerts created, viewport override reset, captured warnings/errors empty and preview retained. Explicit default plugin preferences remain stored.

## Evidence and limits

`artifacts/candle-layers-browser.json`, `candle-layers-{hollow,hidden,volume,mobile,production}.png`.

Equal-price color ties retain this implementation's existing bullish convention; the cited strict-comparison examples do not prove every tie case. Relative Volume width uses the visible window's maximum with a minimum legibility width. Exact TradingView pixel sizing, identical tab placement, every color/opacity/device/provider/style combination and full layout/design equivalence remain open. Broker execution and social features remain deferred.
