# Footprint Value Area and POC extensions

2026-11-06 follow-up: `footprint-poc-reference.md` records direct POC selector,
touch and projection-branch comparisons and the corrected two-loaded-candle
paint gate. Later `footprint-structure.md` supersedes the original POC box/VA
layer geometry described here. The older gates below record their own increment.

The Footprint chart type now has independent Value Area and POC controls in each of its five native settings instances. Value Area is enabled by default at 70%, with separate boundary color, transparent-by-default fill and 1–10 px line width. POC has its own 1–10 px width and an optional **Extend POC until broken** switch. Existing layouts and backups remain valid; the new values use the existing strict per-instance persistence path.

Reference inspected on 2026-11-04: https://docs.luxalgo.com/platform/charts/order-flow/footprint

## Calculation and rendering

`footprintValueArea.ts` operates on the instance's displayed price rows. POC is the first maximum combined side size in ascending price order. Starting there, the band expands toward the larger adjacent observed row until the selected share is covered. Equal neighboring quantities choose the higher price. Gaps between observed rows carry no invented volume; the resulting price band can span them. Boundaries use canonical lower and exclusive upper row edges. At 100%, unnecessary zero-size outer rows are not added once the positive total is covered.

Normal profiles use classified buy + sell volume. Average-trade-size profiles use each known side's volume / explicit underlying trade count. Unknown counts do not become guessed sizes. Raw numeric cell labels and recorded volume remain unchanged. The percentage is scaled before multiplication to keep large finite quantities supported.

The boundary rules, 70% default, enabled-by-default outline, transparent default background, widths and midpoint projection were additionally checked against Vela's public application configuration/calculation behavior. This does not establish pixel-for-pixel equality of the whole Footprint renderer.

VA background and horizontal boundary lines occupy the instance's assigned lane and work with normal or inverted price axes. The existing POC box now uses the complete row height with an inset appropriate to its configured stroke width. Default VA boundary color adapts to light and dark chart backgrounds; explicit custom colors and alpha fills are preserved.

## Projected POC references

`footprintPoc.ts` computes the POC row midpoint and projects from the instance lane's right edge to the first later observed candle whose inclusive high/low range contains the midpoint, or to the plot edge when unrevisited. Same-bar contact does not terminate a projection, and a gap over the midpoint is not a touch. This is an observed OHLC-range revisit, not proof of a particular tick execution. Missing history remains unknown.

The shared indexed reference-touch lookup avoids scanning every later candle for every POC. The cache includes canonical grid, average/raw basis, source rows, all historical candle ranges and the Replay boundary. Historical repairs and backwards seeks therefore invalidate previous results. Replay includes only completed origin and touch candles. Each instance has its own cache and geometry. POC visibility gates its extensions; disabling extension leaves the row outline available.

The data window reports VA bounds, sizing basis, POC midpoint and first observed revisit. Frozen row captures show Value Area conditions and preserve the relevant settings, band and observed POC reference. CSV adds percentage, visibility, bounds, row membership, extension and revisit metadata. Legacy captures keep unavailable VA metadata absent. Capture validation rejects a mismatched POC or a revisit outside the completed Replay boundary.

## Verification

- Fifteen regression cases in `tests/footprint-value-area.test.ts`: expansion direction/ties, POC ties, 1%/100%, gaps and zero rows, average/unknown counts, canonical decimals and huge values, legacy and per-instance preference validation, inclusive midpoint revisits, repaired history/regrids/Replay, exact normal/inverted geometry, widths/fill, projection visibility, frozen readout/capture/CSV and invalid/future capture references. Existing POC canvas expectations were updated to the reference's inset stroke geometry.
- Independent source oracle: `scripts/verify-footprint-value-area-source.ts`, using the retained 2026-11-04T18:39:55Z public source capture. Five price grids, four percentages and raw/average bases yield **560 VA comparisons and 140 midpoint-reference comparisons**, including 59 observed revisits across Binance, Kraken and Hyperliquid. Revisit comparison uses execution-derived observed minute ranges, not complete exchange candles. Evidence: `artifacts/footprint-value-area-source.json`.
- Synthetic model timing: 20,000 POC references across 20,000 candles in approximately 49 ms on this machine. This measures model/index work, not full browser rendering.
- `tests/browser/footprint-value-area.ts` and `scripts/verify-footprint-value-area-browser.mjs` provide an explicitly simulated completed-prefix fixture. The first ray stops at 12:02 only after that candle is revealed; the 12:01 POC stays unrevisited. Changing VA from 70% to 80% expands the first band from [102,104) to [101,104) without changing the POC. Screenshots: `artifacts/footprint-value-area-comparison.png`, `footprint-value-area-prefix.png`.
- The complete app was checked on an isolated loopback origin with ephemeral test authentication. Footprint 2 retained VA 80%, VA width 2, POC width 3 and extension enabled after reload; Footprint 1 independently retained 70%, width 1 and extension disabled. Native group navigation and 414px controls passed; final app console errors were empty. Screenshots: `artifacts/footprint-value-area-settings.png`, `footprint-value-area-mobile.png`. No real site credential was read or changed.
- Full suite: **2,164 tests across 199 files pass**. Standalone TypeScript and final production build pass. Logs: `artifacts/footprint-value-area-tests.log`, `artifacts/footprint-value-area-build.log`. Temporary fixture/test servers were stopped after browser acceptance.

## Remaining fidelity work

Exact Vela visual comparison across modes/themes/zoom, mode-specific palettes, cross-fading, projected stacked zones, all ten statistics, filters, hover/magnifier, overlays and the edge-pinned range variant remain open, along with full-capacity browser, populated multi-chart and recorded browser Replay acceptance. This increment does not establish equivalent historical execution coverage or free consolidated equity data.
