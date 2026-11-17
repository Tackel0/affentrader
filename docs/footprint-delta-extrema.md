# Observed intra-candle Footprint delta extrema

Footprint's Data window and captured row inspector now expose the maximum, minimum and closing cumulative delta of the observed executions in the selected candle, together with execution count and first/last timestamps. The path starts at zero immediately before its first observed execution, not at a reconstructed full-market candle opening.

Each retained candle owns an AVL-balanced ordered delta path. Timestamp, sequence where available, then ID determine order. This is exchange-event ordering, not original network arrival order. Late trades update earlier prefixes; duplicate IDs do not add volume. Complete-candle eviction and source replacement discard their paths. Price regridding and imbalance settings do not rebuild or reset the path. Cache snapshots remain immutable. The existing 100,000-trade per-market bound also bounds retained path nodes.

Painted surfaces publish frozen path snapshots with their corresponding price rows. A subsequent trade cannot mix a newer path with an older painted table during capture. Source, archive selection, feed epoch and exclusive completed-Replay fences also apply. Legacy external rows without execution paths show unavailable extrema instead of inferring them from final row delta. Both JSON and CSV export the captured path metadata. Number summation order can cause tiny differences between row delta and ordered closing delta.

## Evidence

- **1,684 tests across 148 files passed**, and production build/TypeScript passed. Eight dedicated tests cover distinct paths with equal final row totals, late/sequence/ID ordering, deduplication, grid/filter invariance, eviction/simulation isolation, immutable published revisions, invalid/future metadata, independent ordered sums over 12,000 shuffled trades and the full 100,000-execution single-bar boundary. The boundary test took about 403ms in this run and rejected the next execution before exposing an oversized path; this is not a general device-performance guarantee.
- Actual live HL:BTC 5m capture contained 76 executions, observed maximum **1.22518**, minimum **−0.48942** and closing delta **0.25962**. The dialog labels the partial collection and its first observation at 17:57:44 UTC on November 2.
- Archived November 1 **12:40 UTC** Replay: **186 executions**, maximum **0.84329**, minimum **−0.81976**, close **0.84259**, exclusive cutoff **12:45 UTC**. Regridding from automatic rows to $1 rows preserved all path statistics. A separate decimal-integer prefix oracle over the downloaded original archive confirmed every value, all Bid/Ask rows, counts and first/last timestamps. Ten later observations were excluded.
- Backward Replay to **12:20 UTC**: **284 executions**, maximum **5.47882**, minimum **−1.31926**, close **5.41527**, exclusive cutoff **12:25 UTC**. The same independent verifier passed and excluded 709 later observations. No later-candle path persisted after the seek.
- Desktop and **414×720** actual dialog checks show readable, wrapping metadata. The document stays 414px wide; its 390px modal contains a 540px scroll body for the extended content. Removing the temporary archive selection removes the Replay values. Live 5m, automatic rows and Watchlist sidebar were restored; recording remained paused. Browser warnings/errors were empty.

Artifacts: `footprint-delta-tests.log`, `footprint-delta-build.log`, `footprint-delta-archive-check.json`, `footprint-delta-backward-check.json`, `footprint-delta-live.png`, `footprint-delta-replay.png`, `footprint-delta-mobile.png` under `artifacts/`.

`scripts/verify-footprint-inspection-export.mjs` now independently verifies CSV path fields and, when a trade-archive JSON argument is provided, its ordered per-candle delta prefixes as well as row quantities. No application math pipeline is imported by that verifier.

These values describe the retained observations only. Missing exchange executions may change both extremes. Complete tape/history, original-arrival playback, historical depth and full TradingView/Vela parity remain open.
