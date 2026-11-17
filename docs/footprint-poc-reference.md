# Footprint POC projection reference comparison

The native reference enables POC projections only when at least two candles are
loaded. The production painter now applies that same gate. An observed single
candle still has its POC model, outline and readout; only the projection is
withheld. Normal projections retain unfiltered source-volume/known-mean POC
selection, row-midpoint placement, first later inclusive OHLC contact, independent
width/color and .62 × footprint-opacity alpha. Same-origin contact, gaps and
forming Replay candles do not invent a later revisit.

## Evidence on 2026-11-06

- One new regression verifies empty/single-candle paint suppression, unchanged
  observed model and activation at two loaded candles. Existing geometry/theme
  mocks now explicitly supply their loaded candles. The targeted value-area,
  structure and overlay suites pass **33 tests in three files**.
- `scripts/verify-footprint-poc-reference.ts` extracts only the reviewed pure
  selector, later-touch helper and entire POC projection branch from retained
  official source SHA256
  `b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b`.
  **60 POC selections, 180 revisit comparisons and 34,560 drawing-operation
  comparisons match exactly**. Before the one-candle gate correction, 2,592
  drawing cases differed. The reference's outer two-candle gate is included;
  actual slot geometry is supplied identically rather than claiming a packing
  comparison.
- The matrix covers canonical merged integer grids, gaps, POC ties, zero outer
  rows with positive total, explicit counts, raw/mean, filtered observations,
  one/two/three loaded candles, thin/wide/offscreen slots, inclusive pane edges,
  line widths, fractional pane offsets, opacity and the extension switch. Custom
  alpha color keeps this independent of the earlier settings-parser/theme proof.
- Re-running `verify-footprint-value-area-source.ts` against the retained public
  three-venue capture again passed **560 VA and 140 POC reference comparisons**,
  including 59 observed revisits. The 20,000-reference model/index check took
  approximately 54 ms here; this is not a browser-capacity performance result.
- The explicit native Vela completed-prefix fixture shows two unrevisited rays
  at two candles. At four candles the first ray ends on the 12:02 candle, while
  the second stays open. Returning to two candles removes that later contact.
  A fresh 414 × 896 view keeps the first ray's endpoint at the third candle.
  Console errors: zero. The one-candle fixture reports suppression, but its SDK
  viewport puts/zooms the lone profile at the edge: the drawing oracle and unit
  regression, rather than that screenshot alone, establish the paint gate.
  Artifacts use `footprint-poc-reference-` under `artifacts/`.
- Full gate: **2,388 tests in 223 files**, standalone TypeScript and production
  build passed. Logs use the same artifacts prefix. Netlify's live site and
  project overview still report a team credit-limit pause, so this increment
  remains packaged locally pending publication and production acceptance.

## Remaining acceptance

Missing-count/all-zero mean fallback in the reference is not treated as proven
equivalent: the current app keeps unavailable mean POCs unavailable instead of
selecting an arbitrary zero-weight row. Decimal binary artifacts, malformed or
unmerged input grids and native slot packing are outside this oracle. Canonical
decimal and inverted-axis safeguards have separate regression coverage, not a
direct reference equality claim here. Full-app pixels, exact cross-fade, populated
multi-chart, full browser capacity and recorded archive Replay remain open.
Complete source/history equivalence and full Orderflow parity are not established.
