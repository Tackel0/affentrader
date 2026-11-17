# Orderflow calendar periods

TPO and Session Volume Profile now share Day, Week and Month calendars with
Session Volume Tails. Day retains custom hours, time zones, DST and weekday
filtering. Week starts Monday 00:00 UTC; Month starts on its first day at 00:00
UTC. Day controls are hidden and ignored for Week/Month. Existing saved settings
without a period retain Day behavior.

TPO additionally supports 240-minute blocks and the A-Z, a-z, 0-9 alphabet.
The existing numbered cycle suffix after 62 blocks remains an extension, without
direct Vela equivalence evidence. Calendar metadata keeps the actual opening
boundary; compressed partial profiles start drawing at their first loaded
observation so a missing prefix does not move the whole histogram off screen.
Cache identities include the selected period, including the shipped worker.

References inspected on 2026-11-04:

- https://docs.luxalgo.com/platform/charts/order-flow/tpo
- https://docs.luxalgo.com/platform/charts/order-flow/volume-profiles

## Validation

- 13 new regressions in `tests/session-periods.test.ts`: UTC calendar edges,
  leap month, DST Day compatibility, legacy settings, 4h/alphabet schema,
  coverage and reference readiness, completed weekly slots, prefix isolation,
  cache changes, classified sums, retained collection, shipped worker calendar
  changes and partial-profile rendering.
- Full suite: **1,864 tests in 170 files passed**. TypeScript and production build
  passed. Logs: `artifacts/session-periods-tests.log` and
  `artifacts/session-periods-build.log`.
- `scripts/verify-session-periods-live.ts` compares independently grouped raw
  Kraken OHLC against production TPO output: 720 closed hourly bars, one forming
  row excluded, five weekly and two monthly profiles, 4h blocks, 100-unit price
  rows. Period bounds, row opportunities, block indices, loaded/expected slots
  and POC agree. The first partial week/month remain incomplete. Raw response
  and results: `artifacts/session-periods-live.json`.
- Isolated production browser: Week/Month native TPO settings, 240-minute blocks,
  visible partial weekly/monthly profiles and Month/240 reload restoration.
  Session Volume Profile Week reload restoration and Month selection at 414px;
  day controls disappear for calendar periods. No captured warning/error logs.
  Screenshots: `artifacts/session-periods-tpo-week.png` and
  `artifacts/session-periods-mobile.png`.

## Remaining boundaries

This is not complete Vela parity. The subsequent [IB minutes](tpo-ib-minutes.md)
checkpoint adds independent duration with a 60-minute default and migration
of previous block-count settings. RTH/ETH calendars and named trading windows remain
open. Session Volume Profile keeps its existing 40-row/25-width defaults.
Split-period time positioning, themes, markers, volume ladder, merging and
direct Vela rendering/formula comparisons remain unverified or incomplete.
Recorded browser Replay and populated multi-chart verification remain open.

The public Kraken check proves candle-derived TPO grouping, not complete
historical classified executions. Session Volume Profile uses retained trades
with explicit partial coverage. Week/month clock slots do not invent missing
market sessions or execution history. Historical profile calculation does not
republish market events or trigger historical live alerts.
