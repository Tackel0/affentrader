# TPO Initial Balance in minutes

The native TPO settings now expose **Initial balance (minutes)**, default 60,
independent of the TPO block length. This follows the minute-based opening period
in the official reference inspected on 2026-11-04:
https://docs.luxalgo.com/platform/charts/order-flow/tpo

Existing saved block-count preferences migrate to their previous elapsed
duration. For example two 240-minute blocks become 480 IB minutes; changing
the block interval afterward does not change that duration. The oldest saved
preferences without an explicit block count retain their former two-block
default during migration. New defaults and partial configuration use 60 minutes.
The legacy block-count field remains readable but is no longer a visible input.

Only wholly contained, revealed candles contribute to the opening range.
The endpoint is exclusive and clamped at session end. For 45 IB minutes and
30-minute candles, the 00:30 candle is excluded because its high/low could have
occurred after 00:45. The remaining result is incomplete; if no whole candle fits,
it is unavailable. Neither case publishes completed IB extension levels. A finer
chart interval is required for exact coverage. The Data window explains this
source constraint and shows duration, end and loaded/expected slots.

The existing decimal range arithmetic, developing/completed distinction,
extensions, session DST handling and completed Replay prefix contract remain.
Minute changes invalidate the model cache; color/visibility edits reuse it.
No historical market events are republished.

## Verification

- Nine new regressions in `tests/tpo-ib-minutes.test.ts` cover all five block
  intervals, legacy migration, validation/native serialization, prefix and
  post-boundary isolation, coarse straddling candles, session clamping, DST,
  cache invalidation/repair, Data readout and invalid direct calls.
- Full suite: **1,873 tests in 171 files passed**, TypeScript and production
  build. Evidence: `artifacts/tpo-ib-minutes-tests.log`,
  `artifacts/tpo-ib-minutes-build.log`.
- Independent public Kraken check: `scripts/verify-tpo-ib-minutes-live.ts`,
  720 closed BTC/USD 15m candles, final forming row excluded. Raw venue OHLC
  and independent UTC Date arithmetic verify 45/60/90 IB minutes across
  Day/Week/Month and 30/60/240-minute blocks: **27 combinations, 108 session
  checks**. Bounds, high/low, counts, coverage status and block independence
  agree. Capture: `artifacts/tpo-ib-minutes-live.json`.
- Isolated production browser verified old Month/240/two-block settings migrate
  to 480 minutes; custom 45 minutes survives a change to 30-minute blocks and
  reload. Reset defaults gives 60 minutes; switching to 240-minute blocks
  preserves 60. Actual Binance 15m Data window shows 240-minute blocks with
  IB end 01:00 UTC, 4/4 slots, complete coverage.

The responsive check exposed native max-content control columns collapsing
field labels when long plugin hints are present. A scoped mobile settings-grid
override bounds both columns and wraps hints. This fixes the dialog layout,
without changing chart calculations.

At 414px the corrected control/label columns each measure about 170px, the grid
scroll width equals its 351px visible width, and editing 90 minutes works.
The value survives reload back on desktop. The test workspace was returned to
60 minutes. Captured browser warning/error logs are empty. Screenshots:
`artifacts/tpo-ib-minutes-settings.png` and `artifacts/tpo-ib-minutes-mobile.png`.

This checkpoint does not establish full Vela parity, complete classified
history, or populated multi-chart and browser recorded-Replay equivalence.
Trading-hour presets/calendars, TPO metric themes, volume ladder, markers,
real-time split columns and chained merging remain in the parity checklist.
