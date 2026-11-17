# Footprint VA / POC structure rendering

Reference: reviewed and hash-pinned official client retained locally, final
structure painter inside `ix`, inspected on 2026-11-05. This follow-up fixes
rendering order and geometry; source aggregation and VA expansion are unchanged.

- Whole-profile background stays first. Histogram cells and values follow.
  Value Area background and boundaries are painted after those cells/values;
  the POC outline follows the Value Area. A nontransparent VA therefore overlays
  row numbers too, as in the reference. Transparent VA fills are skipped because
  they produce no visible pixels.
- VA fill remains available in narrow slots. VA boundary lines and POC outlines
  require a projected slot width of at least ten pixels.
- POC outlines use the histogram row height after its one-pixel gap, then apply
  half-line-width insets. Signed rectangle dimensions for subpixel rows / large
  strokes follow the reference. Canonical upper boundaries and min/abs projection
  preserve decimal grids and inverted-axis behavior rather than adopting the
  reference helper's ordinary-axis-only row geometry.
- Default POC gray adapts to `#131722` on light backgrounds. Projected POC rays
  use the same color resolution. Explicit custom colors and alpha remain intact;
  opacity stays 0.62 × profile reveal. Value Area colors remain independent.

Evidence:

- Five new regressions cover complete draw order, the ten-pixel boundary,
  ordinary/inverted row-gap geometry, shared light/dark outline/ray colors,
  custom alpha and empty/filtered POC handling. Existing canonical/VA tests were
  updated for corrected draw order and the one-pixel POC height.
  Targeted gate: 329 tests in 32 files passed.
- `scripts/verify-footprint-structure-reference.ts` runs only the reviewed pure
  reference structure painter/helpers in an isolated VM. 5,400 operation
  comparisons cover independent dominant-row/whole-range VA bounds, observed
  gaps, five widths around the line gate, five ordinary row heights, three stroke
  widths, three reveal opacities and VA/POC switches. It is not a new proof of VA
  calculation or complete pixels. Canonical/inverted geometry has separate tests.
- Frozen native renderer fixture visibly demonstrates post-cell amber VA fill,
  purple boundaries, default POC in light/dark themes and an eight-pixel fill-only
  lane. No console errors. Screenshots and evidence JSON use the
  `footprint-structure-` prefix in artifacts.
- Full gate: 2,361 tests in 219 files and production build passed. Standalone
  TypeScript result is retained separately with the same artifacts prefix.

Complete cell text-color/default controls, whole-renderer equivalence, populated
multi-chart, recorded browser Replay and full-capacity acceptance remain open.
Full Orderflow parity is not established.
