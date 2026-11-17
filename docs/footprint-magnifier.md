# Footprint Shift magnifier

The magnifier now enlarges the hovered profile and its preceding/following
onscreen profiles from the same instance. Narrow layouts fall back to the
hovered profile when labels cannot fit. Visible-range aggregates omit the time
caption. Loaded candle membership and completed-origin Replay fences remain in
force; the tool does not publish trades, closes or alerts.

The reference layout uses a 44px leader gap, 14px pane margins, row-dependent
vertical enlargement, measured horizontal label fitting, 11–20px numeric text,
price ruler and UTC HH:MM captions. It retains full-profile normalization,
canonical gaps, filters, raw labels, mean geometry, VA/POC and histogram controls.
Each chart layer owns a separate pointer-transparent topmost canvas, cleared on
repaint, modifier invalidation and tool changes, and removed on destruction.

A real shared painter bug was found while comparing tall rows: midpoint culling
dropped cells that still intersected the pane. Culling now tests the full cell
rectangle; the existing pane clip contains partially visible cells.

Evidence:

- Seven magnifier regressions cover neighbor selection, Replay/membership,
  offscreen profiles, range captions, side positioning, narrow fallback,
  immutable input, tall-cell intersection and surface lifecycle. Together with
  hover/overlay regressions, 29 targeted tests pass in three files.
- `scripts/verify-footprint-magnifier-browser.mjs` and
  `tests/browser/footprint-magnifier-reference.ts` compare the production painter
  with only reviewed pure helpers and the complete magnifier painter extracted
  from the retained official source. Source SHA256:
  `b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b`.
  The entire remote app bundle is never executed.
- **2,820 real Canvas RGBA comparisons match exactly**: 1,620 exhaustive base
  cases and 1,200 deterministic extended cases span all five modes, six cell
  values, raw/mean, split/mono, filters, gradients, stroke widths, VA/POC/area
  controls, dense/tall rows, themes, pane sizes and fractional secondary-pane
  offsets. Both painters receive the same profile window; unit tests separately
  verify its selection. Initial failures exposed the tall-cell bug. A later
  fixture correction supplies identical local hit coordinates to both painters;
  no tolerance or case removal was used.
- Native Vela simulated fixture shows three desktop profiles and one at
  414 × 896. The overlay is topmost with `pointer-events: none`; switching to
  normal readout visibly clears it. A real Shift-click produces two modifier
  transitions and returns to released state. Mean/filter controls were exercised.
  Fixed-focus buttons reproduce the held state for screenshots; they are not
  evidence of a captured continuously held physical Shift key. Console errors: 0.
- Artifacts: `footprint-magnifier-pixels.json`,
  `footprint-magnifier-reference-comparison.png`,
  `footprint-magnifier-native.png`, `footprint-magnifier-mobile.png` and
  `footprint-magnifier-browser-evidence.json` under `artifacts/`.
- Complete regression suite: **2,384 tests in 223 files passed**. Standalone
  TypeScript and production build passed. Logs: `footprint-magnifier-tests.log`,
  `footprint-magnifier-typecheck.log` and `footprint-magnifier-build.log`.

Remaining acceptance includes exact shared-edge/overlap hit arbitration,
unknown-count and inverted-axis reference comparisons, populated multi-chart,
touch, full-capacity pointer performance and recorded browser Replay. Pixel
equality in this matrix does not prove full reading-tool or Orderflow parity,
nor equivalent historical market-data coverage.
