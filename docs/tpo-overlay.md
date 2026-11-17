# Time Price Opportunity overlay

The Order flow indicator catalog now offers **Time Price Opportunity** separately
from the TPO / Market Profile chart type. Adding it keeps the current chart type
and draws TPO profiles over its candles. The implementation shares the TPO model,
geometry, painter, marker/label renderer, hover and completed-reference touches.
Session right-click operations remain exclusive to the chart type.

Reference inspected 2026-11-04:
https://docs.luxalgo.com/platform/charts/order-flow/tpo

## Settings, source and lifecycle

The overlay input schema is generated from the existing chart-type settings.
All currently implemented session/calculation, IB, structure, reference,
display, marker, label and hover controls are exposed. Day-only controls hide
for UTC Week/Month. The overlay does not duplicate base candle painting and
cannot inherit or inject contextual merge/expansion operations. Each instance
has its own settings, model cache, channel identity and readout key.

The descriptor needs no executions, order book, broker connection or classified
archive. The renderer uses the chart's revealed candle array, including its
Replay prefix, and the existing cache observes historical repairs. Missing
candle slots remain incomplete; chart bars must divide the TPO block interval.
An unsupported interval publishes an error and removes old numerical readout
values until a supported interval returns. Suspend/stop clears the channel;
hidden/removed instance ids are excluded from the Data window.

Overlay profiles are painted above the base data. Each visible instance gets a
separate Time Price Opportunity section in the Data window. Per-instance inputs
use the existing indicator/layout persistence and settings UI; the legend shows
period, block minutes and value-area percentage.

## Evidence

- Eight new tests in `tests/tpo-overlay.test.ts`: derived schema coverage and
  primitive defaults, display/calculation preservation and excluded operations,
  conditional day fields, isolated descriptor lifecycle, shared math/repair/
  prefix behavior, actual overlay-vs-chart painter output, readout source/token/
  instance fences and separate catalog availability.
- Full suite **1,923 tests in 176 files passed**, TypeScript and production
  build. Logs: `artifacts/tpo-overlay-tests.log`,
  `artifacts/tpo-overlay-typecheck.log`, `artifacts/tpo-overlay-build.log`.
- `scripts/verify-tpo-overlay-live.ts` checks the actual overlay painter against
  independently grouped raw Kraken OHLC price-row/four-hour-window pairs.
  720 closed hourly BTC/USD bars, forming response row excluded, agree for
  every rectangle: **1,626 cells each for Day, Week and Month** (31/five/two
  profiles). Source payload and results: `artifacts/tpo-overlay-live.json`.
- Isolated production browser: ordinary Binance 15m candles remain active after
  adding the overlay. Week/240-minute blocks, 90-minute IB, split periods, POC
  label and midpoint apply; inputs survive reload. Month settings and hover
  work at 414px. The U block reports its original 08:00–12:00 UTC window.
- Delayed Yahoo AAPL candle-only data renders the same overlay without a trade
  feed. Month coverage is explicitly incomplete, with a missing midnight
  opening and no invented opening price. Two simultaneous Month/Day overlays
  publish distinct readouts; hiding one leaves the other intact, and removing
  the second preserves the first. Switching to 1D shows an interval error with
  no stale values; restoring 15m recovers. Captured warning/error logs are empty.
- Screenshots: `artifacts/tpo-overlay-week.png`,
  `artifacts/tpo-overlay-mobile-settings.png`, `artifacts/tpo-overlay-mobile.png`,
  `artifacts/tpo-overlay-aapl.png`.

## Remaining parity

This shares all **currently implemented** TPO settings; it is not a claim that
the full Vela TPO feature set is complete. Trading-hour calendars/presets,
metric themes and footprint hover metrics, native formatting and
direct Vela visual/default comparison remain open for both surfaces. Real
touch, populated multi-chart, recorded browser Replay, transformed chart types
and full-capacity performance still require verification. Yahoo AAPL is delayed
and does not establish consolidated Nasdaq real-time coverage.

The subsequent [volume-ladder checkpoint](tpo-volume-ladder.md) adds the shared
per-session OHLCV-estimated ladder, independent POC/VA and native/overlay controls.
