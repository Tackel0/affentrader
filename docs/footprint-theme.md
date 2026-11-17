# Footprint text palette and controls

Follow-up against the reviewed hash-pinned reference settings parser on
2026-11-05. New Footprints use the reference text palette by default rather
than an unrelated chart theme text color. Default ink is #d1d4dc on dark and
#2a2e39 on light backgrounds. The explicitly saved `textColorAuto: true` option
continues to follow chart theme text, preserving old workspace choices.

Both that compatibility switch and the custom Text color picker are now in
Values, next to text size/fitting. The custom picker is hidden while the chart
theme override is on, so an available picker no longer appears to change an
ignored setting. All five instances, the independent visible aggregate and both
native studies have independent controls, including disabled saved instances.
Custom non-default colors preserve alpha and imbalance recoloring stays separate.

The reference palette audit also found a previous dark POC default mismatch:
new POCs use #ffffff, adapting to #131722 on light backgrounds. Saved gray POCs
remain gray on dark backgrounds and keep their legacy light adaptation. Outline
and projected POC rays share this resolution. No market quantities, source
classification, aggregation, history or alert callbacks change.

Evidence:

- Five new regressions cover palette defaults, explicit legacy theme behavior,
  custom alpha, native conditional controls, independent disabled/range
  persistence and actual row painting in all five modes with separate imbalance
  recoloring. Existing highlight tests explicitly select their chart-theme ink
  fixture; default-presentation tests now expect reference palette ink.
- `scripts/verify-footprint-theme-reference.ts` evaluates only reviewed literal
  palette declarations and the pure settings parser in an isolated VM. Forty
  comparisons cover dark/light threshold cases, default text/POC colors and
  non-default custom alpha colors. Report: `artifacts/footprint-theme-reference.json`.
- Isolated production app preserves a saved legacy theme override, exposes the
  picker when it is disabled, and retains custom #3344aacc / 80% opacity after
  reload. At 414 × 896 the same picker is reachable by scrolling. No console
  errors. Native evidence/screenshots use the `footprint-theme-` artifacts prefix.
- Full gate: 2,366 tests in 220 files, standalone TypeScript and production build
  passed. Logs use the same artifacts prefix.

Follow-up: new explicit picker selections now use equivalent eight-digit CSS,
including choices equal to old default markers. See `footprint-color-intent.md`;
the reference-parser matrix now includes those cases. Existing legacy marker
intent cannot be inferred retrospectively. Complete controls/default auditing and
whole-renderer equivalence remain open, alongside populated multi-chart,
recorded Replay and capacity gates.
Full Orderflow parity is not established.
