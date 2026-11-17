# Ordered execution CVD candles

CVD now offers native **Candles** alongside Line and Histogram. Each candle represents the actual ordered classified trades that this indicator has collected, with explicitly partial coverage. It does not estimate missing buy/sell history from price candles.

## Calculation

For cumulative delta, the opening value is the previous aggregate close within the same observed session, or zero after a reset. Each signed execution quantity advances the path; high and low include every intermediate prefix and the opening value. Close is the final prefix. Per-bar delta uses an independent zero opening on every bar. Quantity volume sums both sides. A net-zero bar can therefore retain nonzero wick excursions.

Trades are ordered by timestamp, then the venue sequence when available, then ID. Unsequenced executions sort after sequenced ones at the same timestamp. ID ordering is a deterministic fallback, not proof of the true exchange order for tied timestamps. This rule is also disclosed in the settings dialog. The selected feed's timestamp/sequence precision limits the result.

`lib/orderflow/deltaPath.ts` maintains an augmented AVL tree of the unsealed execution suffix. Each subtree stores total, minimum prefix, maximum prefix and traded quantity, so out-of-order insertions update extrema without rescanning every execution in a busy candle. Old executions compact into an ordered prefix summary when their duplicate IDs fall below the existing timestamp watermark. The current accepted late execution is inserted **before** a compaction that might advance past it. Deliveries older than the sealed watermark are refused. Aggregate contributions and extrema survive rolling-buffer and ID compaction.

Calendar sessions, DST, overnight windows and partial-bar boundaries follow the existing CVD calendar. The final observed session segment supplies a bar containing a reset. Missing older/session slots remain index-aligned NaN candles; quiet bars carry a flat cumulative value only within the same observed session. Per-bar delta does not require an otherwise unused representable cumulative session total. Capacity/precision failures remain latched and visibly unavailable through the native adapter.

## Native UI and readout

The indicator emits Vela's real `CandleSeries`, including body, wick and border colors for each direction. Six independent validated hex controls persist through the existing study input storage; Line/Histogram preferences remain compatible. Selecting Candles hides irrelevant line controls, and selecting another plot hides candle-only controls. The modal keeps its scrollable content and fixed Apply/Cancel footer on mobile.

Vela normally reports only a candle plot's close in its data window. Four explicitly data-window-only series expose CVD/Bar delta Open, High, Low and Close. They add no painted lines, legend duplicates or scale extent. Switching to Line removes these extra readout fields. The ordinary legend continues to report the close.

Replay still shows no CVD values without a recorded classified execution history. Changing presentation preserves collection; market/session/lifecycle transitions retain the documented partial-history behavior. No licensed feed, recorded execution journal or complete-session claim was added.

## Verification

- **110 test files /1,306 tests passed**, production build and standalone TypeScript passed. Logs: `artifacts/cvd-candles-{tests,build,typecheck}.log`.
- Thirteen new candle tests plus fourteen existing CVD tests cover signed-path OHLC, zero-net excursions, late revisions, sequence/ID/mixed ordering, compaction and an insertion that itself advances the watermark,4,000 disordered arrivals against an independently sorted reference,12,000 ordered insertions/deletions, whitespace alignment, quiet/session bars, color validation, native outputs/readout surfaces, and independent per-bar overflow behavior.
- Actual production browser: Hyperliquid BTC/5m produces native colored bodies and wicks, independently visible low/close values, all four Data window rows and live updates. Session cumulative and Bar delta, Line→Candles readout replacement, invalid-hex rejection, six-color reload persistence, native Replay unavailable state and live return were exercised.
- Actual375×812 mobile: candle Style fields, content scrolling, fixed footer, Down body edit to`#ff4477`, reload persistence and the live candle pane were inspected. Other saved colors were `#33adeb`, `#00cc99`, `#ff66cc`, `#cccccc`, `#dddddd`. Tests created no orders or alerts. The temporary study was removed and the original BTC/5m/Candles/UTC/Dark workspace with EMA20/Volume restored.
- Evidence: `artifacts/cvd-candles-{live,zoom,data-window,reload-settings,replay,mobile-settings,mobile-reload,mobile,final,production}.jpg`, `cvd-candles-readout.txt` and browser logs. Earlier screenshots show progressive checks; the final capture records the settled current build. Arithmetic uses independent deterministic reference tests; UI/live checks are not an independent full exchange-ledger reconciliation.

Full TradingView/Vela equivalence remains unproven. TradingView's lower-timeframe volume estimate is a different data method; exact numerical equivalence, complete historical order flow, other source entitlements, every derived-chart interaction and the intermittent older-price-candle rendering issue remain open. These candles improve the classified-stream path without substituting synthetic historical delta for missing executions.
