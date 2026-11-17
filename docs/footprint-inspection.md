# Painted Footprint price-row inspection

The Object tree sidebar's **Data window** now provides **Inspect footprint rows…** for a matching painted Footprint candle. The summary exposes the actual row size, diagonal ratio, minimum dominant-side volume, missing/zero opposite policy, buy/sell imbalance-row counts and contiguous buy/sell stack counts.

The detail dialog captures a frozen copy of the selected candle's painted rows. It shows Bid (aggressor sells), Ask (aggressor buys), total, delta, POC, independent buy/sell diagonal imbalances and stack membership. Buy imbalance compares Ask against Bid one row below; sell imbalance compares Bid against Ask one row above. Missing price rows break stacks. Capturing uses the current painted revision for the same source/candle; it does not preserve an earlier tick revision seen before the button was clicked. **Capture current candle** explicitly refreshes the snapshot.

Filters select all rows, buy/sell imbalances, stacks or POC, plus a minimum row volume. Price ordering is reversible and all matching rows are reachable in pages of 50. Filtering never recalculates the conditions. CSV and JSON always export every captured row with source and calculation metadata, independently of the visible filter/page. The snapshot copies only the supported public fields and is capped at 100,000 rows. Volumes retain the chart engine's JavaScript Number model; exports do not claim exact original venue decimal quantities.

Capture is fenced by chart cell, symbol, interval, feed epoch, source/archive stamp, selected candle and exclusive completed-Replay boundary. Switching source or removing the study archive cannot capture an obsolete target. An already captured snapshot remains frozen while the component is mounted; closing/unmounting the Data window, including the automatic sidebar close at a narrow breakpoint, closes it. It is not a persisted saved report.

## Calculation correction

Legacy rows now use the canonical decimal price grid rather than rounded binary division for stack adjacency and upper bounds. A price strictly below a boundary cannot be rounded into the next row. Unsupported legacy coordinates, malformed row bounds and unsafe explicit indices break a stack rather than throwing or connecting across the invalid row. The actual native rows continue to use their exact published row indices/bounds.

## Verified evidence

- **1,676 tests in 147 files passed**, including 32 focused Footprint/readout/Data-window checks. Production build and TypeScript passed. Tests include frozen copies, pagination/export completeness, strict decimal boundaries, invalid coordinate gaps, both imbalance directions and source/Replay fences.
- Actual live HL:BTC 5m capture at 17:31:23 UTC on November 2 contained **53 price rows**, volume **48.84199**, delta approximately **−12.59069** and **four stacks**. Both pages were reachable. The POC filter showed one row while both downloaded exports retained all 53 rows. A separate integer decimal oracle checked all CSV fields, volume/delta sums, diagonal comparisons and independently reconstructed stacks. The capture metadata remained unchanged while live ticks continued.
- Actual recorded Replay of the November 1 **12:40 UTC** candle captured **28 rows**, volume approximately **4.11733**, delta **0.84259**, and **two buy stacks**. The independent archive check selected **186 executions** from the 993-observation archive before **12:45 UTC**, matched every Bid/Ask row, and excluded ten later archived executions. Refreshing the paused Replay capture preserved its quantities and cutoff. Removing the archive removed the inspection action and showed the recorded-source waiting message.
- Visual inspection caught and corrected a real zero-height table caused by the common form flex layout. The inspector now scrolls as a document. At **414×720**, the page remains 414px wide, while the 720px table scrolls horizontally in a 345px container; the 1,020px historical table remains vertically reachable in the dialog's 540px body. Final desktop and mobile images show the actual table. Browser warnings/errors were empty. Live 5m mode, automatic row sizing and the watchlist sidebar were restored; recording remains paused and the temporary archive study selection was removed.

Evidence: `artifacts/footprint-inspection-tests.log`, `footprint-inspection-build.log`, `footprint-inspection-export-check.json`, `footprint-inspection-replay-export-check.json`, `footprint-inspection-desktop.png`, `footprint-inspection-mobile.png`, and `footprint-inspection-replay.png`.

Reproduce the independent export check with:

```powershell
node scripts/verify-footprint-inspection-export.mjs snapshot.json snapshot.csv report.json
```

For a fixed-duration recorded candle, optionally append an exported trade-archive JSON path to independently reconstruct every selected Bid/Ask row. This verifier does not import the application calculation pipeline.

## Remaining scope

This inspects observations already available to the engine. It does not supply a complete exchange tape, historical depth or original-arrival intrabar Replay. It does not create new alerts or order actions. Broader TradingView/Vela parity, complete history and authenticated/licensed equity coverage remain open.
