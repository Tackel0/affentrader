# Footprint row grid — reference contract and implementation

The retained public chart bundle in `artifacts/vela-footprint-reference/index.json`
was inspected for the actual row-grid rules. Affentrader now implements the
following calculation/settings contract; complete visual parity remains unproven.

Reference behavior:

- Rows default to Auto; Manual defaults to four ticks per row.
- Manual tick counts are rounded and bounded to 1–64.
- Auto measures the vertical pixel distance of one base tick at the midpoint of
  the current price scale, using the renderer's actual `priceToY` transformation.
- Starting from one tick, the multiplier doubles until the row is at least 16
  pixels high or the multiplier reaches 4096. Nonpositive pixel distance retains
  one tick. This is a power-of-two aggregation, not an arbitrary rounded multiple.
- Each per-bar instance selects Auto or its own manual multiplier. The visible
  aggregate has its own row settings and uses the original retained executions.

Implementation:

- `footprintStep` measures the actual coordinate transform at the price-scale
  midpoint and doubles the venue tick multiplier to the fixed 16-pixel threshold,
  capped at 4096. Native Auto/Manual controls replace the former height control.
- `lib/orderflow/footprintGrid.ts` uses verified Binance/Kraken increments and
  price-dependent Hyperliquid precision from `lib/market/priceGridMetadata.ts`.
  Quote formatting and price-magnitude guesses do not establish a live venue grid.
- Saved positive price-unit overrides remain explicit legacy overrides rather
  than silently reinterpreting them as a count of venue ticks.
- Asynchronous precision loads are scoped to symbol/lifecycle, fence stale replies,
  refresh every five minutes/back off errors for 30 seconds, and label current
  venue precision in archived Replay.
  Missing metadata must remain visible as missing, not be replaced by an asserted
  venue tick. Keep any synthetic display-grid estimate explicitly SIMULATED.
- Metadata completion requests a native renderer frame through the cell's public
  Vela resize bridge (or the native study data push), including candle/grid
  modulation, without requiring a new trade. Main/secondary hosts clean up the bridge.

Evidence on 2026-11-05:

- 22 focused regressions cover linear/log/inverted transforms, the 16-pixel
  boundary and 4096 cap, decimal Manual 1–64 grids, strict disabled-instance and
  visible-profile persistence, legacy overrides, simulated provenance, metadata
  completion/failure/refresh/disposal/source fences and native study frame updates.
- 2,820 independently computed row comparisons across fresh public Binance
  (1,000 observations), Kraken (1,000) and Hyperliquid BTC (10) responses, with
  Manual 1/2/4/7/16/64 and Auto linear/log/inverted configurations. Retained raw
  responses: `artifacts/footprint-grid-source.json`; verifier:
  `scripts/verify-footprint-grid-source.ts`. This proves observed rows only.
- Frozen synthetic native-renderer fixture: metadata pending has no price grid;
  resolving 0.01 alone requests one native frame and updates five profiles to
  0.08/0.04/0.07/0.16/0.64 with a separate 0.03 visible aggregate. A native Manual
  edit to nine ticks produces 0.09. Desktop and 414-pixel evidence and no console
  errors are retained in `artifacts/footprint-grid-browser-evidence.json`.
- Real Binance live HTTP/WebSocket data on an isolated production build displays
  the 0.01 PRICE_FILTER source notice. Native Manual/seven ticks survives reload;
  the visible aggregate can independently use Manual/three ticks. Mobile controls
  and source screenshots: `artifacts/footprint-grid-native-*.png` and
  `artifacts/footprint-grid-binance-source.png`; native evidence JSON alongside.
- 2,306 tests in 212 files and the production build passed. Test-only fixture
  prices use canonical cents to avoid incidental off-grid floating point sums.

Limits: historical tick-rule changes are not reconstructed; the current venue
grid is disclosed in recorded Replay. Complete browser recorded-Replay,
populated multi-chart, full-capacity and direct Vela visual comparison remain
open. Unsupported venue metadata stays unavailable unless the user explicitly
sets a price-unit override. Free feeds still do not establish full execution history.
