# TPO volume profile ladder

The chart type and Time Price Opportunity overlay share an optional per-session
volume ladder, following the control families described in the
[official TPO reference](https://docs.luxalgo.com/platform/charts/order-flow/tpo).
Left/Right placement, independent rows, width percentage, volume value-area
percentage, POC/VA lines, labels and colors are persisted through each surface's
settings. The overlay retains independent per-instance settings.

The ladder estimates volume uniformly across each candle's high/low range using
the existing conservative fixed-profile allocator. It is explicitly an **OHLCV
estimate**, not aggressor buy/sell volume. It uses only revealed candles inside
the session's actual member windows, including composites. Missing/invalid volume
is reported; an unavailable ladder does not suppress a valid time profile.
Volume-only history changes invalidate the separate ladder cache and readout
fingerprint without rebuilding the time/price model. Repairs are rendering data,
not new trade or close events. Canvas price labels use compact display precision;
model levels and the Data window retain their numerical values.

The daily session-length input now uses a five-minute step matching its minimum,
so the default 1,440-minute length can be submitted through the overlay form.
Yahoo sometimes appends a flat, zero-volume point inside the last intraday candle
at `regularMarketTime`. When the granularity, quote timestamp and overlapping
window establish this provenance, the parser excludes that extra quote point
from candle studies and retains the quote in metadata. Actual candle timestamps,
including session-offset hourly bars and next-boundary zero-volume candles,
remain unchanged.

## Verification, 2026-11-04

- Full suite: **1,945 tests in 178 files passed**, standalone TypeScript and
  production build passed. Logs use the `artifacts/tpo-ladder-` prefix.
- Twelve ladder regressions cover independent calculations/settings, exact
  conservation, volume-only repair, merged/revealed windows, missing/invalid
  volume, inverted scales, placement, compact tiny-price labels, valid HTML
  defaults and stale readout fencing. Eight Yahoo tail regressions preserve
  genuine candle rows while rejecting the identified quote-only point.
- `scripts/verify-tpo-ladder-live.ts`: retained public Kraken payload, 720 closed
  hourly candles; an independent integer-unit overlap oracle verifies all bins,
  totals, POC and VA for **76 profiles / 1,368 rows** across Day/Week/Month and
  12/24 rows. Report: `artifacts/tpo-ladder-live.json`.
- `scripts/verify-tpo-yahoo-tail.ts`: fresh delayed public AAPL 15m payload,
  579 rows, one identified quote-only point removed, 578 candles and 23 profiles;
  per-session ladder totals agree with observed candle volumes. Raw capture and
  report: `artifacts/tpo-ladder-yahoo-live.json`.
- Isolated production browser: AAPL 15m Day applies with the default full-day
  length; Left and Right overlay placement renders; the Data window shows the
  distinct volume POC/VA and estimate basis. Native TPO ladder renders with the
  overlay hidden, retains 12 rows and enabled labels through reload, and its
  controls/plot work at 414px. Captured browser warnings/errors are empty.
  Screenshots: `tpo-ladder-overlay-right.png`, `tpo-ladder-overlay-left.png`,
  `tpo-ladder-native.png`, `tpo-ladder-mobile-settings.png`,
  `tpo-ladder-mobile.png` in `artifacts/`.

## Remaining parity

This implements the ladder control family, not verified pixel/default/formula
equivalence to Vela. Trading-hour calendars/presets, metric themes/footprint
coloring and hover values, outside-VA opacity, native formatting, direct Vela
comparison, populated multi-chart, real touch, recorded browser Replay and
full-capacity performance remain open. AAPL data is delayed; a full-day profile
with absent overnight candles correctly remains incomplete.
