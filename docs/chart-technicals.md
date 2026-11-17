# Selected-chart technicals correctness and long-range cost

Core-function continuation, 2026-10-27. Full TradingView equivalence remains unproven; broker/social expansion remains deferred.

## Findings and corrections

The production 1D preset loaded a full day of minute candles. Rapid 3M followed by 5D selection ended on the requested five-day, five-minute view. While checking recovery and historical views, the sidebar exposed a separate correctness issue: its Technicals memo depended on only candle count, latest close and latest timestamp. A high/low/volume-only update or a repaired older candle could leave oscillator/VWMA values stale. The sidebar also kept showing a directional rating while native candle history was explicitly interrupted.

`TechnicalsCard` now derives its complete view from the immutable candle-array identity and selected chart/recovery/Replay context. Changes to high, low, volume and earlier candles therefore invalidate the calculation. Live recovery or chart errors suppress votes/gauges. The central chart-store setter clears obsolete candles when symbol, interval or feed generation changes, unless the same atomic patch explicitly supplies the newly loaded series. Cosmetic changes preserve the series. This protects consumers during a chart switch rather than attaching a new interval label to the previous interval's values.

Replay ratings use only bars at or before the native cursor. Missing cursors and fewer than 60 revealed bars produce an unavailable view. Live socket recovery does not hide an already revealed Replay prefix. The card identifies Replay and exposes the latest evaluated bar's ISO time in its help-text tooltip. Exiting Replay restores live evaluation. These are local standard indicator rules, not proof of TradingView's proprietary rating algorithm or exact behavior of its details sidebar.

Awesome Oscillator previously called the full 34-bar SMA inside the per-bar map, yielding quadratic repeated work. That series is now computed once and indexed alongside the five-bar series. Formulas and outputs are unchanged.

## Verification

- **88 test files / 1,075 tests passed**, production build and standalone TypeScript passed: `artifacts/technicals-tests.log`, `technicals-build.log`, `technicals-typecheck.log`.
- Nine new chart-rating contracts cover high/low/volume changes with unchanged last close/time/count; earlier-bar repair; poisoned future bars excluded during Replay; missing/insufficient Replay context; live interruption/error suppression and recovery; symbol/interval/feed invalidation; cosmetic retention and explicit interval-history commits. Existing rating/range/workspace tests also pass. The pure calculation tests do not substitute for browser lifecycle evidence.
- `scripts/benchmark-technicals.mjs` exercised the actual rating function on deterministic 1,000/5,000/20,000-bar series before and after. All complete rating objects matched exactly with a separate deep-equality comparison. The observed single-run timings were 15.18/91.21/2,112.65 ms before and 10.45/10.37/42.01 ms after. Files: `artifacts/technicals-benchmark-before.json`, `technicals-benchmark-after.json`. These are local Node timings, not a GPU/browser or hardware-independent latency guarantee.
- Production browser: BTC/5m/Candles/UTC with EMA and Volume; starting native Replay evaluated the historical 01:35 UTC prefix (Strong Buy summary), stepping moved evaluation to 01:40 UTC and changed votes from 2 sell/9 neutral/15 buy to 1/8/17. Expanded indicator values rendered. A Go-to 09:00 UTC target beyond that cursor was rejected. Exit restored the live Sell summary and live timestamp. No paper order was placed.
- Actual Main-menu Reconnect immediately replaced all three gauges with “Waiting for uninterrupted candle history” while the chart header reported interrupted history. Fresh history restored all three gauges and actual OHLC. Captured warnings/errors were empty. The final desktop document width/scroll width were both 1280. Files: `artifacts/technicals-browser.json`, `technicals-replay.png`, `technicals-replay-date-guard.png`, `technicals-recovery.png`, `technicals-production.png`.

## Remaining work

Follow-up: [Replay chart-zone dates and historical page retention](replay-timezones.md) resolves the computer-zone control discrepancy described below and the later-discovered missing older-page cache. That continuation has a separate 1,093-test gate and actual Berlin-fold/browser evidence; this document retains its original checkpoint results.

Exact native indicator/rating equivalence, exchange/session calendar navigation, arbitrary deep-date archives and every transformed chart style remain unproven. This card evaluates the loaded OHLCV series, not reconstructed order-flow or unrevealed future bars. A separate observed discrepancy remains in the Replay toolbar: its datetime-local field reflects the computer's zone while Go-to and the chart use the selected chart zone. That control still needs the same explicit zone and DST handling as Go-to; this checkpoint does not claim to resolve it.

Reference navigation entry point: [TradingView Go-to documentation](https://www.tradingview.com/support/solutions/43000482911-how-to-go-to-the-specific-date-on-the-chart/). Current local navigation details remain in [chart-navigation.md](chart-navigation.md).
