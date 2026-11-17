# Kraken recording, reload and native Replay acceptance

## Real local workflow on 2026-11-06

The complete protected production-build workspace ran on an isolated loopback
origin with temporary synthetic authentication and a separate server data
directory. Real site credentials and normal server data were not read or changed.
It used public Kraken BTC/USD 1m candles, classified trades and current AssetPairs
precision. Native Footprint, CVD and Session Volume Profile were present; existing
test-origin footprint settings, including inspected Footprint 5, were preserved.

Recording committed **75 unique real executions**, from 10:55:06.140 through
10:56:26.276 UTC, then paused with zero pending writes. After a complete page
reload the same records remained, the per-tab new-commit counter reset to zero
and recording remained off. The full stored range was read/exported and explicitly
loaded into native studies. That selection is intentionally ephemeral across
reload; the IndexedDB recording persists.

| Replay candle UTC | Exclusive cutoff UTC | Prefix | Session buy | Session sell | Session delta |
| --- | --- | ---: | ---: | ---: | ---: |
| 10:54 | 10:55 | 0 | unavailable | unavailable | unavailable |
| 10:55 | 10:56 | 58 | 0.13947020 | 2.07631264 | -1.93684244 |
| 10:56 | 10:57 | 75 | 0.14953159 | 2.07780104 | -1.92826945 |
| 10:57, recording gap | 10:58 | 75 | 0.14953159 | 2.07780104 | -1.92826945 |
| back to 10:55 | 10:56 | 58 | 0.13947020 | 2.07631264 | -1.93684244 |

The 10:56 Footprint contains its own 17 executions: buy 0.01006139, sell
0.00148840, volume 0.01154979 and delta 0.00857299. At 10:57 it reports missing
executions instead of zero volume. Live observations remain excluded while
Replay is active. Empty prefixes clear old CVD numeric aliases and session
quantities. Removing the selected archive while paused clears all three studies;
reloading restores the 58-record prefix without a Replay step.

Stepping past the initially loaded Replay history returned to Live normally.
The gap checkpoint was therefore measured after explicitly restarting Replay
and seeking to 10:57 in refreshed history, not from the Live view. The date input
accepts its displayed minute form; the browser tool rejected normalized zero
seconds. This was not an app date-control fix.

At 414 × 896, Recorded orderflow opens the retained 75-record selection, with
document width and scroll width both 414px. Responsive layout closes the sidebar;
it was reopened for later readouts. No captured browser warnings/errors occurred.
No alert/order commands were issued.

## Independent checks and limits

`scripts/verify-kraken-recorded-replay.ps1` uses independent .NET decimal sums on
the downloaded archive and both Replay tape exports. It verifies every ID,
price, quantity, side, timestamp, sequence and exclusive cutoff, then compares
native Footprint/session quantities and counts, backward/restored, empty,
removed and gap readouts. Results: `artifacts/kraken-recorded-replay-verification.json`.

Native CVD displayed one decimal: both nonempty closes show -1.9, matching the
rounded independent sums. Clearing is verified; this does not establish its exact
unrounded native value at every checkpoint. CVD model tests are separate evidence.
Two minutes of partial public observations do not establish full venue history,
original-arrival/intrabar playback, capacity or populated multi-chart acceptance.
Images, text and downloads use the `kraken-recorded-replay-` artifacts prefix;
public observations and isolated server credentials are excluded from the ZIP.

## Corrections found

- Archive help/errors and unavailable-footprint/profile guidance now name Kraken
  alongside Binance/Hyperliquid, matching existing provider support. Recording
  mechanics did not need changes.
- General candle CSV incorrectly labeled all nonsimulated sources Binance. A real
  Kraken export demonstrated it. `chartDataCsv.ts` now uses loaded symbol/interval
  candle lineage and routed provider; simulation and unknown lineage stay explicit.
  It does not infer lineage from the latest quote. Columns and existing Replay
  candle selection are preserved. Two regressions cover five provider routes and
  simulation/unknown lineage; recorded-trade export is separate.

Final gate: **2,390 tests in 224 files**, final CSV regressions, standalone
TypeScript and production build passed. A fresh final-build browser session again
retained all 75 recordings, restored the 58-record Replay prefix and displayed the
updated Kraken help. Its exported 700 candles now all say Kraken and stop at
10:55. All 700 overlapping OHLCV rows exactly match the previous export's data;
the earlier export had 720 rows because its rolling history load started earlier.
Final browser warnings/errors: zero. Local production was restarted with its
normal password protection. Temporary test listeners were stopped. Logs and
final-browser JSON use the same artifacts prefix. Netlify publication remains
pending; its live site still reports a usage-limit pause.
