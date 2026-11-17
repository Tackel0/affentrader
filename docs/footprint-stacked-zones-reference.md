# Stacked Footprint zones: direct reference verification

The production stack formulas, indexed later-contact lookup and zone painter
already match the reviewed reference in this matrix; no production stack change
was necessary for this increment. The work adds end-to-end reference evidence
and repairs a stale native browser fixture that no longer established its
advertised stacks after the earlier missing-diagonal correction.

## Direct comparison on 2026-11-06

`scripts/verify-footprint-stacked-zones-reference.ts` executes only the reviewed
raw/mean/filter/diagonal preparation, run extraction, inclusive later-overlap
helper and entire stacked-zone painting branch from the retained official source.
SHA256: `b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b`.
It compares those with production raw classification, display preparation, stack
cache, indexed contact lookup and canvas operations in **12,000 reproducible
complete cases**, seeded with `0x51ac7ed`. Zone and drawing differences: **zero**.

This includes 2,930 cases with actual zones and 1,362 with visible drawing;
1,023 positive cases exercise boundary contact and 947 exercise interior contact.
The matrix spans counts sufficient for 2/3/4/10/40-row thresholds, raw and explicit
count-based means, ratios 1/3/10, four filter variants plus no filter, observed
zero opposite sides, contiguous rows and gaps, no/later boundary/interior touch,
thin/wide/offscreen lanes, normal/inverted axes, vertical clipping, three
opacities, independent alpha fill colors and fractional pane offsets.

The first verifier draft omitted production's already-classified row flags and
canonical row indices when no display transform was active. Its differences
were a fixture preparation error, corrected by invoking the real raw finishing
pass with the same row metadata as history. They do not demonstrate a production
bug or a production fix. No tolerance or comparison-case removal was introduced.

## Native fixture correction

The old three-row-per-bar fixture now produced **zero zones** because a diagonal
at an outer row needs an actual observed counterpart. Its old screenshot claims
are superseded. Two explicit simulated executions now provide those counterparts:
Sell 1 at 99 for the first bar and Buy 1 at 108 for the second. Candle volume totals
are updated to include these observations. There are no invented missing rows.

Rechecked in the native Vela renderer:

- Raw Buy [100,103] ends at the 12:03 interior candle; Sell [105,108] stays open.
- A two-candle completed prefix leaves both zones open; restoring four candles
  re-establishes the first contact.
- Mean sizing moves the first run to Sell [99,102], ending at 12:03.
- Max volume 12 removes the second raw run and preserves the first.
- A fresh 414 × 896 viewport displays both zones; console errors are zero.

The independent retained three-venue raw-tuple oracle was also rerun. Its current
missing-counterpart contract produces **703 zones and 357 observed revisits**
(93/24 Binance, 610/333 Kraken, no positive Hyperliquid zones in that small tape),
superseding the older pre-correction 1,130/623 counts. The 20,000-query contact
index check took approximately 28.5 ms here; that is model timing, not browser
capacity. Thirty-five targeted stack/diagonal/overlay regressions pass.
Standalone TypeScript passes with the new verifier and corrected browser fixture.
Production modules are unchanged in this increment; the preceding full gate of
2,388 tests in 223 files and successful production build therefore remains the
last full production gate, rather than being presented as a newly repeated run.

Evidence uses `footprint-stacked-zones-reference-` artifacts. The reference and
raw-tuple JSON reports retain exact counts and scope. Browser images and JSON
label the data SIMULATED rather than implying an exchange-history screenshot.

## Remaining gates

Both painters receive the same lane geometry. Native slot packing, decimal
binary artifacts, missing-count source fallback, full-app pixels, exact zoom
cross-fade, populated multi-chart, browser capacity and recorded archive Replay
are not established by this comparison. It uses observed raw input and supplied
OHLC ranges; it does not establish complete historical market-data coverage.
Full Orderflow parity remains incomplete. Netlify publication is pending while
the team credit limit pauses the existing project and deploys.
