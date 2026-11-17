# Archived executions in native Orderflow studies — 2026-11-01

**Later continuation:** [completed-bar recorded Orderflow Replay](orderflow-replay.md) now feeds loaded archive prefixes to native studies during Replay. References below to unavailable Replay describe this earlier restoration checkpoint. Original-arrival/tick-by-tick replay and full coverage remain open.

The local archive now has **Load selection into native studies**. Read an interval first, then load its observed executions into Footprint, Session Volume Profile and CVD for that source-qualified market. Existing matching chart cells rebuild immediately; new studies and timeframe changes seed from the selection. Live executions continue independently.

Selections remain in this page's memory until removed or the page reloads. The dialog lists each loaded market, count and first/last observed timestamps. **Remove MARKET from studies** rebuilds affected studies from the current live buffer, without deleting recordings. Recording remains a separate opt-in setting.

## Source contract

- Only validated real classified Binance/Hyperliquid ticks inside `[from,to)` load. Fixed tick fields are copied and archived rows frozen. Invalid replacements retain the previous working selection.
- Source-qualified symbols isolate venues/markets. The archive merges with the matching live buffer, then existing subscriptions continue collecting. Overlapping immutable IDs count once. Conflicting archived/live IDs fail visibly; remove/reload resets that failure explicitly.
- Simulation uses its own stream, excluding real archived quantities. Equity candles, unclassified IEX trades and Yahoo quotes cannot become aggressor-side quantities.
- Inputs are bounded at **100,000 archived plus buffered live executions per market** and **250,000 selected archived executions across markets**. Oversized inputs fail before replacement; archive query/export limits remain unchanged. Existing per-study collection limits still apply as live data accumulates.
- Source revisions rebuild cell-owned Footprint collections and running CVD/SVP. SVP cancels pending jobs and fences stale responses. Readouts retain actual market epochs. Hidden/stopped studies detach archive subscriptions and reconstruct current inputs when shown.
- Readouts and canvas notices identify archived observations and possible gaps. They do not claim uninterrupted sessions, full exchange history or equality with candle volume. SVP remains a whole collected-session snapshot, explicitly including observations after the selected historical candle.
- CVD orders by timestamp, available exchange sequence and ID. Equal-time extrema do not establish original network arrival order. Native models retain Number arithmetic; archive exports separately retain exact canonical decimal-string totals.
- Loading/removing observations does not publish ticks into market quotes, alerts, server rules or paper fills. It changes study inputs only, without creating studies or replacing OHLCV history. Choose relevant studies/chart type and visible dates normally.

**Recorded Replay remains open.** Existing Replay guards exclude installed live selections. A separate cutoff-aware, gap-aware execution Replay adapter is still required.

## Verification

**139 files / 1,595 tests passed**, production build including TypeScript, plus standalone TypeScript. Logs: `artifacts/study-archive-tests.log`, `study-archive-build.log`, `study-archive-typecheck.log`.

Eleven new tests cover atomic replacement, copied/frozen fields, equal-time ordering, deduplication, invalid input/limits, symbol/simulation isolation, conflict latching, native Footprint quantities, running CVD/SVP load/remove/resume, Replay exclusion,100,000-execution merging and stale-worker cancellation. See `tests/study-trade-source.test.ts`.

Actual production browser evidence:

- Explicitly loaded **993 real HL:BTC observations**, with recording disabled. Footprint cells appeared before the current connection's start; CVD/SVP canvases identified archived input and new live trades continued increasing the collected count.
- At **12:20 UTC /5m**, native Footprint Data window values were **buy7.86904 / sell2.45377 / volume10.32281 / delta5.41527**, matching the previously downloaded284-trade independent decimal oracle. CVD displayed5.42 at normal two-decimal precision. Full candle volume18.11 remained separate.
- Removing the archive with all three studies active changed the historical Footprint readout to **No collected executions for this candle**, removed historical CVD values and moved SVP's first execution to the current connection. Reloading the selection restored the exact historical quantities without restarting studies manually.
- Evidence: `artifacts/study-archive-native.jpg`, `study-archive-historical.{jpg,txt}`, `study-archive-removed.txt`, `study-archive-reloaded.txt`, `study-archive-loaded-mobile.jpg`. Initial mobile loading had414px document width in a414px viewport.
- Final build reload left recording off and cleared only the session's loaded selection. Querying the still-retained993 records and loading them again restored the historical quantities. `study-archive-final-loaded.txt`, `study-archive-final-historical.{jpg,txt}` and `study-archive-page-reload.txt` retain the UI evidence. `study-archive-native-verification.json` independently compares the final Data window text against the284-trade decimal oracle. Final mobile dialog width remained414/414px (`study-archive-final-mobile.jpg`); no captured browser warnings/errors (`study-archive-browser-errors.json`). The final production server remains running and the live study selection is loaded, with recording off.

The sample does not prove sustained full-capacity rendering, every device/browser, continuous sessions, original arrival order, licensed equity coverage or full TradingView/Vela parity. The overall goal remains active.
