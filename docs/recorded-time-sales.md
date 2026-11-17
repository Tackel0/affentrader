# Recorded Time & Sales in completed-bar Replay

The Order flow panel can inspect explicitly loaded classified execution archives alongside native chart Replay. This supersedes the Replay tape exclusion at the earlier [live tape checkpoint](time-sales.md). It does not reconstruct original network arrival or provide tick-by-tick playback.

## Source and clock contract

`recordedTapeSource` requests only `StudyTradeSource.replay`, never the live market buffer. The chart must be ready, on the matching exchange symbol/timeframe and market epoch. An archive revision and the native last-completed-candle exclusive boundary identify each snapshot. Every execution must precede that boundary; backward seeks rebuild the smaller prefix. Simulation, Yahoo and unclassified IEX cannot supply this tape.

`captureRecordedTimeSales` validates and freezes up to 100,000 selected executions. Invalid, duplicate, mixed-source or unrevealed rows reject the entire capture; an oversized input is rejected rather than silently truncated. Sorting uses execution time, known exchange sequence and ID, which does not establish network arrival order. A valid empty prefix is distinct from a missing selection. Source removal clears the table and disables export immediately.

The native Replay controls own advance/pause. Side and inclusive minimum-size filters, 100-row pagination and complete filtered CSV work on the revealed prefix. Historical table timestamps include the full UTC date. CSV adds `recorded_replay`, `replay_before_utc` and `source_coverage`; clicking export rechecks the actual chart boundary, source and archive revision. Missing archive periods remain unknown. Replay depth stays unavailable because no depth archive exists.

## Evidence

- The implementation checkpoint passed **1,715 tests in 151 files**, production build and TypeScript. Eight recorded-tape tests cover strict cutoff equality, forward/backward seeks, immutable snapshots, missing versus empty source, loading/source/simulation guards, revision fencing, invalid rows and the full 100,000-record/1,000-page export boundary. The actual browser checks below use 993 records, not a full-capacity browser fixture.
- Production UI inspection used 993 actual retained Hyperliquid BTC observations from November 1, 2026. At the exclusive 12:45 UTC boundary, all 983 revealed executions matched the independent raw-archive oracle; ten later observations were excluded. Seeking back to 12:25 produced 284 executions and excluded 709 later observations. The third page contained the remaining 84 records. Filtering sells with quantity at least 0.01 produced 26 matching rows, identical in table and CSV.
- Advancing to the exclusive 13:15 boundary revealed all 993 observations. The independent verifier compared every exported ID, time, price, quantity, side and sequence against the raw archive, plus the 100 displayed first-page rows. All matched. It imports no application selection math.
- A current production check before the first retained trade, at the exclusive 12:15 boundary, returned an explicitly empty recorded prefix. Removing the loaded source then removed the table, disabled CSV and showed the missing-selection message with no live fallback. Stored recordings were retained and recording remained paused.
- At **414×720**, the sell filter returned 296 of 993 archived observations. The document stayed 414px wide; the 390px table scrolled within a 291px container. The screenshot shows accessible filters/export and full-date table rows. The temporary viewport was reset and the BTC 5m live Footprint/Watchlist workspace restored.

Artifacts: `recorded-tape-tests.log`, `recorded-tape-build.log`, `recorded-tape-typecheck.log`, `recorded-tape-{983,284,filter,993}-check.json`, corresponding DOM text captures, `recorded-tape-empty.txt`, `recorded-tape-source-removal.txt`, `recorded-tape-final-desktop.png` and `recorded-tape-mobile.png` under `artifacts/`.

Verifier usage: `node scripts/verify-time-sales-export.mjs tape.csv visible-table.txt report.json raw-archive.json`. The optional final argument enables complete archive-prefix comparison.

## Remaining scope

Complete exchange tape/history, original-arrival and tick-by-tick Replay, historical order books, account-verified equity feeds and overall TradingView/Vela parity remain open. This checkpoint establishes review of observed executions through completed candles, not continuous historical coverage. IEX remains distinct from full Nasdaq/SIP, depth and classified aggressor flow.
