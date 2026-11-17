# Combined Footprint profile painter pixel comparison

The reviewed complete per-profile `ix` painter from the pinned official reference
client is compared against the app's actual `paintFootprintBar` using two real
Canvas 2D surfaces in the same browser. Only reviewed pure paint/text/color helpers
and the reference row preparation function are evaluated, never its application
bundle. The retained source hash is checked before the fixture starts.

This broader comparison found a missing center/zero axis in Bid × Ask Profile
and Delta Profile: 864 of 2,520 original cases differed. The app now draws the
one-pixel chart-theme-text-color axis at 50% × profile reveal opacity, after the
whole-profile background and before cells. It spans all observed rows, including
interior gaps and a filtered boundary. Like the reference, it requires a ten-pixel
slot and a positive mode maximum. Ladder, Volume and Absolute Delta have no such
axis. The app's extra histogram-off control also hides it. Canonical upper bounds
and inverted-axis safety are preserved.

Evidence, 2026-11-05:

- Four regressions cover mode selection, theme ink independent of custom row
  text, reveal alpha, projected span, inverted axes, draw order, width boundary,
  absent rows and balanced Delta. Targeted gate: 343 tests in 35 files passed.
- Before correction, 1,656/2,520 complete-painter cases matched; 864 differed.
  After correction all 2,520 match exactly at RGBA pixel level. The exhaustive
  base matrix covers five modes, seven widths, six ordinary row heights, three
  opacities, two themes and highlights/recolor on/off using default values/Auto.
- An additional 2,000 deterministic seeded cases exercise all six cell-value
  choices, raw/mean geometry, min/max filters, actual independent reference row
  preparation, VA percentages, independent VA/POC/background/highlight/recolor,
  split/mono Volume, gradient on/off, Auto/manual sizes, fitting, stroke widths,
  row heights, slot widths, reveal opacities, themes and explicit custom colors.
  All match: **4,520/4,520**, zero differing pixels. This sampled extension is not
  the exhaustive Cartesian product of those options.
- No browser console errors. Reports: `artifacts/footprint-renderer-baseline.json`
  and `footprint-renderer-pixels.json`; browser screenshot alongside.
- Reproduce locally with `node scripts/verify-footprint-renderer-browser.mjs`,
  then open http://127.0.0.1:4321 and select Run matrix. The local retained
  reference capture is required for the verifier, not for product builds.
- Full gate: 2,372 tests in 221 files, standalone TypeScript and production build
  passed. Logs use the `footprint-renderer-` artifacts prefix.

Scope boundaries: these are ordinary-axis, known-count profile-layer comparisons
in the inspection browser, not cross-device rasterization proof. Side candles,
statistics, extensions, hover/magnifier, unknown-count fallback, populated
multi-chart, recorded browser Replay, capacity and complete data-source/history
equivalence are outside this comparison. Existing separate checks do not turn
this into proof of full Orderflow parity. Those acceptance gates remain open.
