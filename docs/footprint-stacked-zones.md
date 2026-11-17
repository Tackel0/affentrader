# Footprint stacked imbalance projections

2026-11-06 follow-up: `footprint-stacked-zones-reference.md` supersedes the old
fixture screenshots and pre-diagonal-correction raw-oracle totals below. It
records 12,000 exact complete reference comparisons, corrected observed guard
executions and renewed native prefix/mean/filter/414px acceptance. Production
stack logic did not need a change in this follow-up.

Stacked imbalance zones now fill the whole price band from the instance lane's right edge until the first later observed candle whose inclusive high/low range overlaps the band. An interior overlap counts even when neither band edge is crossed. Same-bar contact and gaps above/below the band do not terminate it. Unrevisited zones extend to the plot edge. These are observed candle-range contacts, not proof of an individual execution.

Each instance has independent Buy/Sell alpha-capable fill colors and a minimum adjacent row count from 2 to 40. Defaults are rgba(8,153,129,0.28), rgba(242,54,69,0.28), three rows and the existing disabled master switch. The former local half-profile stack rectangles have been removed. Cells render before stack fills, unfinished-auction references and POC references.

Stacks follow displayed diagonal flags: filtering can break a run, and average trade-size sizing can change its side. Canonical gaps break adjacency. Replay admits only completed origin/contact candles. Per-instance caches include all observed candle ranges, source flags, grid, threshold and reveal boundary, so history repairs and backward seeks invalidate contacts. An indexed range-overlap query avoids scanning all later candles for each band. Frozen inspection and CSV preserve each side's projection-known and first observed revisit metadata, with strict source/run and Replay validation.

## Verification on 2026-11-04

- Thirteen regression cases in `tests/footprint-stacked-zones.test.ts`: exact inclusive contacts, gap exclusion, deterministic randomized brute-force comparison, disjoint-range adversary, 40-row threshold, filtered/mean stacks, history repairs, completed Replay/backseeks, normal/inverted/offscreen geometry, settings, capture/readout/CSV and invalid future references. Existing canvas and strict layout/backup tests cover the replaced local geometry and per-instance alpha colors.
- `artifacts/footprint-stacked-zones-source.json`: retained public capture from 18:39:55Z, 64 configurations per venue. Independent raw grouping/filter/means/runs and brute observed-range contacts yield 1,130 zone comparisons and 623 revisits across Binance/Kraken, counted per configuration. The ten Hyperliquid executions produced no qualifying zones and therefore no positive projection evidence. Ranges derive from observed tuples, not complete provider candles. The oracle uses the app's existing zero/missing-opposite contract; exact Vela edge semantics remain open. Indexed lookup alone took about 24.7 ms for 20,000 ranges and queries.
- Explicitly simulated browser fixture: Buy [100,103] stops on a later candle fully inside the band; Sell [105,108] stays unrevisited. Revealing only the earlier prefix removes the future endpoint. Max-volume filtering removes the second stack; mean sizing reverses the first stack. Screenshots: `artifacts/footprint-stacked-zones-comparison.png`, `footprint-stacked-zones-prefix.png`, `footprint-stacked-zones-filtered.png`, `footprint-stacked-zones-average.png`. This prefix fixture is not native recorded Replay acceptance.
- Complete app on isolated loopback port 3001 with ephemeral test authentication: Footprint 2 retained master enabled, row count 40 and Buy fill #12345680 after reload; Footprint 1 retained master disabled and count 3. At 414 x 720 the count was changed to 4 through the visible scrolled native pane. Final console errors were empty. Screenshots: `artifacts/footprint-stacked-zones-settings.png`, `footprint-stacked-zones-mobile.png`. Real access credentials were not read or changed.
- Complete suite: **2,205 tests in 202 files passed** (`artifacts/footprint-stacked-zones-tests.log`), standalone TypeScript and production build passed (`artifacts/footprint-stacked-zones-build.log`).

## Remaining fidelity work

Direct current Vela visual/zoom/default and missing-counterpart comparison, full-capacity/multi-chart rendering, complete source history and native recorded browser Replay remain unproven. The overall Orderflow parity goal remains incomplete.
