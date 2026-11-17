# Explicit colors and legacy adaptive defaults

The native picker now retains explicit opaque selections as equivalent
eight-digit CSS colors (`#rrggbbff`). Existing six-digit saved defaults keep
their historical theme adaptation. This encodes explicit selection without
adding per-color flags, settings switches or backup fields. The same value
works in chart instances, native studies and ordinary CSS/canvas painting.

The pinned Vela 0.9 picker adapter wraps its actual emit function in all six
distributions. This applies to native picker writes generally; untouched stored
values are not rewritten. Partially transparent selections already have an alpha
suffix and remain unchanged. Applying a valid identical hex value also commits
once, so users can intentionally choose the current default itself. A second
blur does not repeat that commit because the draft is no longer dirty.

This fixes explicit default-marker collisions for Footprint text, POC, VA,
statistics and mono palette colors: choosing white POC remains white even on a
light background; choosing the dark text default can remain that shade instead
of being replaced by the light palette. Existing legacy markers still adapt.
Past selections with identical stored marker strings cannot retrospectively be
distinguished from automatic defaults; reselecting a color makes intent explicit.

Evidence, 2026-11-05:

- Picker regression covers opaque equivalent CSS, alpha preservation and
  idempotence. Footprint regression covers strict disabled-instance/visible-range
  storage, theme changes and both native study input handoffs. Targeted gate:
  339 tests in 34 files passed.
- The reference-parser verifier now covers all opaque marker collisions, not
  just non-default custom colors: 80 comparisons across dark/light thresholds,
  defaults, explicit marker selections and alpha. CSS representations are
  compared as RGBA values. `artifacts/footprint-theme-reference.json`.
- Frozen native fixture applies an unchanged #d1d4dc through the real hex editor
  and white through the real palette, and exposes stored/rendered colors in its
  status output. Both retain literal shades across light/dark switches. No console
  errors. Screenshots/evidence: `artifacts/footprint-color-intent-*.png` and JSON.
- Full gate: 2,368 tests in 220 files and production build passed. Standalone
  TypeScript result is logged separately with the same artifacts prefix.

Full Orderflow parity, complete settings/conditional/default audit,
whole-renderer pixels, populated multi-chart, recorded Replay and capacity
acceptance remain open.
