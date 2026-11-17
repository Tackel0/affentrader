# Footprint statistics rendering follow-up

Compared against the reviewed and hash-pinned official reference's `iP` table
painter and its pure formatting/color helpers on 2026-11-05.

The table now shares the reference compact number format with Footprint cells:
lowercase k units, fixed precision at the same boundaries, signed Delta and
unsigned exact zero. Unknown side percentages do not produce `(—)` suffixes;
the separate Delta % row still shows a dash for a zero denominator. Side
volume/percentage rows are merged at the first enabled item in reference order,
including Sell before percentage-only Buy when Buy volume is disabled.

Buy/Ask-count and positive-Delta values follow the chart theme's up color;
Sell/Bid-count and negative-Delta values follow its down color. Candle and
Footprint histogram palette edits do not recolor this table. Neutral metrics
and labels use the table text color. Actual slot edges control the width gate,
font sizing and integer background box, retaining subpixel boundary behavior.

The existing observed-price anchors, Above/Below placement, proportional
measurement, values-only narrow lanes, reveal opacity and independent saved
instance/range controls remain in effect. Raw volumes and exact readout/CSV
values are unchanged. Unknown underlying trade counts still produce a dash;
the reference's partial-known combined-count fallback is deliberately not used.

Evidence:

- Six focused style regressions plus the existing twelve statistics tests;
  targeted Footprint/Orderflow/series gate: 324 tests in 31 files passed.
- `scripts/verify-footprint-statistics-style-reference.ts` evaluates only the
  reviewed pure table painter/helpers from the pinned reference in an isolated
  VM. 147,456 draw-operation comparisons cover all 1,024 toggle combinations,
  large/fractional/zero quantities, known counts, four widths, three text sizes,
  Above/Below, two reveal opacities, proportional glyph metrics and distinct
  theme-versus-candle palettes. This proves the compared operations, not full
  browser pixel equivalence or unknown-count fallback parity.
- Frozen native Vela fixture shows positive, negative and zero cases in wide
  labeled tables and narrow values-only lanes. Theme green/red text stays
  separate from purple/orange candles. No console errors. Reports/screenshots
  use the `footprint-statistics-style-` prefix in artifacts.
- Full gate: 2,356 tests in 218 files, standalone TypeScript and production build
  passed. Logs use the same artifacts prefix.

Full Orderflow parity, exact complete theme/control audit, populated multi-chart,
recorded browser Replay and capacity acceptance remain open.
