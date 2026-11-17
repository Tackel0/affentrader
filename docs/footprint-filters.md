# Footprint volume filters

Each of the five Footprint settings instances now has a **Filters** group with six numeric bounds: Min/Max volume, Min/Max bid volume and Min/Max ask volume. Zero disables a bound. Positive bounds are inclusive and combined with AND. Contradictory positive limits intentionally leave no matching rows instead of swapping or silently changing the inputs. Defaults preserve existing unfiltered charts; strict native capture, saved cells/layouts and workspace backups preserve independent enabled and disabled instance choices.

Reference inspected on 2026-11-04: https://docs.luxalgo.com/platform/charts/order-flow/footprint

## Display semantics

`footprintFilters.ts` applies the bounds to the displayed sizing basis: raw side quantities in normal mode, known volume / underlying trade count per side in average mode. Filters operate on the instance's merged price grid. They mark rows as display-filtered without removing the raw quantity/count fields or moving subsequent rows to a different price slot.

Filtered rows contribute no cell histogram, text, POC outline or diagonal flags. Histogram normalization uses the remaining rows. The local POC and Value Area are recalculated from visible rows, with the existing upper-neighbor tie rule and canonical exclusive upper edges. Hidden rows inside a VA band do not acquire VA membership. Explicitly filtered diagonal counterparts cannot masquerade as zero-volume eligible neighbors; filtered rows break adjacent imbalance stacks. Legacy behavior for genuinely absent diagonal counterparts is unchanged and remains part of the wider direct-Vela comparison work.

The public reference renderer additionally establishes an important distinction: the stat table and projected POC/unfinished references use **unfiltered source rows**. This implementation preserves that behavior. Average sizing still applies to a projected POC when enabled; the display filter does not. Consequently, a local filtered POC can differ from the projected midpoint, and a fully blanked profile can retain an unfiltered reference. The data window and captured inspection explicitly distinguish the local and projected values.

## Inspection and evidence boundaries

The data window exposes visible/filtered row counts, all six bounds and the active sizing basis. Captures retain hidden rows' raw data and label them **Filtered on chart**. An all-filtered capture has a null local POC rather than a fabricated price. CSV preserves visibility and six filter bounds, with separate local and projected POC midpoint fields. Legacy captures keep filter provenance absent. Display filtering does not delete collected executions, alter raw bar statistics or manufacture missing historical executions.

POC reference identity/Replay validation continues to use its unfiltered source midpoint. Historical repairs, grid changes and completed Replay fences retain their existing behavior. The existing unfinished-auction calculation intentionally uses unfiltered outer rows.

## Verification

- Sixteen regressions in `tests/footprint-filters.test.ts`: off/identity behavior, all six exact inclusive boundaries, combined/contradictory limits, preserved slots and raw data, local POC/VA updates, filter removal, average basis, unchanged counts/statistics, filtered diagonals/stacks, unfiltered projected references with Replay fences, all-filtered capture/CSV and null local POC, legacy and independent-instance validation, and normal/inverted canvas text/shape/normalization checks. Existing cell/layout/backup round-trips now include filters on enabled and disabled instances.
- Independent retained-source oracle: `scripts/verify-footprint-filters-source.ts` groups original Binance/Kraken/Hyperliquid tuples and checks nine constraint combinations, three grids and raw/mean sizing: **1,998 row comparisons, 756 local POC/VA comparisons and 756 preserved projection comparisons**. It also checks unchanged raw statistics. Source capture: 2026-11-04T18:39:55Z, 2,010 observed executions. Revisit ranges derive only from observed executions. Evidence: `artifacts/footprint-filters-source.json`; this is not a fresh collection or full venue history.
- `tests/browser/footprint-filters.ts` / `scripts/verify-footprint-filters-browser.mjs`: explicitly simulated paired instances on one candle, with unfiltered FP1 and filtered FP2. The initial 5/5 versus 4/5 rows have different local POCs but the same raw volume 225; disabling filters restores all rows, blanking all FP2 rows removes its local POC, and mean sizing changes eligibility while preserving raw totals. Screenshots: `artifacts/footprint-filters-comparison.png`, `footprint-filters-blank.png`, `footprint-filters-average.png`.
- Full suite: **2,192 tests across 201 files pass**. Standalone TypeScript and production build pass. Logs: `artifacts/footprint-filters-tests.log`, `artifacts/footprint-filters-build.log`.
- The full app was checked on an isolated loopback origin with ephemeral test authentication. Footprint 2 retained all six bounds (0.5/100 total, 0.1/50 bid, 0.2/60 ask) after reload, while Footprint 1 independently retained six zero/off values. Native group navigation, fractional input and 414px controls passed. The visible desktop field grid had equal scroll/client widths (308 px); final app console errors were empty. Screenshots: `artifacts/footprint-filters-settings.png`, `footprint-filters-mobile.png`. The real site credential was not read or changed. Temporary fixture/test servers were stopped; the local production build was refreshed with its password gate intact.

## Remaining fidelity work

Direct current-Vela pixel comparison, complete palette and numeric formatting equality, missing-diagonal edge semantics, zoom cross-fading, projected stacked zones, hover/magnifier, overlays/range variants and populated multi-chart/browser-recorded Replay acceptance remain open. This increment does not establish full Vela Orderflow or historical-data parity.
