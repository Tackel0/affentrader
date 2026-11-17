# Rolling Volume Profile

Reference: [official Vela Volume Profiles](https://docs.luxalgo.com/platform/charts/order-flow/volume-profiles), inspected 2026-11-04.

Rolling Volume Profile is available under Indicators → Order flow. Defaults are
100 bars, 24 equal price bins, 30% width and 70% value area. Its classified buy/sell
histogram, POC, VAH/VAL, labels, colors and width have dedicated controls. Session
calendar, manual row size, POC extension and developing lines are not rolling
options. Profiles anchor at the end of the selected loaded window. The largest
row uses the requested width fraction rather than the session painter's 220px cap
or an anchor at the last observed execution's timestamp.

The live window includes the forming bar and slides when a new loaded bar arrives.
Only trades belonging to the selected actual candle buckets contribute; execution
records inside holes between loaded bars are excluded. End boundaries are exclusive.
Replay selects only candles completed by the owning recorded clock, uses only its
archived prefix and rebuilds on backward seeks without reading/subscribing to live
trades. Missing observations produce an empty state, not zero-filled rows. Source,
epoch, archive revision and Replay identity fence the renderer and its readout.

Each native instance retains observations beyond the short market display tape.
Collection is bounded at 100,000 executions and the chart window at 50,000 bars,
with explicit errors instead of silently truncating the input. Current calculation
is synchronous; full-capacity front-end performance remains unverified. Retention
does not imply full venue history or persistence across a browser reload. Classified
volume is not estimated from candle direction, and underlying print counts are not
needed for volume profiles. Simulation quantities are labeled and separated.

The Data window shares the profile surface mechanism but labels this as a **current
rolling window snapshot**, with Window start/end, first/last collected executions,
buy/sell/total/delta, POC row/center and actual value-area share. These are not the
selected candle's volume or a reconstructed historical rolling window. Selecting
a candle outside the current window does not invent its past rolling profile.

## Verification

- Eleven focused regressions cover defaults/settings, sliding/completed ranges,
  classified decimal quantities and exact last-bar ends, missing chart buckets,
  corrections, source isolation, retained observations, setting changes, stale
  callbacks, independent instances, forward/backward archived Replay, current-window
  readouts and requested width/right-edge projection.
- `scripts/verify-rolling-profile-live.ts` captures public Binance/Kraken executions
  for 20 seconds and independently assigns integer-price bins and fixed-scale
  quantities. It derives explicitly partial observation candles from that capture,
  not fabricated complete exchange history. Windows of 1/3/100 observed bars pass
  all six comparisons of row buy/sell quantities, totals, POC and value-area indices
  and quantities. The completed run captured 125 Binance aggregates and 15 Kraken
  trades. Raw records and results: `artifacts/rolling-profile-live.json`.
- The oracle's adjacent-row value-area walk matches the app's documented profile
  rule; it does not establish that Vela uses exactly that rule. Exact Vela price-bin,
  tie-break and value-area equivalence remain subject to direct comparison.
- The full suite passes **1,851 tests across 169 files**, production build and
  TypeScript. Logs: `artifacts/rolling-profile-{tests,build}.log`.
- An isolated production browser checked actual live histogram/levels, defaults,
  Data window semantics, changes to 20 bars / 12 rows / 80% VA / 60% width, zoom,
  label toggling, reload persistence and a 414px change to 30 bars. Captured browser
  warnings/errors were empty. Screenshots: `artifacts/rolling-profile-live.png`,
  `-data-window.png`, `-zoom.png` and `-mobile-settings.png`.

Remaining: direct Vela default/color/numeric-format/visual/source comparison,
full historical coverage, populated multi-chart and browser recorded Replay,
large-input performance, and remaining Session Profile period/calendar/developing
and untouched-POC features. Full Orderflow parity is not established.
