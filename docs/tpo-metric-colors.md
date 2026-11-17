# TPO classified execution colors

Reference inspected 2026-11-04: https://docs.luxalgo.com/platform/charts/order-flow/tpo

Both the TPO chart type and independent overlay support Time, Volume, Trades
count and Delta in Color row by. Volume and count select four theme stops by
quartiles of the largest observed row total in that profile. Delta uses the
sign of the row delta and four intensity levels normalized to the largest
absolute row delta. Classic, Neon, Arctic, Orchid and Custom provide the delta
side colors. Outside-VA dimming and custom CSS alpha are retained.

Color totals aggregate a price row over its session or composite. Hover values
are the selected block's executions at that row: observed volume, underlying
print count, or buy minus sell volume. The original time/price TPO model, POC,
value area and initial balance continue to come from candles. Their model cache
does not depend on color mode or execution totals.

Each mounted native/overlay surface retains deduplicated classified executions
and listens for live ticks even when no native candle changes. Repaints are
batched at 50ms. Feed/source/archive changes discard old totals. Replay reads
only its archive prefix strictly before the revealed boundary and subscribes
to no live ticks; backward seeks discard later quantities. Archive replacement,
switching to Time, hidden layers and destruction detach subscriptions/timers.
Initial archive/live tapes are seeded once per source identity, avoiding a
100,000-observation rescan on every cursor movement.

Data limits are explicit: no OHLCV allocation, inferred aggressor side or
one-message-as-one-print counts. Missing execution rows use Time. A profile
with an unknown contributing print count uses Time for Trades count. Simulation
does not supply classified metrics. Duplicate conflicts, unsafe totals and the
100,000-retained-execution limit fail to Time with a source message. No partial
financial total is silently truncated. The Data Window reports the requested
mode, actual session fallback and source coverage. Missing history is unknown.

Verification:

- Fifteen new metric/source tests plus the existing TPO tests: 217 passing
  checks in 24 files. They cover row versus block totals, normalized colors,
  unknown counts, archive/live overlap, capacity/conflicts, missing candles,
  Replay boundaries/backward seek, feed/archive resets, independent surfaces,
  batched ticks and subscription cleanup.
- Full suite: **2,013 tests across 186 files passed**
  (`artifacts/tpo-metrics-tests.log`). Standalone TypeScript and production
  build passed (`artifacts/tpo-metrics-build.log`).
- `scripts/verify-tpo-metrics-live.ts` checked 1,000 actual Kraken executions
  against an independent raw-tuple oracle. All 19 populated block/price cells
  matched buy/sell quantities and print counts; 721 candles were available.
  Capture and raw public input: `artifacts/tpo-metrics-live.json`.
- Isolated production-browser check: live Kraken BTC/USD native TPO, Delta,
  Volume and Trades count colors/hovers, unknown-block Time fallback, persisted
  mode after reload, and candle-only Replay enter/exit. Screenshots:
  `artifacts/tpo-metrics-delta-hover.png`, `tpo-metrics-volume-hover.png`,
  `tpo-metrics-count-hover.png`, `tpo-metrics-replay-fallback.png`.

Still open: full-capacity performance and direct Vela visual equivalence;
populated multi-chart and independent overlay browser acceptance; combined
recording, reload and archived Replay. Public observed trades do not establish
complete historical execution coverage or complete Orderflow parity.
