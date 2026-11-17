# Completed Initial Balance extensions

**Evidence correction:** prior histogram-disappearance claims in this checkpoint are superseded by the [presented screenshot re-audit](tpo-presented-evidence.md). The cited captures do not prove that failure. This does not affect the independently verified mathematical features.

The native TPO settings now offer an independent **Initial balance extensions** switch and **Extension beyond IB (%)**, an integer from 1 to 500. The default is off with 100% configured. The feature expands beyond both extremes: upper = IB high + IB range × percentage / 100; lower = IB low − IB range × percentage / 100. Dashed lines begin at the exclusive IB end and continue through the resolved session end, using the IB color. They do not change the chart's price scale; levels outside the pane remain clipped until the user adjusts the view.

Only complete IB coverage produces fixed extension levels. Developing, incomplete and unavailable IB states withhold both lines and numbers. Numeric overflow or an offset too small to distinguish at Number precision reports unsupported extension values without invalidating the base IB/TPO model. Decimal arithmetic uses the canonical high/low inputs with BigInt intermediates; it does not multiply a rounded floating-point range. Zero-width IBs have coincident extensions.

The Data window shows status, percentage and exact upper/lower values when enabled. Its existing cell/source/Replay-history fences remain in force. Extensions are display calculations, so percentage/color/visibility changes reuse the TPO session model. Both older preference generations remain valid; native application resolves defaults for the new optional fields through the existing persisted settings path. The independent IB bracket switch does not control extensions.

This is an additional analysis control around the existing opening-range concept. The public [TradingView TPO reference](https://www.tradingview.com/support/solutions/43000725590-time-price-opportunity-charts-explained/) documents Initial Balance and its summary values; this implementation is not a claim that the extension controls reproduce every TradingView setting.

## Verification

- **1,486 tests across 130 files passed**, with production build and TypeScript passing. Logs: `artifacts/tpo-ib-extension-tests.log` and `artifacts/tpo-ib-extension-build.log`.
- Six new tests exercise canonical decimals, tiny/negative/flat ranges, invalid percentages, overflow/precision limits, missing/developing coverage, legacy/native preferences, cache reuse, actual regular/inverted painter projections and Data-window states.
- Production BTC/Hyperliquid, 5m, UTC: enabling 50% produced 78,990.5 above IB high 78,222 and 75,916.5 below IB low 76,685 (range 1,537). Both dashed extension lines were visible. The 50% setting and enabled switch survived reload.
- Hiding the IB bracket left the extension lines visible. The bracket was restored afterward.
- Actual Replay at 00:15 showed developing status and no extension numbers. At 01:05 both became ready; all extension fields were directly compared with those at 04:00 and remained identical. Disabling extensions removed their Data-window fields.
- Candles, EMA20, Volume, Watchlists, UTC and 5m were restored, Replay stopped, and the new controls returned to off/100%. Browser console evidence is saved separately.

Artifacts use `artifacts/tpo-ib-extension-*`: live/fixed/independent/developing screenshots, reload settings, Data-window text and the exact invariance comparison. Mobile layout and every layout/backup combination were not browser-tested in this checkpoint.

The [TPO histogram raster failure](tpo-raster-investigation.md), separate native-candle investigation, profile merge/split, full TPO/TradingView/Vela parity, complete trade archives and licensed Nasdaq real-time data remain open. Stable extension values and passing tests do not establish stable histogram presentation in every frame.
