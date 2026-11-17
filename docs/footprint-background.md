# Independent Footprint area background

The separate Area background control fills the entire observed price-row span,
including gaps and filtered observations, before row histograms and the independent
Value Area layer. It defaults off. The default tint is rgba(178,181,190,0.06) on
dark themes and rgba(19,23,34,0.06) on light themes; custom colors retain alpha.
It shares the actual profile slot and reveal opacity and uses projected min/abs
geometry for ordinary, inverted and logarithmic axes. Canonical row upper bounds
are preserved rather than recomputed with a potentially drifting decimal sum.

All five Footprint instances, the independent Visible Range aggregate and both
native overlay studies expose and retain their own switch/color. Disabled saved
instances retain settings. Old Value Area preferences do not enable this new fill.
It changes no source quantities, filters, history or alarm callbacks.

Evidence, 2026-11-05:

- Eight focused regressions; targeted gate 318 tests in 30 files passed.
- `scripts/verify-footprint-background-reference.ts` hash-checks the retained
  official reference client and executes only its reviewed area painter in an
  isolated VM. 9,720 comparisons cover five modes, gaps/hidden observations,
  slot widths/offsets, positive reveal opacities, on/off state and three axis
  projections. Integer tick boundaries avoid conflating this comparison with
  decimal precision, which has its own regression. Report:
  `artifacts/footprint-background-reference.json`.
- Frozen native Vela fixture separately renders area-only, VA-only and both with
  an internal gap and a filtered upper row. The blue area spans 100–105 while the
  orange VA spans 100–101. No browser console errors. Screenshot:
  `artifacts/footprint-background-comparison.png`; browser evidence JSON alongside.
- The static native Footprint input-key union now has all 70 reference keys
  represented (including reviewed aliases). This is not proof of conditional
  visibility, default, dynamic statistic-field or whole-renderer equivalence.
- The isolated production app retains an enabled background and custom
  `#2255aa66` (40% alpha) after reload. At 414 × 896 the control is reachable by
  scrolling and was toggled off/on. No console errors. Native evidence JSON
  and mobile screenshot use the `footprint-background-` prefix in artifacts.
- Full gate: 2,350 tests in 217 files, standalone TypeScript and production build
  passed. Logs use the `footprint-background-` prefix in artifacts.

Full Orderflow parity, whole-renderer pixel equivalence, complete theme/candle/
text-color relationships, statistics visual audit, populated multi-chart,
recorded browser Replay and capacity acceptance remain open.
