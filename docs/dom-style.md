# DOM colors and reference zoom

Reference is the public Order book module documented in `dom-large-orders.md`:
`https://vela.luxalgo.com/_next/static/chunks/0kh_muujoeolo.js`, SHA256
`42f2ea4bd3efd7d848ef453f8648616c6fd3469feeaddc70f9ed51c763278c6a`.

Style exposes 70–150% zoom in ten-point steps, minus/plus/reset controls and
independent Bid/buy and Ask/sell hex colors with Reset colors. Values are saved
with the validated workspace view preferences. Older saved views without these
fields retain their existing controls and receive 100%/default colors. Hex values
must have exactly six digits; incomplete drafts keep the previously applied color.

The zoom affects measured DOM values, not a CSS transform of the whole panel:
row `round(20×zoom/100)`, header `round(26×zoom/100)`, order-chip
`round(16×zoom/100)`; ordinary/header/chip text use independent hundredth-pixel
rounding of 12/11/10.5px respectively. At 70% rows/header are 14/18px and text
8.4/7.7px. At 150% they are 30/39px and 18/16.5px. Controls stay at normal size.

The viewport now admits even row counts. Like the reviewed source it derives
count from available body height divided by current row height (minimum five);
the local 101-row allocation bound remains. Rows extend above center by
`floor(count/2)`, so an even count does not move the reference down a whole extra
price step. Auto's edge margin follows that center offset. Real wheel events
move three price-grid indices per direction rather than scaling by pixel delta.
Existing Ctrl/Shift/horizontal pass-through and additional keyboard actions
remain local interaction policies, not fully compared reference behavior.

Custom colors apply to waiting-depth bars/outlines, signed execution/P&L values
and working-order side labels. Normal/large/outline alpha stays 14/30/60%, with
normal/semibold quantities. Defaults and reset retain the app's green/red side
palette. No chart setting, volume, source or order field is modified by styling.

Three focused tests cover metrics, current viewport/count behavior, even rows,
palette/alpha validation, and preserving earlier views. The pinned reference
verifier executes the actual reviewed arithmetic: all 54 row/header/text/chip
comparisons and 54 viewport-count cases match. Actual-component browser checks
verify 70% and 150% geometry, 29 versus 12 rows in the 426px fixture, independent
colors on bars/60% ring and signed values, style persistence on reload, real
three-step wheel input, plus/minus and Reset. Final console warnings/errors are
empty. These are controlled public-fixture inputs, not a hosted account test.

Evidence: `artifacts/dom-style-reference.json`, `dom-style-browser-checks.json`,
`dom-style-browser-errors.json`, `dom-style-custom.png` and
`dom-style-{targeted,tests,typecheck,build}.log`.
Full gate: 2,440 tests in 235 files, standalone TypeScript and production build
passed. New source/tests/verifier/docs are in the upload ZIP; captured reference
bundles and evidence artifacts are excluded.

Open: shared styling of the separate Book/Trades UI, exact theme/default palette
equivalence, complete glyph/pixel and responsive/touch comparison, above-capacity
viewports, full follow/scroll arbitration and live/hosted acceptance. This closes
only the scoped DOM style/metric gap, not complete Vela Order book parity.
