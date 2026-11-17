# Native candle rendering investigation

The intermittent disappearance of older candles observed during the Session Volume Profile checkpoint remains unresolved. It also occurred after removing that study. This checkpoint adds repeatable browser evidence and opt-in diagnostics; it does not claim a candle-rendering fix or complete TradingView/Vela parity.

## Browser regression fixture

Run `node scripts/verify-native-render.mjs`, open `http://127.0.0.1:4318/`, then choose **Run 60 repaint cycles**. The server binds loopback only and serves two fixed resources. Stop it with Ctrl+C after verification.

The fixture imports the installed Vela engine and the application's actual canvas-layer registration. Both forced Canvas2D and forced WebGL2 use the same 600 deterministic, explicitly simulated candles, EMA20 and Volume. It fails if WebGL2 is unavailable rather than silently testing the fallback twice. No exchange connection, orders, alerts or workspace changes are involved.

Each run updates the forming candle 60 times, reloads and reframes history every ten cycles, and enters/exits native Replay at cycles20 and40. Both backends must expose exactly500 revealed bars during Replay and600 after stopping it. Every cycle checks red/green geometry in the older, left third of the native screenshot. A drop below35% of the initial pixel count fails the run. Volume is neutral gray, and EMA is blue, so neither can mask missing red/green candles. Before the cycles, two negative controls hide body/border/wick through native configuration; the oracle must detect their disappearance before restoring the original fixture styles.

Actual browser results on2026-10-28:

| Viewport | Canvas2D baseline / hidden | WebGL2 baseline / hidden | Result |
| --- | --- | --- | --- |
|1280×720|2242 /74|2241 /74|120 raster checks,8 Replay checks,2 negative controls passed|
|375×812|1582 /38|1582 /38|120 raster checks,8 Replay checks,2 negative controls passed|

Both final runs captured no browser warnings/errors. Reports and screenshots: `artifacts/candle-paint-{adapter,mobile}-report.json` and `artifacts/candle-paint-{adapter,mobile}-fixture.jpg`. Earlier native-only experiments are superseded by these application-layer runs.

**Limits:** Vela's public `screenshotCanvas()` performs a fresh synchronous composite before reading the WebGL buffer. This proves that native geometry can be painted after these transitions; it cannot establish that every asynchronously presented screen frame is correct. The test detects gross older-region loss, not exact pixel parity or small missing subsets. Application layers are mounted, but order-flow studies are not active in this isolated fixture. Full application lifecycle, real trade timing, tab visibility and graphics-driver interactions remain separate reproduction paths. No GPU workaround or speculative market-data change was introduced.

## Opt-in live frame diagnostics

Open the main application with `?chart-frame-audit=1` and filter console debug output by `[chart-frame-audit]`. Only the primary chart emits changed summaries: native/coordinate/host bar counts, Replay flag, visible indices, finite/nonflat counts, timestamps, scale and bounds. Without the query the hook returns immediately. Output contains chart market data, not account or credential state.

The final production browser reported600 native bars,600 coordinates and600 host bars, with201 finite/nonflat visible bars. Its full candle history was visible. Evidence: `artifacts/candle-paint-live-audit.json` and `artifacts/candle-paint-production.jpg`. Earlier reload, resize and Replay probes also failed to reproduce the missing geometry; those observations do not establish a root cause.

## Gates and next investigation

The complete existing suite passed:108 files /1,279 tests. Production build and final standalone TypeScript passed; see `artifacts/candle-paint-{tests,build,typecheck}.log`. Browser raster/Replay checks are additional evidence, not included in the Vitest total.

On the next actual disappearance, compare the audit's coherent bar counts with the presented canvas before resetting the view or requesting a native screenshot, since a synchronous repaint may heal the evidence. Full TradingView layout, order-flow behavior and source coverage remain the active objective.
