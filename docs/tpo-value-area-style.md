# TPO value-area and POC styling

Reference inspected 2026-11-04: https://docs.luxalgo.com/platform/charts/order-flow/tpo

The native TPO chart and independent overlay expose VA fill (default off), its
own CSS color (default rgba(178,181,190,0.08)), and POC line width (1–5, default
2). Existing saved settings without these fields remain valid. Display edits
reuse the candle-derived session model.

The optional band spans the profile's full horizontal session range between
the canonical VAL lower edge and VAH upper edge. It paints behind the cells,
letters and structure. Fill is independent of block visibility and requires
Value area to be enabled. Custom CSS alpha is preserved. Inverted axes use the
same canonical price edges. Compressed profiles keep their compact range/VA/POC
rails instead of adding a large background rectangle.

VAH/VAL lines now use Value area color. They previously incorrectly used Point
of control color, so changing the VA color did not affect the ordinary profile
lines. POC width applies to the ordinary POC, its compact rail cap and its
completed-session extension; the value-area lines keep their separate width.

Seven new rendering/settings regressions cover native/overlay equality,
canonical decimal edges and inverted axes, line colors and width, fill gating,
compact rails, saved preferences, visibility and model-cache reuse. Full test
suite: **2,020 tests across 187 files passed** (`artifacts/tpo-va-style-tests.log`).
Standalone TypeScript and production build also passed
(`artifacts/tpo-va-style-build.log`). An isolated production-browser check on
Kraken BTC/USD 15m confirmed the visible band, separate VA line color and 5px
POC line; VA fill and width both survived reload. Screenshot:
`artifacts/tpo-va-style-native.png`.

This is an incremental TPO styling change. It does not establish complete
default, visual, interaction or source parity with Vela.
