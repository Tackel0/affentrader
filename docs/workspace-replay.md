# Shared workspace Replay

The React chart grid now uses the installed Vela 0.9 `WorkspaceReplay` controller.
The controller owns the shared clock and advances to the next close on any
visible chart. Each chart retains its own native data identity and completed-bar
orderflow boundary. Changing the active cell does not restart Replay.

Reference: https://docs.luxalgo.com/vela/user/workspace and
https://docs.luxalgo.com/platform/charts/replay.

The adapter waits for every visible chart and checks its symbol/timeframe before
starting. React replacements join at the existing cut before their loading cover
is removed. Playback pauses while cells are absent and resumes after all expected
cells join, unless the user explicitly paused or stopped. Failed starts/joins end
the group and report the original error. Source generation changes stop Replay.
Loading a saved layout stops the previous session. Paper Replay is reset by an
explicit group start/seek, rather than by a cell remount; joining primary charts
are not permitted to process paper fills before becoming the published primary.

## Browser acceptance, 2026-11-06

An isolated protected production build on 127.0.0.1:3001 used the retained real
75-execution Kraken archive described in `kraken-recorded-replay.md`. Recording
remained off. The full stored selection was explicitly loaded through the UI.
The two columns used KRK:BTC/USD 1m and 5m. Both had native Footprint; the 1m chart
also had native CVD (Month/UTC) and Session Volume Profile (24 rows/UTC).

| Shared close UTC | 1m candle/cut | 5m candle/cut | Archived observations |
| --- | --- | --- | --- |
| 10:55 | 10:54 / 10:55 | 10:50 / 10:55 | 0 / 0 |
| 10:56 | 10:55 / 10:56 | 10:50 / 10:55 | 58 / 0 |
| 10:57 | 10:56 / 10:57 | 10:50 / 10:55 | 75 / 0 |
| 11:00 | 10:59 / 11:00 | 10:55 / 11:00 | 75 / 75 |

Activating the 5m chart at shared close 10:56 preserved its 10:50 candle. One Next
advanced the inactive 1m chart to 10:56 without advancing the 5m candle. Switching
back to 1m confirmed 75 records and the 17-execution current-minute Footprint.
Three further steps from the active 5m chart reached its completed 10:55 candle
at 11:00 with 75 records. Seeking backward from the 1m chart to 10:55 restored
58 records; activating 5m then showed its empty 10:50 Footprint again.

Exact native Footprint/SVP quantities are checked against the exported raw archive
with independent .NET decimal arithmetic by `scripts/verify-workspace-replay.ps1`.
CVD is checked only at its displayed one-decimal precision. Evidence is in
`artifacts/workspace-replay-*-data.txt`, `workspace-replay-verification.json` and
`workspace-replay-shared-close.png`. The browser reported no warnings/errors.

The final production build passed 2,397 tests in 225 files, standalone TypeScript
and the production build. A fresh browser load restored all 75 stored records;
reselecting them reproduced the 1m 58-record prefix, the empty 5m prefix after
activation, and the 5m 75-record prefix after four further shared steps. These
final readouts are included in the decimal verifier; `workspace-replay-final.png`
shows the final two-chart state. No warnings/errors were captured in that run.

Seven runtime regressions use the actual SDK controller with controlled public
chart ports: mixed intervals/cutoffs, active-cell changes, deferred remounts,
partial/mismatched grids, pause/resume intent and failed group/late-join starts.
The existing command and orderflow tests remain part of the targeted gate.

This does not establish every layout/maximize combination, sustained capacity,
all markets/calendar intervals, intrabar tick playback, paper order fill parity,
or complete Vela Orderflow parity. Publication is deferred at the user's request.
