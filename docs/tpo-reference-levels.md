# Completed TPO POC / VAH / VAL extensions

**Evidence correction:** prior histogram-disappearance claims in this checkpoint are superseded by the [presented screenshot re-audit](tpo-presented-evidence.md). The cited captures do not prove that failure. This does not affect the independently verified mathematical features.

Native TPO settings now expose independent Extend completed POC, VAH and VAL switches, an extended-POC color and an extended-value-area color. Defaults are off. Enabled lines begin at their source session's exclusive end and continue to the visible price pane's right edge. A profile can be completely off-screen to the left while its reference lines remain visible. The extension pass is independent of the in-profile POC/VA visibility switches.

## Completion and price contract

Each session now records completion status, expected source-candle slots and missing due slots. A session is complete only after a loaded bar timestamp reveals its end and every aligned slot in the configured session window is present. Completion includes trailing slots, which the existing through-last-candle coverage measure did not count. Future slots in a developing session are not labelled missing. Partial openings, internal gaps, absent final slots and non-dividing session windows prevent a complete status. DST-shortened/extended sessions use their actual calendar windows.

This is deliberately based on the revealed data clock, including Replay, rather than wall time. A closed stock session with no later loaded timestamp can remain developing until another timestamp is revealed. Complete means full configured candle-slot coverage, not complete executions or licensed exchange data.

POC uses the canonical grid center, VAH the upper edge of the highest VA row and VAL the lower edge of the lowest VA row. A shared helper supplies both the painter and Data window. The current developing session remains separate from the latest completed reference session. The Data window names that reference's start/end and enabled exact prices. Existing cell/source/history/Replay fences remain applied.

References are stable when later candles are appended. Historical corrections or mathematical setting changes can legitimately recalculate the source profile. Display-only edits reuse session models. Older preference generations still validate and resolve defaults through the existing persistence/layout path.

The public [TradingView TPO reference](https://www.tradingview.com/support/solutions/43000725590-time-price-opportunity-charts-explained/) describes extended POC/VAH/VAL and exclusion of forming profiles from TPO alerts. This checkpoint implements the reference lines and coverage contract. It does **not** yet connect them to a dedicated TPO-alert condition. Lines continue through touches; automatic termination on touch is not implemented.

## Verification

- **1,503 tests across 132 files passed**, with production compilation, TypeScript and static generation passing. Logs: `artifacts/tpo-reference-tests.log`, `artifacts/tpo-reference-build.log`.
- Seven new tests cover canonical centers/edges, revealing the end, missing first/internal/final slots, future-slot exclusion, non-dividing sessions, 23/25-hour DST days, off-screen/inverted projection, pane bounds, independent visibility, legacy/native settings/cache reuse and reference readouts separate from the developing selected session.
- Actual production BTC/Hyperliquid, 5m, UTC: the full October 29 profile extended POC **80,113.74**, VAH **81,522.84**, VAL **79,524.48** into the October 30 chart. All three lines/labels were visible and the selected October 30 session remained developing. The earlier partially loaded October 28 profile did not become a completed reference.
- All three enabled switches survived reload. Disabling POC removed only its orange extension while the two VA lines remained. Disabling all extensions removed their Data-window fields.
- Actual Replay at October 29 23:55 showed 288/288 loaded candles but developing status and no completed reference. One Next replay bar to October 30 00:00 enabled the three reference values. They matched both a later 04:00 seek and live values exactly. Seeking backward to 23:55 removed them again. Numerical comparison: `artifacts/tpo-reference-invariance.json`.
- Screenshots and readouts use `artifacts/tpo-reference-*`. Candles, EMA20, Volume, Watchlists, UTC and 5m were restored, Replay stopped and the three new switches returned off. Final browser warnings/errors were empty.

The known histogram raster failure remained observable during the native visibility test: most blocks disappeared after idle while extension lines remained. This feature does not fix that failure or prove stable presentation in every frame. Dedicated TPO alerts, poor-extreme/single-print extensions, touch termination, mobile/native-setting combinations, complete archives, licensed Nasdaq real-time feeds and full TradingView/Vela parity remain open.

Follow-up: [fixed reference snapshot alerts](tpo-alert-snapshots.md) now connect these enabled reference values to the price-alert dialog. Automatically refreshed TPO rules remain open.

Follow-up: [stop extensions at first observed touch](tpo-reference-touches.md) adds optional independent endpoints using revealed OHLC ranges.
