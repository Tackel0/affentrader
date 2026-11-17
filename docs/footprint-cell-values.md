# Footprint cell values and average trade size

Reference: https://docs.luxalgo.com/platform/charts/order-flow/footprint, inspected 2026-11-04. The documented Cell values choices are Auto, Bid × Ask, Total, Delta, Trades and Bid × Ask Trades. Average trade size uses per-side volume divided by trade count for geometry, while numeric volume labels remain raw. A focused public-client inspection also confirmed that POC and diagonal comparisons operate on the plotted average sizes.

## Source and model

`FootprintLevel` now carries optional per-side print counts. Batch `footprints` and incremental `FootprintHistory` share the count accumulator. Counts are accepted only as explicitly supplied positive safe integers. Binance aggregate counts use the inclusive underlying `f`/`l` trade-ID range, while Kraken and Hyperliquid classified executions carry one print each. Receiving one message is never itself evidence of one print.

An unknown, malformed or overflowing count makes the affected row-side count unavailable. Later counted observations cannot repair the unknown portion. The other side remains independent. A side with zero observed volume has zero observed prints. Regridding rebuilds counts from the retained executions, alongside volume; incremental collection still deduplicates IDs and respects its existing source/Replay/capacity fences.

## Display and provenance

Cell values are independent of the existing Bid × Ask/Total/Delta geometry choice. Counts are displayed as integers, and unavailable positive-volume counts appear as a dash. Auto retains the geometry mode's original numeric labels. This increment does not add the separate Ladder or Absolute Delta geometry modes.

Average mode computes per-side means; unknown sides contribute no plotted size. POC and diagonal flags are recalculated from these sizes using the existing diagonal threshold/zero-opposite controls. The bar's raw volume/delta, raw row quantities, counts, and observed unfinished-auction checks remain available. No all-unknown mean-size POC is invented. Default raw-volume behavior and legacy settings remain intact.

The main data window reports explicit side counts and the plotted-size basis. Captured inspection/CSV adds side counts, means, the average flag and cell-value mode while retaining raw volume columns; missing count/mean CSV values are blank. The existing legacy zero/missing-opposite imbalance option remains in effect; direct Vela equivalence of all diagonal edge cases is still an acceptance item.

## Verification on 2026-11-04

- Nine new cases in `tests/footprint-cells.test.ts`: count aggregation and regridding in both paths, underlying counts versus aggregate messages, unknown/invalid/overflow handling, six independent cell modes, mean-size POC/diagonals with unchanged raw values, immutable/toggle/prefix behavior, actual canvas widths/text, saved-preference migration, and captured count/mean CSV provenance. The strict old readout expectation now explicitly expects unknown counts instead of fabricated numbers.
- Complete suite: **2,128 tests across 196 files passed**. Standalone TypeScript and production build passed. Logs: `artifacts/footprint-cells-tests.log`, `artifacts/footprint-cells-build.log`. The final build also includes a shortened settings hint verified to fit the native dialog.
- `scripts/verify-footprint-cells-source.ts`: independent raw-tuple counts, side means, mean-size POC and diagonal oracle on the retained public capture dated 2026-11-04T18:39:55.268Z. Binance: 1,000 aggregate observations / 4,081 underlying prints / six $10 rows; Kraken: 1,000 executions / 53 rows; Hyperliquid: ten executions / two rows. All **61 rows** match. This is retained-source verification, not a fresh capture or proof of complete historical counts. Report: `artifacts/footprint-cells-source.json`.
- Native Vela simulated fixture: raw labels 8/20 and 1/10 remain unchanged while mean shapes become 8/2 and 1/10 and the POC moves from 100 to 101; side-count labels show 1/10 and 1/1. Removing counts produces dash labels, no mean-size bars and no POC. Screenshots: `artifacts/footprint-cells-raw.png`, `footprint-cells-average.png`, `footprint-cells-counts.png`, `footprint-cells-missing.png`.
- Actual protected production-build app: six native choices and the average toggle are available; Bid × Ask Trades with average sizing survives reload. Controls and the shortened hint fit the 414px settings view. No captured browser console errors. Screenshots: `artifacts/footprint-cells-settings.png`, `footprint-cells-mobile.png`.

Complete display modes, independent Footprint instances, VA/filter/stat/overlay/magnifier coverage, direct reference visuals/formulas, full-capacity performance and populated multi-chart/browser archive Replay acceptance remain open. The overall Orderflow parity objective is not complete.

The final local production build was restarted on port 3000 (PID 22712); HTTP 200 and the password gate were verified. Test servers on 3001 and 4321 were stopped after verification.
