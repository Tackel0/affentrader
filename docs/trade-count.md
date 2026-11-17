# Trade Count family

Reference inspected 2026-11-04:
https://docs.luxalgo.com/platform/charts/order-flow/trade-count

Three native Indicators → Order flow entries:

- Trade Count: sum of underlying buy and sell prints; one column color.
- Trade Count Delta: buy prints minus sell prints; positive/negative colors.
- Cumulative Trade Count Delta: UTC Day (default), Monday Week, Month or All
  data anchors; Candles (default, ordered count-path wicks), Line and Area.

`Tick.tradeCount` is optional count evidence, independent of base quantity.
Binance aggregate streams supply the inclusive first/last underlying trade IDs;
`aggregateTradeCount` accepts only safe ordered integer spans. Missing evidence
does not imply one. Kraken matched trade records and Hyperliquid trade records
carry one print. Simulation carries one explicitly simulated print.

Provider references:

- https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams
- https://docs.kraken.com/api/docs/websocket-v2/trade
- https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions

The native accumulator deduplicates IDs, orders count paths by execution time,
sequence and ID, seals paths when old duplicate IDs are compacted, and checks
integer precision. It supports 20,000 aggregated buckets and 20,000 recent IDs.
Wrong symbols and old deliveries after source transitions are excluded. Empty
bars remain gaps, including CTCD. A genuinely observed balanced bucket can be
zero. An execution without counts invalidates its entire bucket; for CTCD it
also invalidates the remainder of that UTC anchor. A later anchor can restart
with known counts. Monthly/tick chart intervals are explicitly unavailable.

Archives retain this optional field without a database-schema migration. CSV
exports append a `trade_count` column after the previous fields. Old archives
remain loadable but their missing counts are not guessed or backfilled. Known
conflicting counts reject archive writes and archive/live source combinations.
Unknown metadata does not overwrite a previously recorded execution. Study
hydration and completed-bar Replay preserve counts, rebuild on backward seeks
and avoid sending historical events through the live market service.

The archive ID validator now accepts `/` inside execution IDs. Kraken creates
IDs such as `KRK:BTC/USD:123`; these were previously rejected by recording
despite Kraken already being listed as a supported provider.

Implementation: `lib/orderflow/tradeCount.ts`, `tradeCountIndicator.ts`, native
registrations in `velaPlugins.ts`, catalog entries and provider/archive plumbing.
Sixteen focused regressions in `tests/trade-count.test.ts` cover count-versus-size,
inclusive spans, missing counts, UTC resets, ordered extrema, compaction,
capacity, precision, lifecycle, styling, Replay, real service delivery and
Kraken IDB close/reopen → study → Replay hydration.

Live numeric check: `scripts/verify-trade-count-live.ts`, bundled with esbuild
as ESM and executed with Node. `artifacts/trade-count-live.json` retains public
raw observations and results. The inspected run captured 62 Binance aggregates
containing 153 underlying prints and 7 Kraken matched prints. Independent raw
per-bar totals, signed counts, cumulative open/high/low/close matched all three
model outputs. This short capture proves neither complete historical coverage
nor cross-venue equivalence.

Full Vela parity remains tracked in [vela-orderflow-parity.md](vela-orderflow-parity.md).

Final verification: 1,777 tests in 163 files pass; TypeScript and production
build pass (`artifacts/trade-count-tests.log`, `trade-count-build.log`). A
pre-existing replacement-socket regression now pins its fake clock: advancing
two seconds over a real minute boundary had demanded an extra REST page the
two-response fixture never resolved. No production recovery behavior was
changed for that test correction.

Actual Binance browser checks show all three panes, sign-colored delta columns
and CTCD candles. Week/Area selections survive browser reload; changing back to
Candles paints the count candle. Relevant styling replaces the host's generic
price-source controls; CTCD line width is applied by the native output. The
414×720 candle-color dialog scrolls while keeping Cancel/Apply visible. The
captured browser warning/error log was empty. Screenshots:
`artifacts/trade-count-live.png`, `trade-count-area.png`,
`trade-count-mobile-settings.png`.

Recorded native Replay and populated 1m/5m cells were additionally checked on
2026-11-06 against 75 saved real Kraken records. Five populated checkpoints and
four empty/cleared checkpoints pass an independent count-path verifier, including
backward seek and archive remove/restore. See [trade-count-replay.md](trade-count-replay.md)
for exact scope, raw evidence, numbers and remaining limitations.

Integer Data window, legend, count-axis, crosshair and last-value-chip formatting
is implemented and checked in the actual native browser with the saved Kraken
sample, including manual scaling and CTCD's own scale merged into the price
pane; see [trade-count-format.md](trade-count-format.md).

Not yet proved: direct pixel comparison with Vela; every layout/anchor;
complete venue/history coverage. The original 1,777-test result above is the
historical family implementation gate, not the current whole-project test count.
