# Footprint text planning and fitting

Reference: the reviewed, hash-pinned official client retained at
`artifacts/vela-footprint-reference/1-1mg-s23l974.js`. The native control descriptors
are in `artifacts/footprint-display-reference-controls.json`.

Implemented on 2026-11-05:

- Auto text size defaults on. Manual size defaults to 11px and supports 6–40px;
  Shrink numbers to fit defaults off. All five instances, the independent visible
  aggregate and both native overlays retain independent controls, including
  disabled saved slots. Manual size appears when Auto is off. Existing theme/
  custom text-color preferences remain available.
- Auto/no-fit plans a uniform size for each instance across its drawable bars,
  using actual canvas glyph measurements and the chart font family. It starts at
  at most 12px and reduces to fit all visible, unfiltered row values. If the result
  falls below 7px, numbers are suppressed. Offscreen bars do not control the plan.
- Row labels require at least 14px row height after the one-pixel gap, a 22px slot
  and opacity at least 0.6. Fixed sizes that cannot fit are hidden. No Canvas
  maxWidth argument is used to horizontally distort glyphs.
- Fitting shrinks individual labels down to 5px against actual histogram shape
  widths; Ladder uses its fixed columns. Delta values align left/right from the
  zero axis by plotted sign, while their numbers retain raw volume delta. Other
  scalar values align left. Bid/Ask values remain right/left around the axis.
- Shift magnification keeps its explicit 14px text override, original volume
  normalization and the reference's expanded fallback area for fitted numbers.
- Row volume/count labels use compact reference formatting: thousands use `k`,
  nonintegers below 100 have the reference's fixed precision, and delta keeps its
  sign. Very small finite values can round to `0.0` at that display precision.
  Exact raw quantities/counts in readouts and CSV are not replaced by these labels.
  Actual zero sides are blank. Unknown count coverage remains `—`, never a fake
  zero; this source guard deliberately survives older reference count fallbacks.
- A wholly balanced Delta histogram with zero maximum has no numeric row layer;
  the POC/VA references remain separate. Filters, source fields and alarm callbacks
  are not changed by font preferences or formatting.

Verification:

- Ten focused regressions cover compact/finite formatting, common Auto sizes,
  filtered and offscreen outliers, manual hiding versus five-pixel fitting,
  opacity/row/width/plan gates, raw-versus-mean Delta positioning, scalar alignment,
  zero-side suppression, unknown-count dashes, magnifier override, strict disabled/
  range persistence, runtime clamping and native conditional controls.
  Focused gate: 310 tests in 29 files passed.
- `scripts/verify-footprint-text-reference.ts` evaluates only reviewed pure text
  helpers/planner/painters from the pinned source in an isolated VM, never its
  whole application bundle. **69,120** planner-and-drawing comparisons cover five
  modes, six value choices, Auto/manual, fitting, four sizes, four widths, six
  critical row heights, three opacities and raw/mean shapes; 18 formatter boundary
  comparisons also pass. Glyph metrics are deterministic/proportional. This
  establishes the compared ordinary-axis rules on known counts, not complete
  browser pixels, unknown-count reference behavior or inverted-reference parity.
  Report: `artifacts/footprint-text-reference.json`.
- Frozen native renderer comparison shows Auto, fixed 24px hiding wide values and
  per-row fitting without new trades. Screenshots:
  `artifacts/footprint-text-auto.png`, `footprint-text-manual.png`,
  `footprint-text-fit.png`; browser evidence JSON alongside. No console errors.
- Isolated production app with live Binance data retains Auto off / 18px / fitting
  on after reload. At 414px, size was edited to 20 and restored to 18 through the
  native Values group. No console errors. Evidence:
  `artifacts/footprint-text-native-evidence.json` and native settings/mobile PNGs.
  No real access credential was read or changed.
- **2,342 tests in 216 files passed**, standalone TypeScript and production build
  passed. Test/build logs use the `footprint-text-` prefix.

Remaining: complete control/default audit (including area/background and native
theme/candle/text-color relationships), whole-renderer pixel comparisons, stat
table/reference visual formatting, populated multi-chart, recorded browser Replay
and full-capacity acceptance. Full Footprint/Orderflow parity is not established.
