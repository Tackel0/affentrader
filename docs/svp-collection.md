# Collected Session Volume Profile history

Session Volume Profile now owns its classified execution collection instead of rebuilding exclusively from MarketService's rolling 5,000-trade display tape. The native subscription forwards each execution before scheduling a repaint. Re-reading a tape merges by execution ID, so a normal tape rollover cannot erase volume already observed by this study.

`lib/orderflow/profileTradeCollection.ts` copies accepted executions, rejects invalid inputs and separates simulated and exchange sources. Each indicator instance retains at most 100,000 unique executions. Exceeding that bound latches a visible error and removes the profile rather than presenting a truncated session subtotal. Remove and re-add the study to restart collection. A source reset clears the collection; stale callbacks after suspension or disposal cannot add executions.

Input and style edits retain the collection. Model-affecting edits rebuild from the collected executions; display-only edits reuse the model. Hide/show preserves the existing collection and merges the current tape on resume. Trades that arrive while the study is suspended can only be recovered from that tape; a gap longer than its retained history remains incomplete. Native recreation, market transitions and page reload start a new collection. This is bounded in-memory observation, not an exchange archive or persistent history. Replay still requires recorded classified trades and does not substitute live trades or OHLCV estimates.

The shared session calendar caches exact resolved session windows. It preserves inclusive starts, exclusive ends, weekday rules and IANA/DST boundaries without rounding event timestamps. Repeated executions within a known window avoid repeated timezone formatting. This also benefits consumers of the same calendar, including CVD. Cached and fresh calendars are compared in both chronological and reversed order across New York and Berlin DST transitions and UTC overnight sessions.

Trade updates are coalesced with a collection-size-dependent delay of 16–250 ms. Model calculation is still synchronous. The local deterministic simulation in `scripts/verify-svp-collection.mjs` retained exactly 100,000 executions and 100,000 quantity units; ingestion took 31.6 ms and five model builds took 25.2–57.8 ms. These are local synthetic timings, not a UI latency guarantee. Gap-heavy calendars, multiple simultaneous studies and large full recalculations need further responsiveness work.

## Verification

- Full suite: **1,441 tests across 124 files**; production build and TypeScript passed. The final opt-in renderer diagnostic was production-built and browser-tested after the suite.
- Eight new cases cover 6,500-execution/full-batch equivalence, copied source isolation, source switching, capacity failure, the actual descriptor's direct-tick/tape-rollover/settings/suspend/resume/disposal lifecycle and four calendar boundary configurations.
- Actual Hyperliquid BTC/5m browser checks covered settings, Session-end placement, histogram off/on, hide/show and recent-view reset. The live caption exceeded **5,000 collected executions** while retaining the partial-history notice. The temporary study was removed and the original EMA/Volume scene restored afterward.
- Saved histogram-on/off images provide a negative control: the plot ROI contained 3,587 blue histogram-color pixels with the histogram enabled and zero with it disabled. Prices changed between captures; this confirms visible rendering, not exact pixel parity. No speculative histogram rendering fix was made.
- Optional `?svp-frame-audit=1` logs changed projected profile geometry for investigation. Normal URLs do not emit these diagnostics.

Evidence is saved under `artifacts/svp-collection-*`, including test/build logs, synthetic timing JSON, live screenshots and geometry diagnostics. Full TradingView/Vela parity, complete classified exchange history, licensed Nasdaq real-time data and the separate intermittent older-candle investigation remain open.

Large-model calculation is subsequently moved off the UI thread in [Background Session Volume Profile calculation](session-profile-worker.md); the synchronous timing above records the earlier implementation.
