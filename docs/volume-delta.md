# Volume Delta and CVD

Reference: [official Vela Volume Delta documentation](https://docs.luxalgo.com/platform/charts/order-flow/volume-delta), inspected 2026-11-04.

The catalog now exposes a standalone Volume Delta pane. Signed columns show
classified buy quantity minus sell quantity in Total mode, or buy quantity divided
by buy print count minus sell quantity divided by sell print count in Average mode.
Positive/negative colors are independently configurable. A genuinely absent side
contributes zero; a present observation with unknown or unsafe counts leaves an
Average gap. Unknown cumulative Average contributions invalidate the remainder of
that anchor; independent per-bar delta recovers on the next known bar. Total
quantity remains usable without print counts.

CVD now defaults to Month, Candles and Total. UTC Day/Week/Month/All data anchors,
Average mode and native Area output complement the existing Line and Candles.
Explicit saved Session/Collection and Histogram/per-bar settings remain supported.
Calendar controls are shown only for Session. Style and mode changes retain the
collected history; switching modes does not reseed from just the rolling tape.
Monthly and tick-based charts are explicitly unavailable for these studies.

Both modes retain timestamp/sequence/ID ordered observed-prefix extrema through
late insertion and duplicate-ID compaction. Average means are non-additive, so
their path retains per-side numerator/count state instead of summing per-message
means. Binance aggregate counts use inclusive first/last trade IDs. Kraken and
Hyperliquid classified trade records carry one print each. Old count-less archives
remain unknown. An aggregate's Average close is supported by these counts, but
the individual constituent-print excursions inside it are unobserved. The coverage
notice discloses this wick limitation. All anchors start from available observations;
a monthly label does not establish complete monthly history. Unobserved UTC bars
remain gaps. CVD is a sum of per-bar means in Average mode, not a mean over the
entire anchor.

## Verification

- Fourteen new regressions cover defaults, UTC boundary resets, Total/Average
  arithmetic, observed-prefix OHLC, gaps, unsafe counts, mode retention, compaction,
  monthly/tick rejection, wrong-symbol isolation and standalone native columns.
- Existing Session/Line regression fixtures now declare those legacy settings
  explicitly. Recorded Replay tests cover native Area clearing and both Average
  panes through forward/backward seeks, forming-bar exclusion and refusal to read
  or subscribe to live data.
- `scripts/verify-volume-delta-live.ts` independently reads raw public venue fields
  and compares all five OHLCV fields for Total/Average, per-bar/cumulative, at 1s and
  1m. The completed capture contains 40 Binance aggregates / 46 prints and five
  Kraken trades. All 16 combinations pass within a relative/absolute 1e-10 tolerance.
  Raw records and expected/actual results are in `artifacts/volume-delta-live.json`.
- The full suite passes **1,809 tests across 165 files**; production build and
  standalone TypeScript pass. Logs: `artifacts/volume-delta-tests.log` and
  `artifacts/volume-delta-build.log`.
- An isolated production browser checked Month/Total/Candles defaults, six candle
  colors, standalone mode/sign-color controls, Week/Average/Area and Line switching,
  reload persistence, populated live 1s/1m panes and 414px controls. Captured browser
  warnings/errors were empty. Screenshots: `volume-delta-total.png`,
  `volume-delta-average-area.png`, `volume-delta-mobile-settings.png` in `artifacts`.

Direct Vela visual/source equivalence, browser recorded Replay, populated
multi-chart isolation and full historical coverage remain unproven. Small native
readouts can round to two decimals; precision/format parity remains open.
