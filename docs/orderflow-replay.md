# Recorded Orderflow in completed-bar Replay — 2026-11-01

2026-11-06 follow-up: `kraken-recorded-replay.md` adds actual Kraken recording,
reload and native Footprint/CVD/SVP Replay acceptance with independent decimal
archive/tape/readout checks and explicit CVD display-precision limits. The older
Hyperliquid checkpoint below remains separate evidence.

Loaded execution archives now drive native **Footprint, Session Volume Profile and CVD during Bar Replay**. Select and load an interval in the local archive, then start Replay and select a date. **Recorded orderflow** on the Replay toolbar opens the same archive dialog, including while playback is paused.

## Clock and data boundaries

- Each chart binds its public Vela `DataControl` identity to its own Replay clock. A native indicator's `context.data` resolves that owner, not another cell's clock. Symbol/timeframe mismatches, absent clocks, carried loading states and tick-bar intervals do not receive recorded executions.
- The exclusive execution cutoff is the calendar end of the last completed Replay candle. For a forming intrabar candle (`nextTime === cursorTime`), the cutoff is its opening time: its classified executions remain hidden until it completes. CVD's forming slot is explicitly missing. Calendar months use actual calendar boundaries.
- The adapter uses only the explicitly selected, immutable archive prefix with `tick.time < cutoff`. It never falls back to a live buffer or appends incoming live executions during Replay. Real archived quantities are excluded from simulated/unknown-source chart history; the runtime requires an exchange source.
- Advancing, seeking backward, changing inputs, changing intervals and replacing/removing a selected archive rebuild affected quantities from the appropriate prefix. Session-profile jobs are cancelled/fenced when the cutoff changes; obsolete responses cannot republish a later profile. Hidden/stopped studies detach archive listeners.
- Footprint and profile Data window surfaces carry the exact Replay cutoff. Stale surfaces from another cutoff or live mode are hidden. Native CVD restart/output alignment follows Vela's revealed canonical bars. Footprint automatic grid input uses revealed candle prices during Replay instead of the current live quote.
- Profiles are collected-session snapshots only through the current Replay cutoff, including observations after an older selected crosshair candle. They are neither that candle's volume nor historical signals.
- Missing recorded candles remain **unknown**, not zero observed market activity. CVD carries the cumulative sum of observations already revealed across recording gaps; this does not establish that actual exchange delta was unchanged. Notices explicitly identify partial coverage and unknown gaps.
- Native Number arithmetic, existing collection limits and sequence/ID ordering remain in place. The archive's exact decimal export is separate. Equal timestamps do not establish the original network arrival path.

No historical execution is published into live quotes, alerts, server rules or paper fills. OHLCV Replay remains Vela's own candle history; execution archives do not replace its candles or create a new tick feed.

This implements completed-bar recorded analysis. **Original-arrival/tick-by-tick playback, complete session/exchange coverage and full TradingView/Vela parity remain open.** Forming SDK intrabar candles are deliberately withheld rather than presenting the completed candle's future execution totals.

## Native clearing defect found during browser verification

Actual removal of a selected archive while Replay was paused reproduced a stale CVD axis/legend/Data window value after emitting an empty native model. In pinned Vela0.9.0, the previous renderer data buffers remained visible. `cvdOutput.ts` now overwrites the existing series IDs with explicit missing slots; candle output also clears all four readout aliases. The same clearing path handles missing archives/clocks and calculation errors. Production browser removal now leaves no prior CVD numeric value; reloading the archive restores it without a Replay step. `orderflow-replay-removed.txt` records the before-fix defect; `orderflow-replay-cleared.{txt,jpg}` records the corrected behavior.

## Verification

**140 test files /1,609 tests passed**, production build including TypeScript, plus standalone TypeScript. Logs: `artifacts/orderflow-replay-tests.log`, `orderflow-replay-build.log`, `orderflow-replay-typecheck.log`.

Fourteen new tests cover calendar/exclusive boundaries, forming candles, independent chart identities, stale/unbound contexts, immutable archive-only prefixes, CVD forward/backward seeks and source changes, missing output for each plot style, native Footprint quantities, live-feed exclusion, SVP cutoff/rebuild behavior, stale background responses and readout cutoff validation. Existing precision/error tests now require explicit missing series instead of an empty output object.

Actual production browser, source-qualified HL:BTC with993 stored real observations and recording off:

| Replay candle | Exclusive cutoff UTC | Revealed executions | Session buy | Session sell | Session delta |
| --- | --- | ---: | ---: | ---: | ---: |
|12:15|12:20|0|unavailable|unavailable|unavailable|
|12:20|12:25|284|7.86904|2.45377|5.41527|
|12:25|12:30|284|7.86904|2.45377|5.41527|
|12:35|12:40|797|17.94799|6.34303|11.60496|
|12:40|12:45|983|20.42795|7.9804|12.44755|
|back to12:20|12:25|284|7.86904|2.45377|5.41527|

The12:25 candle had no recorded Footprint and explicitly displayed the missing-history notice, while observed cumulative CVD remained5.42. All profile counts, buy/sell totals, volume, delta and cutoff strings at six checkpoints match independent .NET decimal sums of the previously downloaded real executions (`orderflow-replay-expected.json`, `orderflow-replay-verification.json`). Later13:13 observations and current live trades were excluded.

Removing/reloading an archive while Replay was paused cleared/restored all three native studies. Changing5m to1m carried the clock to12:24 with the same exclusive12:25 cutoff and284 observations (`orderflow-replay-one-minute.txt`). A simulated-source Replay with the real selection still installed exposed no classified Footprint, CVD or profile quantities (`orderflow-replay-simulation.txt`); the data source was returned to Live/auto afterward.

Source snapshots: `orderflow-replay-{before,first,gap,second,third,backward,restored,cleared}.txt`. Rendered evidence: `orderflow-replay-first.jpg`, `orderflow-replay-desktop.jpg`.

Final production recheck after the earlier local server process ended: the server was restarted only after its process handle was missing and port3000 had no listener. Fresh exchange history, the retained993-record selection and12:40 Replay reproduced983 revealed observations with delta12.44755 (`orderflow-replay-final.{txt,jpg}`). Mobile width was414/414px with no document overflow; the horizontally scrollable Replay controls opened the archive successfully (`orderflow-replay-mobile.jpg`, `orderflow-replay-mobile-archive.jpg`). The final browser capture contains no warnings/errors (`orderflow-replay-browser-errors.json`). Recording remains off and Replay is paused; no alert/order commands were issued.

The real browser sample does not prove sustained full-capacity playback, every browser/device, intrabar SDK tick-source integration or original exchange arrival order. The forming-bar and obsolete-worker invariants were tested with controlled public-context fixtures, not an externally injected production tick source.
