# Classified Footprint analysis

The native Footprint settings now expose stacked diagonal imbalance zones, a minimum dominant-side volume in base units, a nonzero diagonal-counterpart filter, and optional per-bar volume, delta and delta percentage. The existing row grid, ratio, histogram, side candle, POC and colors remain independently configurable. Legacy twelve-field preference bags remain valid; the new options default off and persist per cell, layout and workspace backup.

## Calculation and display

`lib/orderflow/math.ts` evaluates actual classified trades. Minimum volume is inclusive and affects imbalance flags only; it does not remove volume or change POC. The ratio compares actual quantities without an artificial epsilon floor. Requiring nonzero opposite volume suppresses imbalances with no executed diagonal counterpart.

`lib/orderflow/footprintAnalysis.ts` finds maximal consecutive price-row runs independently for Buy and Sell inside each bar. Missing rows, non-imbalanced rows and unsafe price indices break a run. Zones cover the qualifying rows in that bar; they do not project future liquidity. Delta percentage is `(buy - sell) / total * 100`; empty or invalid totals have no percentage.

`lib/orderflow/footprint.ts` paints colored side zones beneath the cells, with optional volume/delta/delta-percent statistics underneath each detailed bar. Statistics use collected trade volume, which can differ from the full exchange OHLCV candle. A source caption explicitly identifies partial collected history. At narrow zoom, detailed cells, zones and statistics are hidden while actual OHLC side candles remain visible. This corrects the previous early return that also hid those candles.

`lib/orderflow/footprintUpdates.ts` batches matching trade updates at 50 ms and invalidates only the owning live canvas. Pending updates are cancelled on market/style/Replay changes and destruction. Replay displays actual OHLC side candles and an explicit absence-of-recorded-bid/ask notice; it does not synthesize historical order flow from candle volume.

## Verification

- Full suite: **1,345 tests across 113 files**, production build and TypeScript pass. Logs are in `artifacts/footprint-analysis-{tests,build,typecheck}.log`.
- Deterministic coverage includes minimum-volume boundaries, zero/missing diagonal counterparts, tiny legitimate quantities, invalid trade sides, dual-side stacks, price gaps, inverted axes, delta statistics, legacy/advanced persistence, narrow-zoom candles and subscription cancellation.
- Actual Hyperliquid BTC live desktop rendering showed classified cells, stacked zones and changing statistics. Native settings and desktop reload were verified; see `artifacts/footprint-analysis-{live,settings}.jpg` and `footprint-analysis-reload.txt`.
- Mobile settings edited minimum volume to 0.02, consecutive rows to 3 and required nonzero counterparts. These values and enabled zones/statistics survived reload; see `artifacts/footprint-analysis-mobile-settings.jpg` and `footprint-analysis-mobile-reload.txt`.
- Mobile 375 x 812 Replay initially exposed the narrow-zoom candle bug. After correction and a new production build, `artifacts/footprint-analysis-replay-fixed.jpg` shows the historical candles and the explicit unavailable bid/ask-history caption. No detailed order-flow cells/statistics are drawn in Replay.
- The final browser warning/error capture is `artifacts/footprint-analysis-browser-errors.json`. Test parameters were reset, Candles restored, Replay exited and the temporary viewport override removed.

## Remaining scope

Collected trade history is partial and bounded, not a complete historical exchange footprint archive. This change does not add licensed Nasdaq real-time trades or US Level 2. Exact Vela/TradingView feature and layout parity, richer footprint modes, and the separate intermittent older-price-candle issue remain open. The narrow-zoom Footprint correction is not evidence that the separate native candle issue is fixed.
