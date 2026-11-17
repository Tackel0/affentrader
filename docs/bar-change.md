# Selected-bar change and mobile readout — 2026-10-27

The price-series status line now displays absolute and percentage change against the preceding loaded candle's close. It follows the selected crosshair bar, otherwise the live/revealed Replay bar. A tooltip identifies the preceding close and its UTC bucket. Change coloring follows this difference independently of the candle body's open-to-close direction.

Reference: TradingView's [published bar-change formulas](https://www.tradingview.com/blog/en/bar-change-values-added-9502/) use `close - previous close` and divide that difference by the previous close for percentage change. The local implementation uses these formulas rather than the installed Vela widget's open-to-close change calculation.

Lookup requires an exact selected bucket and uses binary search over the retained ordered candles. It never chooses a nearest/future bucket or substitutes the current open for missing history. Session gaps can still use the preceding loaded candle. Missing predecessors, invalid values and arithmetic overflow withhold the result; a zero predecessor preserves the absolute difference but shows an unavailable percentage. Replay rejects selection beyond its revealed time. Existing market/loading/recovery gates withhold obsolete header values.

The **Bar change values** switch lives in Chart settings → Status line and uses existing cell/layout/backup persistence. The previous five-field status-line schema remains valid; normalization adds the enabled change setting while retaining every earlier disabled preference. Delta formatting uses the selected price's standard precision and two decimal places for percentage, suppressing rounded negative zero. User-defined native axis precision equivalence remains unproven.

At phone widths the readout now prioritizes Close, Change and Volume, hides Open/High/Low and can wrap without clipping the new values. Explicit field classes replace reliance on position for this responsive policy. Desktop retains the full OHLC/change/volume surface.

## Verification

- **95 files / 1,153 tests passed**; production build and standalone TypeScript passed. Logs: `artifacts/bar-change-tests.log`, `bar-change-build.log`, `bar-change-typecheck.log`.
- Eight new cases cover previous-close versus current-open direction, historical/Replay future exclusion, missing/exact/first buckets and gaps, zero/negative baselines, invalid/overflow values, corrected preceding candles/live updates, precision/sign formatting and legacy display normalization. The existing native settings test now exercises all six switches.
- Actual production browser: live close80279 minus previous80326 displays−47.00/−0.06%; historical keyboard selection uses previous80034 and displays+245.00/+0.31%. All five captured live/historical/Replay/final observations pass an independent arithmetic comparison from their displayed operands.
- Actual Replay06:20 close79728 versus preceding79800 displays−72.00/−0.09%; next06:25 close79737 uses79728 as its predecessor and displays+9.00/+0.01%. Replay exited afterward.
- Disabling Bar change values survives reload while OHLC/Volume remain. The switch was restored enabled. Actual Reconnect clears the change group while the strip says Candle history interrupted, then fresh history restores it.
- At375px, visible Close/Change/Volume fit inside the strip (right edges112.28/185.34/230.78 inside272); document scrollWidth375. The saved screenshot was visually inspected. Desktop1280 has no document overflow.
- Original BTC/5m/Candles/UTC single chart, EMA20/Volume, watchlist and collapsed bottom panel restored. No alert/order commands created. The continuation replaced the expired preview process/tab with the checked build; final fresh preview arithmetic also passes. Final captured warning/error logs empty, viewport reset and preview retained.

Artifacts: `artifacts/bar-change-browser.json`, `bar-change-{historical,replay,mobile,production}.png`. The JSON distinguishes earlier recorded browser observations from the final fresh preview after the continuation reset.

This proves the tested source-candle/header flows, not every transformed chart style, native axis precision, provider/session rule, inactive-cell heading or complete TradingView layout. Full 1:1 parity remains unproven and the broader goal stays active.
