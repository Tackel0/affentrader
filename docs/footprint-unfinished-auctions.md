# Footprint unfinished auctions

## Reference correction on 2026-11-06

The original positive-volume rule below is superseded: the actual reference
also rejects quantities whose compact volume string parses as zero. Thus .001
per side does not mark an auction even with Min volume per side set to zero;
.005 per side qualifies at an equal .005 minimum. Classification still uses raw
volumes on the merged grid, including filtered outer observations, rather than
mean-size geometry or an interior replacement. Extrema are found by price even
when input rows are unordered. High is painted before Low, including a single
row that qualifies at both ends.

Outlines now use the reference one-pixel row gap, half-line-width inset and
strict positive inner width/height. Thin cells no longer get a forced one-pixel
inner rectangle. Original edge ray prices and the indexed inclusive later-only
touch engine remain unchanged, with canonical decimal and inverted-axis support.

- Three new regressions cover compact-zero dust/equality, unordered filtered
  extrema, single-row draw order, the row gap and collapsed outlines. All 34
  targeted tests pass across auction, overlay and reference-touch suites.
- `scripts/verify-unfinished-auctions-reference.ts` executes only the reviewed
  pure classifier/helpers and complete auction overlay branch from retained
  official source SHA256
  `b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b`.
  **1,944 classification cases and 23,040 exact drawing-operation comparisons
  pass**. Before correction, 561 classification and 10,728 drawing cases differed
  (including order). Coverage includes dust/thresholds, sorted/unsorted extrema,
  single/dual rows, six widths, five row heights, four stroke widths, opacity,
  offscreen origins, ray switch, inclusive revisits and fractional pane offsets.
  This compares the reviewed auction branch and same merged-grid inputs, not
  full-app pixels, slot packing, cross-fade or inverted-axis reference behavior.
- The independent retained Kraken raw-tuple oracle now matches **nine marks and
  three observed revisits** on the original 1,000-execution snapshot. Eight of
  the former 17 marks are removed by the reference compact-zero rule. Reproduce
  with `verify-unfinished-auctions-source.ts --retained`; it uses the previously
  fetched historical candle response because the live rolling OHLC window no
  longer covers that capture. Original evidence is preserved. Updated report:
  `artifacts/unfinished-auctions-source-retained-reference.json`.
- The native Vela simulated fixture shows unrevisited rays, first contacts at
  12:03 / 12:05, outlines with rays off, and zero marks for .001-per-side dust.
  A fresh 414 × 896 view displays both marks. No console errors. Evidence uses
  the `unfinished-auctions-reference-` artifacts prefix.
- Complete gate: **2,387 tests in 223 files**, standalone TypeScript and
  production build passed. Logs use the same artifacts prefix. New deployment
  acceptance is pending because Netlify reports that this team's credit limit
  has paused all projects and deploys (2026-11-06).

Full-capacity, populated multi-chart, recorded browser Replay and complete
source/history equivalence remain open. The older results below describe the
original increment and are not proof of the corrected classifier's behavior.

Reference: https://docs.luxalgo.com/platform/charts/order-flow/footprint, inspected 2026-11-04. Vela documents outer Footprint rows containing both aggressor sides as unfinished auctions, with a minimum volume per side and optional extension until later price revisits. A focused inspection of the public client confirmed default-off marking, default-on extension, independent high/low colors, width 1–10, positive quantities meeting the minimum, and rays at the high row's upper edge and low row's lower edge.

`unfinishedAuctions.ts` evaluates only the outer rows of the **currently displayed merged grid**, independently at high and low. Both quantities must be positive even when the minimum is zero. A single observed price row can produce both high and low marks. A two-sided interior row does not replace a one-sided outer extreme. Collected extrema may differ from complete venue extrema because source coverage is partial.

Each qualifying row gets an outline. Optional rays begin at the profile's right edge and end at the first later revealed candle whose inclusive high/low contains the reference edge; unrevisited levels continue to the plot edge. The origin candle cannot revisit itself, and a gap over the price does not count as contact. The shared indexed touch engine avoids scanning the complete future history separately for every level. The cache includes reference rows, threshold, grid, timeframe, revealed Replay boundary and all observed candle ranges, so in-place history corrections and backward seeks recalculate touch results.

Replay touch detection excludes still-forming candles. These features publish no live trades, closes or alerts. The native Footprint readout reports edge prices and first observed revisits with a partial-coverage explanation. Disabling the setting removes the auction readout and rendering. Existing saved preferences migrate with marking off and extension on; new fields participate in strict preference validation, workspace serialization and native settings binding.

## Verification on 2026-11-04

- Eleven new regression cases in `tests/unfinished-auctions.test.ts`: positive/dust thresholds and exact boundary equality, interior rows, display-grid merging and decimal edges, later-only inclusive touches and price gaps, history/source changes and backward seeks, completed Replay bounds, indexed results against a brute-force oracle, saved-preference migration, inverted/ordinary projection and independent switches, and data-window provenance.
- Complete suite: **2,119 tests in 195 files passed**. Standalone TypeScript and production build passed. Logs: `artifacts/unfinished-auctions-tests.log`, `artifacts/unfinished-auctions-build.log`.
- `scripts/verify-unfinished-auctions-source.ts` independently rebuilt outer $10 rows from 1,000 raw Kraken executions retained at 2026-11-04T18:39:55.268Z. Fresh closed minute OHLC ranges fetched at 18:50 UTC independently establish observed later contact. All **17 auction marks and seven observed revisits** match. Result: `artifacts/unfinished-auctions-source.json`. This verifies partial observed extrema, not complete historical auctions.
- Native Vela simulated fixture: both unrevisited rays, high contact at 12:03 and low contact at 12:05, and rays disabled while row outlines remain. Fixture data updates explicitly restore the visible range so the validation remains on screen. Screenshots: `artifacts/unfinished-auctions-unrevisited.png`, `artifacts/unfinished-auctions-revisited.png`.
- Actual protected production-build app: switched to Footprint, enabled Unfinished auctions and width 2 with extension on; these values survive browser reload. At 414px, the high/low color controls, minimum, width and extension switch are reachable. No captured browser console errors. Screenshots: `artifacts/unfinished-auctions-settings.png`, `artifacts/unfinished-auctions-mobile.png`.

Direct side-by-side Vela rendering/source equivalence, exact cross-fade behavior, full-capacity performance, populated multi-chart and combined browser archive Replay acceptance remain open. The broader Footprint family still lacks other documented features, including the complete independent-instance/mode/filter/stat/overlay set; the overall Orderflow parity goal is not complete.

The rebuilt local production instance was restarted on port 3000 (PID 6580); HTTP 200 and the password gate were verified. Test servers on 3001 and 4321 were stopped after verification.
