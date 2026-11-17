# Native chart data window

Current follow-up: [per-instance legend values](indicator-legend-values.md) shares the native binding with host chips, adds stable ids/separate plot surfaces and disambiguates native studies by length in the Data window. Its 1,131-test and browser evidence are separate from this original checkpoint.

Follow-up: [Replay legend and keyboard lifecycle](replay-readouts.md) resolves the cached keyboard-announcement issue identified in this checkpoint and extends the pinned adapter to three validated methods. Its 1,119-test gate and mobile-button/browser evidence are separate from the original results below.

Core-function checkpoint, 2026-10-27. Full TradingView layout/behavior parity remains unproven; live broker/social expansion remains deferred.

## Implemented behavior

The Object tree sidebar now has Object tree and Data window tabs, with arrow/Home/End navigation and one keyboard tab stop. The selected tab is retained within the running workspace session; it is transient rather than part of saved preferences/backups. The existing object tree actions remain available.

The Data window uses Vela's public `renderer.dataWindowReadout()` surface. It shows chart-zone date/time, OHLC, volume and every returned indicator plot grouped under its native title. It keeps the renderer's per-pane formatting and plot colors, including plots exposed only to the data window; it does not recompute indicators from a separate dataset. Off the plot it reads the latest chart-series bar; in Replay that series is the revealed prefix.

The lifecycle adapter follows the primary chart, crosshair, native loads, bars, study changes, Replay and renderer configuration. Callbacks coalesce after native mutation; a 250ms read-only refresh catches native plot computations that settle after a bar callback. Identical views do not republish. Snapshots copy mutable rows, and chart replacement/sidebar closure removes listeners, timers and queued work. Identity mismatches, loads, errors and interrupted live history hide stale values. Replay uses its own revealed native surface while live recovery is pending.

The real browser test exposed a Vela 0.9.0 edge case: a hover index from a longer live series can lie beyond the shortened Replay prefix. The native data-window method then returns an empty bar instead of its latest revealed bar. `scripts/patch-vela-readout.mjs` bounds that index inside the data-window method, retaining valid historical crosshairs and falling back only for invalid/stale indices. It checks the exact package version and one unique full method anchor in each of five non-minified ES/CJS/UMD bundles before writing. Four/six-space bundle forms are explicit; unexpected shapes fail. Replacement uses new temporary files, preserving shared package hardlinks and notices. The minified UMD bundle is not consumed by this application and is unchanged. The existing pre-dev/build/test/typecheck viewport adapter invokes this idempotent readout adapter.

## Evidence

- **91 test files / 1,108 tests passed**, production build and standalone TypeScript passed. Logs: `artifacts/data-window-tests.log`, `data-window-build.log`, `data-window-typecheck.log`.
- Six lifecycle tests cover native formatting/copy isolation, coalescing/deduplication, identity/loading/recovery/error gates, Replay context, delayed native plots, zone changes, empty surfaces and full cleanup.
- Nine tests call the actual installed NativeRenderer data-window method, covering stale/negative/nonfinite/fractional/null indices, valid historical hover, Replay truncation without future-bar access and the native empty-series response. Deterministic hosts provide bars and pane callbacks; these tests are not a full GPU/DOM session.
- Production browser with actual Hyperliquid BTC/5m data: keyboard crosshair moved the header and data window to 13:15 UTC, with matching OHLC/volume and native EMA. A temporary native RSI (14) study appeared with values on its own scale (e.g. 59.25), and Object tree/Data window tabs switched via Home/End. The final live Open/High/Low/Close numeric comparison against the header passed for all four fields.
- Native Replay started after an existing live hover: after the pinned fix, the data window immediately showed 05:10 UTC with O 79,741 / H 79,823 / L 79,740 / C 79,794, volume 7.68, EMA 79,763.71 and RSI 50.68. Stepping and switching the chart to Europe/Berlin displayed 06:15 in both Replay controls and data window; OHLC, EMA, volume and RSI advanced together. Temporary RSI was removed afterward and its data-window group disappeared, leaving original EMA/Volume.
- Actual Reconnect replaced the readout with “Waiting for uninterrupted candle history.” Fresh history restored values. Captured warnings/errors were empty. No alert or order command was created. Replay exited, UTC restored, original watchlist shown and bottom panel remained collapsed.
- At exactly 375px, document width/scroll width were both 375px; the responsive sidebar measured 292.5px and data-window rows fit. The 1280px desktop also had no horizontal overflow. Temporary viewport overrides were reset.

Artifacts: `data-window-browser.json`, `data-window-crosshair.png`, `data-window-replay.png`, `data-window-recovery.png`, `data-window-mobile.png`, `data-window-production.png` under `artifacts/`.

## Boundaries

This verifies actual EMA/Volume/RSI and the native generic readout contract, not every plot from every script/indicator, chart style, multi-chart transition or device. Native formatting remains subject to Vela's current precision and time display. The separately cached native keyboard announcement discovered here is cleared by the follow-up linked above, which also bounds native legend indices. Complete screen-reader lifecycle and host indicator-chip values still require broader work. The data-window readout uses the revealed series and bounded index. Full TradingView parity remains open.
