# Reference-style Footprint row tooltip

Follow-up on 2026-11-05 against the reviewed, hash-pinned official `iF` popup
painter and `iO` tick-price formatter. This supersedes the earlier normal-hover
layout and forty-pixel hit cap described in `footprint-reading-tools.md`.

Normal hover now highlights the complete observed canonical price band. It also
reads raw observations when their cells are suppressed by display filters, as
the reference's indexed row hit slots do. Gaps without observations remain empty;
loaded candle membership, completed Replay, chart style and active-view opacity
guards remain. Existing topmost-view and half-open boundary arbitration is kept;
exact shared-edge/overlap hit priority is not established as reference-equivalent.

The normal popup measures actual glyphs and places itself beside the profile,
flipping left when needed. It uses the reference light/dark rounded panel,
price-band header, divider, side-colored Bid × Ask, raw total Volume, signed
Delta and Shift hint. Numbers use compact Footprint formatting. Secondary-pane
offsets, including fractional offsets, are applied in local pane coordinates.
The old fixed 330 × 78 rectangle, pointer-based placement and 200px minimum
chart width no longer determine this normal popup.

Tick price precision follows the reference up to eight places, including its
1e-9 integer-comparison tolerance. That reference rule returns zero digits for
ticks at or below that tolerance; this is a display limitation, not changed price
data. Exact raw band values remain available through existing inspection/readout
surfaces. The later magnifier implementation and its scoped reference comparison
are documented in `footprint-magnifier.md`. Complete reading-tool parity remains
unproven.

Evidence:

- Five new tooltip tests plus updated hover regressions cover measured layout,
  compact raw values, theme direction colors, pane offsets, full/tall/dense bands,
  filtered observations and legacy Replay/style exclusions.
- `scripts/verify-footprint-tooltip-reference.ts` executes only the reviewed pure
  reference popup/color/format functions and literal palettes in an isolated VM.
  **62,208** exact drawing-operation comparisons cover light/dark, plot widths,
  slot/row positions, row heights, small/large panes, raw zero/positive/negative/
  large quantities, four tick sizes, hint/highlight switches and integer/fractional
  pane offsets with deterministic glyph metrics. This is not browser pixel or
  shared-edge hit arbitration proof. `artifacts/footprint-tooltip-reference.json`.
- Native Vela fixture shows row 102–103, Bid 2 × Ask 8, Volume 10 and Delta +6.
  A real mouse input hits that row; a Max-volume-5 filter suppresses cells but
  retains the raw observed readout. A fresh 414 × 896 viewport renders the popup
  beside an onscreen row. No console errors. Screenshots and JSON use the
  `footprint-tooltip-` artifacts prefix. Existing hover fixture now chooses an
  onscreen focus bar when a resize moves its original bar offscreen.
- Full gate: 2,377 tests in 222 files, standalone TypeScript and production build
  passed. Logs use the same artifacts prefix.

Remaining: full native reading-tool acceptance, exact boundary/overlap hit
priority, pointer performance at capacity, populated multi-chart, touch and
recorded browser Replay. Full Orderflow parity remains unproven.
