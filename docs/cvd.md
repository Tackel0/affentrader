# Classified cumulative volume delta

Latest continuation: [ordered execution CVD candles](cvd-candles.md), with native OHLC candles, persistent body/wick/border colors and four Data window fields. The original line/histogram checkpoint below remains separate verification evidence.

The chart CVD now accumulates classified trade quantities instead of repeatedly rebuilding its entire baseline from the service's latest5,000 trades. The previous implementation could lose old contributions as that buffer rolled, had no session inputs, and depended on candle callbacks for updates. Its Replay cutoff also admitted live trades within a revealed bar even though no recorded historical trade sequence existed.

## Calculation and controls

`lib/orderflow/cvdModel.ts` aggregates buy quantity minus sell quantity into the requested time buckets. It retains aggregate contributions independently of the rolling service buffer. Duplicate IDs are ignored, out-of-order deliveries within the retained ID horizon update the correct bucket, and older deliveries below the compacted timestamp watermark are rejected rather than potentially counted twice. Source transitions clear the previous exchange/simulation baseline; stale opposite-source deliveries are rejected. Missing earlier history remains null.

The native study exposes session or collection anchoring, cumulative or per-bar delta, IANA session zone, start minute, duration, weekdays, line/histogram, color and width. Session assignment reuses the DST-aware calendar shared with TPO and SVP. For an anchor inside a chart bar, the last observed session segment supplies that bar's value. Session changes restart from the current retained source; changing plot/calculation/color/width preserves accumulated quantities. Native histogram uses zero as its base. Inputs/styles use the existing per-chart/layout/backup persistence path.

The indicator subscribes directly to the owning symbol's trade stream and batches trade-triggered painting at50ms. Candle callbacks also refresh native bar alignment. Hiding cancels subscriptions and timers; showing starts a new partial collection from retained trades. Removing, changing market and entering/exiting Replay tear down old callbacks. The pane always reports partial history, accepted trade count, collection start and rejected delivery count; simulated values are explicit. Mobile arguments are compact and the coverage note wraps at a readable font size above the pane's bottom controls.

No live-derived CVD is exposed during Replay. Yahoo markets without classified trades show an unavailable-feed message. No fake bid/ask classification is inferred from historical OHLCV. A new validated six-digit hex field in the shared native-study settings provides exact color entry; invalid text prevents applying and focuses the Style tab.

## Limits

This is a classified execution-quantity series from the selected provider. TradingView documents an intrabar price/volume estimate for its own CVD, so numerical equivalence is not asserted. See [TradingView's published method](https://www.tradingview.com/support/solutions/43000725058-cumulative-volume-delta/), checked2026-10-28. Ordered execution candles are now implemented in the linked continuation; the configurable lower-timeframe estimate remains separate work. The original checkpoint supplies line and histogram presentations.

Initial coverage is limited to retained trades. Reload, hide/show, market changes, Replay transitions and session-setting changes can restart that partial baseline. No complete-session coverage or uninterrupted exchange delivery is promised. The study does not persist an execution journal. Up to20,000 aggregate segments and20,000 recent duplicate IDs are retained; timestamp compaction bounds ordinary ID growth. An over-capacity same-timestamp burst, excessive bucket count or nonfinite quantity stops output explicitly. A failed initial seed remains unavailable on later callbacks instead of exposing a partial calculation. Remove/re-add or change session inputs to restart. Tick-chart intervals are rejected; derived/non-time style equivalence remains unverified.

## Verification

- Complete suite:109 files /1,293 tests passed. Fourteen CVD tests cover signed quantities, duplicates, disorder, rolling-buffer independence, compacted-ID rejection, same-time bursts, session/collection resets, DST/overnight/weekdays, intrabar boundaries, source transitions, capacity/precision, direct tick updates, style preservation, session restarts, lifecycle fencing, Replay/Yahoo and failed-seed recovery. Logs: `artifacts/cvd-{tests,build,typecheck}.log`; final production build and standalone TypeScript passed.
- Production browser: actual Hyperliquid BTC/5m CVD values update with public trades. Line and histogram, Bar delta/Collection/Europe-Berlin, width3, hide/show, native Replay unavailable state and automatic live return exercised. A continuing live accumulator displayed1,000 accepted trades spanning two real candle buckets. No orders or alerts were created.
- Settings survived reload. Invalid `#bad` was rejected; desktop `#ff8800` and mobile `#33adeb` persisted. Actual375×812 modal, compact legend and wrapped coverage inspected. Temporary study removed afterwards; original BTC/5m/Candles/UTC/Dark with EMA20/Volume restored.
- Evidence: `artifacts/cvd-{live-a,histogram,cumulative-line,replay,reload-settings,mobile-reload,final-desktop,final-mobile,production}.jpg`. Early screenshots precede the final mobile argument/wrapping and note-position corrections; final desktop/mobile captures supersede them for layout. Unit fixtures establish arithmetic, while browser evidence establishes live integration and UI behavior; the browser was not an independent exchange-ledger reconciliation.

The intermittent older-candle rendering issue and complete TradingView/Vela order-flow, layout and market-source parity remain open.
