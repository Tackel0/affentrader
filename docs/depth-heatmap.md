# Liquidity Heatmap from observed depth — 2026-11-01

The indicator catalog now exposes **Liquidity Heatmap** under Order flow. It is a native Vela renderer contribution behind the candles, fed by the app's public Binance/Hyperliquid order-book stream. This is a new history of observed resting liquidity, separate from Footprint, CVD and executed-volume profiles.

## Data contract

- Each running study retains the last received snapshot per selected sample interval, not a sum of repeated resting quantities. Columns use local receipt time; the exchange timestamp is retained separately. The study starts collecting when enabled. It does not reconstruct earlier books from candles or classified trades.
- Snapshots must match the market, be real, have fresh safe timestamps, positive finite quantities/prices, strictly ordered unique bid/ask levels and an uncrossed spread. Invalid, stale, excessively future-dated or out-of-order snapshots are rejected. Native service adapters currently retain the top ten levels on each side; this is not a complete exchange order book.
- No field is painted before its receipt or after the current clock. A snapshot ends at the next retained observation, or three seconds after receipt, whichever comes first. Gaps remain empty. A stale notice appears when the last accepted observation is over five seconds old. These holds are visualization bounds, not proof that the orders remained available until the right edge.
- Price rows use the shared canonical decimal grid. A custom size groups actual level quantities; Auto uses observed adjacent price spacing, without claiming verified venue tick metadata. A coarse row containing both sides splits its time width so one color cannot hide the other. Colors/intensity represent sampled offered quantities, not executions, cancellations, absorption, queue position or liquidation data.
- Intensity can be linear or logarithmic, normalized against the retained sampled quantities. Opacity and bid/ask colors are configurable. Pan, zoom and inverted price projection use the owning native chart coordinates. At coarse chart scales the short observed columns can be subpixel; zoom in around the observation period to inspect them.

## Bounds and lifecycle

There are at most 600 retained columns and 50 levels per side per accepted input snapshot (60,000 level records at the guard limit). The configured retention window is 1–30 minutes; the column cap can shorten it at fast sample rates. The sample interval is 250–10,000ms. Native top-ten adapters normally retain much less than the guard limit. History stays in memory and is cleared on source/market/timeframe/Replay changes, suspension and reload. Styling survives via the existing workspace persistence. Sampling/retention changes restart collection; color/opacity changes preserve the current collection inside the native contribution.

The native instance subscribes directly to depth-only events and runs a one-second clock for expiry/staleness. Updates invalidate host-owned canvas layers rather than relayout the chart. Hidden/stopped instances detach depth listeners and timers. Generation fences reject a detached callback after resume. A fresh source identity resets the previous collection before accepting new observations.

For Replay, start **Capture depth for Replay** in the Order flow panel before collecting the desired period. IndexedDB retains a rolling 10-minute window with up to 2,400 snapshots in total. The active tab loads up to four markets. The study reads the recorded window at each completed candle boundary and clips the last column there. Both receipt and venue time must precede the boundary. Backward seeks rebuild the smaller window and gaps stay empty. The study's sample interval controls live collection. Replay uses the capture's one-second sampling.

Replay depth requires a matching time-based exchange chart and recorded samples in the selected window. A reload restores committed samples and starts with capture paused. Writes are batched every two seconds, so allow recent samples time to commit before reloading. A storage error falls back to in-memory capture and is shown in the Order flow panel. The classified execution archive and recorded depth capture are separate sources.

## Verification

Replay continuation: 1,720 tests across 153 files and production build passed. The native study regression checks that a backward seek removes later recorded columns and that projected cells end at or before the completed candle boundary.

- **1,644 tests across 144 files**, production build and standalone TypeScript pass. Nine new tests cover immutable sampling without double counting, gap/future limits, retention/capacity, malformed/crossed/stale/mixed sources, exact decimal boundaries, unsupported precision/overflow, positive normal/inverted rectangles, same-color mixed rows, depth-only repaint, source/Replay resets, style/sampling behavior and listener/timer cleanup. The capacity case constructs 600 × 100 = 60,000 cells and checks quantity conservation. This is not an upper-bound mobile frame-rate guarantee.
- Actual production browser: the catalog, native settings, live Hyperliquid BTC sample collection and bid/ask bands rendered on the chart. A zoomed minutes chart exposes separated colored fields rather than a filled historical background. Replay removes them and displays its missing-depth explanation. Simulation removes real fields and labels the missing book. Opacity 75 persisted through reload; the in-memory observation history restarted. Hide/stop lifecycle is tested in the native instance contract. The original 5m Footprint, SVP and VRVP were restored after the temporary minutes/candle comparison.
- Actual 20-second public Hyperliquid WebSocket check accepted all five received top-ten-per-side snapshots, with no parsing errors or rejected samples. Receive gaps ranged from 2,192 to 5,441ms. Local receipt minus exchange timestamp ranged from 1,417 to 1,500ms in that run; clock differences and transport affect that measurement. The model produced 100 cells, row size 1, maximum paint hold 3,000ms and zero future/invalid-duration cells. Real gaps are expected with this observed feed cadence. No inference of continuous order-book coverage is made.
- At the default 414px viewport, the settings and retained opacity remained accessible and document width equaled viewport width. Browser warning/error inspection was empty. Temporary viewport overrides were reset. No orders or alert transmissions were made; archive recording remained off.
- A temporary 5s Hyperliquid chart request returned the existing provider's unsupported-interval notice; the live check used its supported minute history. Actual Binance heatmap transport, all eight simultaneous depth charts, long-running upper-bound browser load, a depth archive and recorded depth Replay remain unverified or open.

Artifacts: `artifacts/depth-heatmap-tests.log`, `depth-heatmap-build.log`, `depth-heatmap-typecheck.log`, `depth-heatmap-live.json`, `depth-heatmap-live-detail.jpg`, `depth-heatmap-replay.jpg`, `depth-heatmap-simulation.jpg`, `depth-heatmap-settings.jpg`, `depth-heatmap-mobile-settings.jpg`, `depth-heatmap-browser-errors.json`.

To repeat the independent public transport check:

```powershell
pnpm exec esbuild scripts/verify-depth-heatmap-live.ts --bundle --platform=node --format=esm --outfile=artifacts/depth-heatmap-live-check.mjs
node artifacts/depth-heatmap-live-check.mjs
```

Full TradingView/Vela equivalence and complete historical/depth/equity coverage remain open. This feature supplies actual observed public depth rather than filling those gaps with synthetic liquidity.
