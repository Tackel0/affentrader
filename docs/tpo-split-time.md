# Expanded TPO time columns

`Split periods` now places each observed TPO block at its actual chart time
window rather than spacing block indices by a fixed text-cell width. This
addresses the expanded-view requirement in the official TPO documentation:
https://docs.luxalgo.com/platform/charts/order-flow/tpo (inspected 2026-11-04).

Both edges use the chart coordinate port, shifted half a candle spacing to
bracket the candle centers. The final block is clamped at session end. The
renderer respects the chart's compressed-gap projection, pan and zoom; it
does not substitute a linear timestamp axis. Missing periods are not invented
or renumbered. Letters center in each projected column when they fit. Subpixel
columns retain their projected width instead of expanding to one pixel.
Packed-profile geometry remains unchanged. The Data window identifies the
active arrangement. Session statistics and IB retain the same model.

## Evidence

- Nine regressions in `tests/tpo-split-time.test.ts`: producing candle centers,
  missing periods, nonlinear/compressed chart projection, pan/zoom, unchanged
  packing, final session clamp, subpixel width, partial Week, repeated local
  DST hours, viewport culling and exclusive revealed prefix behavior.
  Two existing painter expectations now assert the time-based geometry.
- Full suite **1,882 tests in 172 files passed**, standalone TypeScript and
  production build. Logs: `artifacts/tpo-split-tests.log`,
  `artifacts/tpo-split-typecheck.log`, `artifacts/tpo-split-build.log`.
- `scripts/verify-tpo-split-live.ts` independently maps raw Kraken OHLC to
  price-row/four-hour-window pairs with UTC Date arithmetic. Against 720
  closed BTC/USD hourly candles, excluding the forming response row, every
  rendered rectangle agrees with the oracle: 1,626 cells each for Day, Week
  and Month (31, five and two sessions respectively). This verifies the
  production painter under an explicit coordinate port, not Vela's private
  renderer or complete execution history. Raw capture and report:
  `artifacts/tpo-split-live.json`.
- Isolated production browser: actual Binance 15m chart with 4h blocks; expanded
  Day and partial Week rendering, fit/recent zoom views, split setting reload,
  mobile collapse/expand and wrapped native help at 414px. After reload the
  Data window reports `Expanded into chart time columns` and `240 min`.
  Captured warning/error logs are empty. Screenshots:
  `artifacts/tpo-split-desktop.png`, `artifacts/tpo-split-week.png`,
  `artifacts/tpo-split-mobile-settings.png`, `artifacts/tpo-split-mobile.png`.

## Remaining parity

This adds real-time-column geometry to the existing global Split setting.
The subsequent [session operations](tpo-session-operations.md) checkpoint adds
per-session right-click Expand/Collapse and chained Merge/Unmerge operations.
Direct Vela visual comparison, populated multi-chart and
browser recorded Replay remain unverified. Trading-window presets, themes,
volume ladder, markers and other checklist items are still open. No claim of
complete TPO or overall Orderflow parity is made.
