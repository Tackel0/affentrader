# Bar Stats

Reference inspected 2026-11-04:
https://docs.luxalgo.com/platform/charts/order-flow/bar-stats

Indicators → Order flow → Bar Stats adds a categorical table pane below the
price chart. Volume, Delta, Buy and Sell start enabled; Buy trades, Sell trades
and Trades start disabled. Each row has its own color and visibility. Delta
uses separate positive/negative colors. Values → Auto prints a value only when
the candle column and row can contain it; Off keeps the color cells. Hover
reports the bucket time and exact observed quantity/count.

One cell corresponds to one chart candle and statistic. Intensity is normalized
per statistic to the largest absolute visible value, including partly visible
edge columns. Zoom/pan therefore recompute intensity without altering the
underlying totals. The pane uses Vela's native categorical `paneAxis.bands`
instead of pretending the rows form a numerical price scale.

The accumulator keeps canonical decimal quantity sums independently of print
counts. Volume = buy + sell; delta = buy − sell. Print counts come only from
`Tick.tradeCount`. A count-less buy/sell observation leaves that count side and
total count unavailable while retaining its classified quantity. No candle
volume or count fallback is synthesized, and buckets without observations stay
empty. Real zero values (e.g. buy volume in an observed sell-only bar) remain
zero. Monthly and tick chart intervals are explicitly unavailable.

The collection retains 20,000 aggregate time buckets and 20,000 recent execution
IDs. Timestamp-watermark compaction preserves sums while rejecting older
deliveries; overflowing one timestamp, bucket capacity or safe integer counts
fails explicitly. Source changes isolate simulation; duplicate IDs with changed
values fail rather than silently correcting already-counted statistics.

The native instance batches live updates, preserves collected history on row
and color edits, and fences callbacks after suspension/stop. Loaded archive
revisions rebuild its source. Completed-bar Replay consumes only the selected
archive prefix, rebuilds on backward seeks and excludes live ticks. Render
identity checks guard source epoch, market, interval and Replay boundary.

Implementation: `lib/orderflow/barStats.ts`, `barStatsIndicator.ts`,
`barStatsRenderer.ts`, native registration/catalog and tailored host settings.
Fourteen tests in `tests/bar-stats.test.ts` cover all seven calculations, exact
decimals, missing count sides, visible normalization, sparse/edge columns,
adaptive text, hover values, capacity, source isolation, lifecycle, categorical
labels, styling, archive revision and backward Replay.

Independent public capture: bundle `scripts/verify-bar-stats-live.ts` with
esbuild (`platform: node`, `format: esm`) and run the emitted module with Node.
The inspected capture (`artifacts/bar-stats-live.json`) spans two minute buckets
per venue: 58 Binance aggregates representing 128 underlying prints, and 23
Kraken matched trades/prints. A separate fixed-18-decimal BigInt oracle checks
all seven numeric fields and four exact quantity strings from raw payloads.
Both sources matched with no capture errors. This brief capture does not prove
complete market history or cross-venue equivalence.

The full parity objective remains in [vela-orderflow-parity.md](vela-orderflow-parity.md).

Final validation on 2026-11-04: 1,791 tests in 164 files pass, plus production
build and TypeScript (`artifacts/bar-stats-tests.log`, `bar-stats-build.log`).
Actual Binance browser checks show the four default rows, all seven enabled
rows, categorical labels, stronger colors for larger visible observations,
adaptive numbers on zoom and an exact hover quantity (e.g. `2.52302` versus
the compact `2.52`). Values → Off removes the cell numbers. All seven row
toggles and Off survive reload/restarted test-server sessions. The final title
shows `7 rows` rather than raw Boolean inputs. Generic numerical-plot/price
source settings and help are excluded from this categorical study.

The 414×720 Style dialog fits its color/value controls and keeps Cancel/Apply
visible. The final browser warning/error log was empty. Evidence:
`artifacts/bar-stats-live.png`, `bar-stats-hover.png`,
`bar-stats-color-only.png`, `bar-stats-mobile-settings.png`.

These checks do not establish direct pixel equivalence with Vela, full-capacity
rendering performance, populated multi-chart behavior or browser Replay of an
actual recorded capture. Archive prefix/backward-seek behavior is covered by
the descriptor regressions. Complete venue/history coverage remains open.
