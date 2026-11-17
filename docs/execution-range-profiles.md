# Classified Fixed and Visible Range profiles — 2026-11-01

Continuation: [Visible Range Profile inspection](visible-profile-readout.md) adds actual painted numeric values to the Data window and enables independent VRVP instances in the catalog, verified with 1,635 tests and production desktop/mobile checks.

Fixed Range Volume Profile drawings and the app's VPVR study now offer **Volume source: OHLCV estimate / Classified executions**. Existing workspaces default to the estimate. The selected source persists in native drawing properties and study inputs. This extends the previous [range construction](range-profiles.md) and [completed-bar Replay adapter](orderflow-replay.md).

## Quantities and time boundaries

Classified mode assigns each observed buy/sell execution to its actual price row. It does not distribute candle volume or infer aggressor direction from candle bodies. Rational decimal grid boundaries determine row membership. Canonical decimal integer accumulation produces buy, sell, total and delta before conversion to chart Numbers. POC and adjacent-row value area use observed total volume. Developing POC/VA rebuild each candle prefix using only prices and quantities revealed by that prefix; later extrema and decimal precision cannot change earlier results.

The range includes whole selected candles: from the first opening timestamp up to, but excluding, the calendar end of the final selected candle. Fractionally visible candles count in VPVR. Replay additionally clips bars and archived executions to the owning cell's completed-candle cutoff. Tick intervals and unknown source/clock states fail explicitly. Replay never falls back to current live trades. Simulation uses simulated observations only, without a real archive. Live exchange mode merges the selected archive and current classified tape with exact ID deduplication. Conflicting identities, mixed markets/sources, malformed executions and unsupported numeric grids are rejected.

Coverage remains partial: a missing range is unknown, not zero market volume. The chart identifies its source, observed trade count, buy/sell quantities, delta and Replay cutoff. Missing/invalid selections clear geometry and display a notice. These quantities are provider-native units for the selected market, not a consolidated exchange tape or proof of continuous recording.

## Responsiveness and native integration

The native Fixed Range drawing retains anchors, hit testing, rows, colors, width, value area, POC, developing lines and persistence. Classified price extents come from observations rather than the free anchor's Y coordinate. A discovered legend hit-testing defect was corrected: transparent legend space no longer intercepts native drawing-toolbar clicks; visible legend rows remain interactive.

Large classified ranges run in the existing bundled profile worker above 10,000 executions; developing Fixed Range profiles also use it above 200 candles. While pending, obsolete geometry is hidden. Commits compare anchors, options, source mode, market generation, archive revision, Replay cutoff, selected bars and immutable whitelisted execution snapshots. Late responses cannot replace another selection. Source-mode switches release the worker's previous math cache. Coalesced archive/tick subscriptions repaint without requiring another candle. Replay ignores incoming live ticks; disconnected canvases detach.

Bounds: 100,000 executions per calculation, 50,000 static candles, 5,000 developing candles, at most 500 rows. Worker pending classified jobs have a 250,000-execution aggregate budget and 64-owner queue; worker caches and main-thread drawing math caches have their own bounded budgets. Subscription owners are bounded separately. These are separate safeguards, not a claim of one global memory cap across every subsystem.

## Verification

- Full suite: **1,626 tests across 142 files**. Cases include exact row boundaries, canonical totals/delta, future-extrema/precision isolation, old-record repairs, backward seeks, malformed/conflicting/mixed input, calendar boundaries, native schema/persistence, visible selection/painter behavior, tick/archive notifications and obsolete worker response rejection.
- The actual bundled worker handles a 15,000-execution/300-prefix fixture and source-mode changes. A model test covers 100,000 executions and 1,000 developing candle prefixes. This is not a maximum-capacity browser/device latency guarantee.
- Production-browser native dialog successfully changed the Fixed Range source and enabled developing POC/VA. At the completed 12:40 UTC 5m candle, Fixed Range and VPVR both showed **983 observations, buys 20.42795, sells 7.9804, delta 12.44755** from a loaded real Hyperliquid BTC archive. VPVR total was **28.40835**. The OHLCV estimate for the same five candles was **129.9141**, demonstrating that these sources are distinct.
- Seeking back to the completed 12:20 candle reduced both profiles to **284 observations, buys 7.86904, sells 2.45377, delta 5.41527**, matching the independently checked archive prefix. Development lines and native geometry painted in the actual production canvas.
- A page reload retained **Classified executions** and developing settings in the native drawing dialog; VPVR retained its selected source too. Archive selections are intentionally session memory and must be loaded again after reload. Recording remained off. The previously hidden SVP was restored after testing.
- At the normal 414px viewport, the VPVR settings source/help remained accessible and document width equaled viewport width. Browser console inspection reported no warnings/errors during this check. This does not establish exhaustive mobile native-dialog or exchange/device coverage.

Artifacts: `artifacts/execution-range-tests.log`, `execution-range-build.log`, `execution-range-native-settings.jpg`, `execution-range-restored-settings.txt`, `execution-range-fixed-developing.jpg`, `execution-range-backseek.jpg`, `execution-range-vrvp.jpg`, `execution-range-mobile-settings.jpg`.

Full TradingView/Vela parity, complete historical exchange coverage, original-arrival/tick-by-tick Replay, and authenticated equity-feed verification remain open. IEX observations do not supply classified aggressor orderflow or consolidated Nasdaq depth.
