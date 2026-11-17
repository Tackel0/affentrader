# Footprint display modes

Reference: https://docs.luxalgo.com/platform/charts/order-flow/footprint, inspected 2026-11-04. Vela documents Bid × Ask Profile, Bid × Ask Ladder, Volume Profile, Delta Profile and Absolute Delta. A focused public-client inspection confirmed the five modes, default-on volume buy/sell split and gradient cells, side-sized Ladder intensity, a left origin for Absolute Delta, and separate mono ramp colors.

`FootprintVolumeMode` and native settings now support all five modes. Existing stored `bid-ask`, `total` and `delta` IDs remain valid; the settings label is now Display mode. Cell values remain independent: Auto maps Ladder to Bid × Ask numbers and Absolute Delta to signed raw Delta numbers. Explicit cell-value choices, average-size geometry, raw quantities, count gaps, POC/imbalance analysis and observed auctions remain separate concerns.

`footprintModes.ts` provides the shared per-row geometry and color calculation used by the actual painter:

- Bid × Ask Profile: proportional sells left of the axis and buys right, normalized by the largest side.
- Bid × Ask Ladder: fixed adjacent half-width cells, with side-size color intensity rather than variable width. Qualifying Ladder imbalances get side-cell outlines.
- Volume Profile: combined-volume row width; sell then buy segments when split is enabled, or a configurable low/high mono ramp. New profiles default to split. A saved legacy `total` profile without the new key is normalized to mono to retain its former geometry.
- Delta Profile: positive/negative plotted delta grows right/left from the central axis, normalized by absolute delta.
- Absolute Delta: both signs grow from the left edge across the full profile width, colored by sign. Balanced rows have no histogram.

Gradient cells applies to every mode. Side colors interpolate intensity toward white on light backgrounds and toward black on dark backgrounds, with configured color alpha retained. Default mono ramp colors adapt to light/dark themes; explicit custom colors remain in use. Gradient-off mono uses the high color. Widths and sizes remain unchanged when gradients are toggled.

Split controls are shown only for Volume Profile, and mono colors only while its split is disabled. The existing shared buy/sell colors are reused; independent mode-specific palettes and the complete reference styling surface remain acceptance work. The data window and captured inspection/CSV now identify the display mode and split setting without rewriting observed volumes. No market events or alerts are emitted by these view changes.

## Verification on 2026-11-04

- Nine new cases in `tests/footprint-modes.test.ts`: all mode IDs/labels and legacy mono migration, Ladder widths/intensity, both Absolute Delta signs and zero delta, adjacent volume splits, mono/theme/alpha behavior, independent labels and histogram switches, actual ordinary/inverted canvas geometry and Ladder outlines, and inspection/CSV provenance. Original tests explicitly select mono or gradient-off where those are the behavior being tested.
- Full suite: **2,137 tests in 197 files passed**. Standalone TypeScript and production build passed. Logs: `artifacts/footprint-modes-tests.log`, `artifacts/footprint-modes-build.log`.
- `scripts/verify-footprint-modes-source.ts` independently groups the retained three-venue raw capture dated 2026-11-04T18:39:55.268Z and checks rectangle origins/widths for all five modes, both raw/mean sizes and mono/split volume. All **732 rectangle sets across 61 price rows** match: Binance 72, Kraken 636 and Hyperliquid 24. This is retained-source numeric evidence, not a fresh capture or direct Vela pixel comparison. Result: `artifacts/footprint-modes-source.json`.
- Native Vela simulated comparison fixture shows identical input rows in six separate candles: five modes with Volume Profile shown twice for Split and Mono. Raw/average, gradient and histogram toggles were visibly checked. This intentionally does **not** prove multiple independent instances around a single candle. Screenshots: `artifacts/footprint-modes-comparison.png`, `artifacts/footprint-modes-average.png`.
- Actual protected production-build app: all five options are selectable; Ladder applies, new Volume Profile starts with split on, disabling split reveals both mono colors, and Absolute Delta hides these controls. Absolute Delta survives reload while independent cell values and average-size settings remain intact. The five-option menu fits at 414px. No captured browser console errors. Screenshots: `artifacts/footprint-modes-settings.png`, `artifacts/footprint-modes-mobile.png`.

Five instances per candle and placement, complete mode-specific colors/settings, exact text alignment/zoom cross-fade, VA/filter/stat/overlay/magnifier coverage, direct reference visual/formula acceptance, full-capacity rendering and populated multi-chart/browser archive Replay remain open. The full Orderflow parity goal is not complete.

The rebuilt local production instance was restarted on port 3000 (PID 5316); HTTP 200 and the password gate were verified. Test servers on 3001 and 4321 were stopped.
