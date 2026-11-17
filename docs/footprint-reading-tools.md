# Footprint row hover and Shift magnifier

2026-11-05 follow-up: normal hover now uses full observed row bands (including
display-filtered observations) and the measured reference-style popup. The older
normal-hover geometry/filter assumptions and screenshots below are superseded by
`footprint-tooltip.md`. The older fixed five-row magnifier described below is
superseded by `footprint-magnifier.md`, including 2,820 exact browser pixel
comparisons of neighboring-profile layout and separate surface lifecycle checks.
The text below records the original increment rather than current geometry.

The official reading tools describe a row-level price/Bid/Ask/Total/Delta readout and a Shift-hover magnifier: https://docs.luxalgo.com/platform/charts/order-flow/footprint (inspected 2026-11-04).

The native chart-type layer now repaints on cursor motion. Hit testing follows each instance's actual lane, canonical row edges, displayed filters and loaded candle membership; the hovered instance is independent from the data-window selection. Normal hover follows painted row slots, including dense histograms whose numeric labels are suppressed. Holding Shift also permits dense/narrow cells and paints an enlarged neighboring-row panel, using the same profile painter, mode, cell values, mean/raw sizing, imbalance styles and POC. The panel uses 14px numeric text, 28px rows, original full-profile normalization and at most two canonical row slots on either side. Missing price rows stay blank, filtered rows stay hidden and unknown underlying counts remain unknown. Raw numeric labels and raw row totals do not become means.

Only completed origin candles can be hit in Replay. Hover is recomputed from the current frame rather than retaining old source/settings targets. Modifier state belongs to the hovered chart host: key transitions repaint a stationary pointer, repeated Shift does not repeatedly invalidate, and pointer leave, window blur and visibility changes clear it. Destroy removes host/document/window listeners. The tool does not consume Shift or publish trades/closes/alerts.

## Verification

- Ten cases in `tests/footprint-hover.test.ts`: normal/inverted row geometry and gutters, topmost actual instance, filtered/unloaded/style exclusions, finite completed Replay boundary, dense-cell inspection, raw row readout, bounded canonical neighborhoods/gaps, full-profile normalization, all five magnified profile modes and missing count labels, panel bounds, stationary modifier transitions and listener cleanup. Fifty targeted tests passed across four files.
- Explicitly simulated real Vela renderer fixture: `tests/browser/footprint-hover.ts`, `scripts/verify-footprint-hover-browser.mjs`. Fixed-focus buttons simulate cursor/Shift for reproducible screenshots; a separate pointer mode uses real native input. The focused [102,103) row reports Bid 2 / Ask 8 / Total 10 / Delta 6. The [103,104) slot remains blank and the off-lens 110 row controls normalization. Mean mode retains raw labels; a raw Max-volume-5 filter removes the target and its lens. An actual Shift-modified click on the row produced two modifier transitions (activation/release) and the correct row hit; the native Shift-click measurement is still available. Screenshots: `artifacts/footprint-hover-readout.png`, `footprint-hover-magnifier.png`, `footprint-hover-mean.png`, `footprint-hover-filtered.png`. The fixture also rendered the lens at a fresh 414px viewport (`footprint-hover-mobile.png`); this is not touch or native recorded Replay acceptance.
- Final complete suite: **2,222 tests in 204 files passed** (`artifacts/footprint-hover-tests.log`). Standalone TypeScript and final production build passed (`artifacts/footprint-hover-build.log`).
- Complete app on isolated loopback port 3001 with ephemeral test authentication: selected Binance BTCUSDT 1m, zoomed the chart and hit an observed Footprint 1 row. The native popup showed its actual price band, bid, ask, total and delta (`artifacts/footprint-hover-native.png`). A subsequent real Shift-modified input left the app without console errors. This is live row-readout integration evidence; the enlarged panel screenshot remains the explicit simulated fixture rather than a claim of captured held-Shift native parity. No real site access credential was read or changed.

## Remaining acceptance

Direct Vela popup geometry/zoom/default comparison, source/history equivalence, full-capacity pointer performance, populated multi-chart, touch and recorded browser Replay remain unproven. Footprint context quick toggles, visible-range variants and overlay equivalence remain separate open functionality. The overall Orderflow parity goal is incomplete.
