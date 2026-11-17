# TPO block hover

Hovering a visible TPO cell now shows its letter, canonical price interval,
original UTC block start and exclusive end, plus the parent profile's coverage
status. Native settings expose `Block tooltip` (default on); saved older settings
without the field resolve to on. Reference inspected 2026-11-04:
https://docs.luxalgo.com/platform/charts/order-flow/tpo

The chart-type layer repaints on cursor changes. Hover and context menus share
the painter's layout module and one cell hit test. The hit test follows paint
stacking order, row/block gutters, visible letters-only thresholds, off-plot
boundaries and invalid projections. A packed cell's time comes from its original
period index, not the candle beneath its drawn x coordinate. Expanded cells use
chart-time columns. Composite periods resolve through preserved member spans,
including overnight gaps and DST. The last short block clamps at session end.

The tooltip is drawn last, highlights the selected cell, uses the chart theme,
stays within the price pane and disappears when the cursor leaves. Small panes
that cannot hold the box omit it. Existing profile math and cache identities are
unchanged by tooltip visibility. No execution-volume, count or delta metrics are
invented from candles.

## Evidence

- Ten tests in `tests/tpo-hover.test.ts`: packed/expanded and per-session layout,
  actual time windows, horizontal/vertical gutters, hidden/letters-only cells,
  zoomed-out thresholds, inversion/paint order/projection guards, short/overnight
  composite windows, repeated DST hours, Replay prefix isolation, shared menu
  selection, legacy/native toggle persistence, cache reuse and tooltip bounds.
- Full suite: **1,915 tests in 175 files passed**, TypeScript and production
  build. Logs: `artifacts/tpo-hover-tests.log`,
  `artifacts/tpo-hover-typecheck.log`, `artifacts/tpo-hover-build.log`.
- `scripts/verify-tpo-hover-live.ts` independently derives price rows, block
  windows and letters from the retained public Kraken capture in
  `artifacts/tpo-split-live.json` (720 closed hourly bars). Every sampled cell
  center agrees: 1,626 per combination across Day/Week/Month with/without the
  first two sessions merged, **9,756 cell checks** total. The oracle does not
  import app layout or letter helpers. Report: `artifacts/tpo-hover-live.json`.
- Isolated production browser: actual Binance 15m/4h TPO, expanded D block at
  12:00–16:00 UTC and packed B block at 04:00–08:00 UTC while the underlying
  candle column reads 01:15. Context Collapse works through the shared hit test.
  Disabling the tooltip survives reload; re-enabling restores it. At 414px the
  box remains inside the plot and reports a developing session. Cursor departure
  clears it; captured warning/error logs are empty. Screenshots:
  `artifacts/tpo-hover-expanded.png`, `artifacts/tpo-hover-packed.png`,
  `artifacts/tpo-hover-mobile.png`.

## Remaining parity

This implements candle-derived block hover for the current TPO chart type.
Footprint-based metric coloring and its corresponding hover metrics remain
unimplemented. The complete TPO overlay, direct Vela visual/default comparison,
populated multi-chart, recorded browser Replay, real touch interaction and
full-capacity cursor-performance verification remain open. Trading-hour
calendars/presets, themes and the optional volume ladder are separate gaps.
