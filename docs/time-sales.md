# Bounded Time & Sales and honest depth status

Update: [Recorded Time & Sales](recorded-time-sales.md) now adds explicitly loaded archive-prefix inspection in completed-bar Replay. The Replay exclusion described in the historical verification below applied to live tape and remains in force for live buffers; it does not exclude the new archive-only path.

The Order flow bottom panel now uses its own component and a pure tape-selection pipeline. It replaces the former unfiltered 30-row preview and unconditional `LIVE L2` label.

## Tape behavior

- The rolling chart buffer supplies at most **5,000 retained observations**. Rows are validated, copied, frozen, deduplicated by ID and sorted newest first by execution timestamp, sequence where available, then ID. Invalid prices/quantities/timestamps, unclassified sides, other markets and mixed real/simulated sources are excluded. Yahoo quotes and unclassified IEX data cannot become aggressor executions even if an accidental Tick-shaped object reaches this pipeline.
- Select all, aggressor buys or aggressor sells, and an inclusive minimum provider quantity or raw **price × quantity** threshold. The product is not labelled as verified contract turnover or converted currency.
- All matching retained observations are reachable in pages of **100**. A high filter with no matches says no retained matches, rather than claiming zero market activity. Times include milliseconds and explicitly use UTC. Price strings and CSV preserve the Number model; displayed quantities use up to 12 significant digits.
- **Pause tape** freezes only the local inspection snapshot. Feed collection and depth continue. Resume takes the latest buffer. Symbol, selected source, feed epoch and Replay transitions invalidate a paused snapshot immediately, before the sampling effect refreshes it.
- A mounted active tape samples changed buffer references every **150ms** rather than rebuilding 5,000-row copies for every tick. Sampling stops while paused. This is a UI cadence, not a provider-latency or throughput guarantee. The last-observation timestamp and increasing age remain visible; old prints are not presented as continuously live.
- CSV exports **every filtered retained row**, independently of the current page, with capture timestamp, market, simulation flag, filter configuration, execution ID, UTC time, exact model price/quantity, aggressor and optional sequence. An export is a snapshot, not a complete session.
- Replay hides the live tape and disables pause/export. Recorded completed-candle observations remain available in the existing archive/Footprint inspector. This component does not yet provide a historical Replay tape.

## Depth behavior

The six-level preview now calls the same `depthBookStatus` validation as DOM: market match, real source, no Replay/simulation, valid uncrossed ordered levels, both sides present, at most 1,000 levels per side, no more than five seconds old and at most one second in the future. Its clock refreshes every 500ms so a quiet stale book does not stay labelled available. Valid rows are labelled **OBSERVED TOP LEVELS** and show the snapshot time and partial-depth limitation. Invalid or stale rows are removed. The preview places no orders and claims no full book or queue position.

The old instruction that Footprint used only the latest 5,000 trades was corrected: native Footprint has its own 100,000-execution bounded collection and can use explicitly loaded archives. Candle-derived TPO is distinguished from classified Footprint/CVD data.

## Verification

- **1,692 tests across 149 files passed**, including eight dedicated tape tests and the existing DOM status tests. The final production build/TypeScript passed. Tape tests cover source/side validation, Yahoo/IEX exclusion, simulation separation, Replay, stable snapshots, inclusive filters, late-event order, all 50 pages at the full 5,000-row boundary, complete filtered CSV, UTC and tiny Number precision.
- Actual Hyperliquid BTC browser interaction checks froze **89 observations**, kept the table unchanged while ticks continued, then selected **18 buys** passing a **100 price × quantity** threshold. All 18 CSV records independently matched their visible table cells.
- Resuming accumulated **289 observations**. The three pages contained **100 / 100 / 89** records. CSV included all 289, and its first 100 rows independently matched the visible first page. Every exported record passed the filters and IDs were unique. These full interaction checks ran against the development build; the production checks below repeated the key behavior.
- Actual production Hyperliquid ETH inspection froze **61 observations** and filtered **eight sells** with provider quantity at least **0.1**. All eight downloaded CSV records matched the visible table independently. Switching the paused ETH view to BTC removed its paused snapshot. Production Replay showed zero live tape tables, disabled export and the explicit depth-unavailable message. No order actions were invoked.
- At **414×720**, the document remained 414px wide. The panel was 316px wide and its 390px table scrolled inside a 291px container; controls remained accessible in the outer scrolling panel. This mobile check ran against the development build with the final layout. The temporary viewport was reset. Final state was restored to BTC, 5m, live, automatic Footprint rows, Watchlist sidebar and the previously closed bottom panel. Browser warnings/errors were empty after the production checks.

Artifacts under `artifacts/`: `time-sales-tests.log`, `time-sales-build.log`, `time-sales-filter-check.json`, `time-sales-all-check.json`, `time-sales-production-check.json`, `time-sales-desktop.png`, `time-sales-mobile.png`, `time-sales-production.png`, and `time-sales-replay.txt`.

The independent `scripts/verify-time-sales-export.mjs` verifier accepts the downloaded CSV plus a saved visible-table text artifact, checks every visible row, source/filter metadata, unique IDs, ordering and every exported filter condition. It imports no application selection code.

## Remaining scope

Historical tape playback, full exchange tapes/depth, aggregation choices beyond the provider's native execution/aggregate-trade messages, individual fill reconstruction, complete source/device capacity and overall TradingView/Vela parity remain open. Authenticating an IEX account does not provide classified aggressor flow or consolidated Nasdaq/SIP/depth.
