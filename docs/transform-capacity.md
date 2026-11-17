# Bounded derived charts and recovery — 2026-10-27

Very small box sizes can expand a few source bars into millions of derived marks. The former Renko loop appended until the price move was exhausted; Point & Figure stepped and allocated each box without an output or precision bound. In an isolated baseline test, Renko with two bars at100/101 and size1e-9 exhausted the configured heap and terminated the Node test process. The application server was separate. That failure prevented a baseline Point & Figure timing run; its original unbounded loop was established by source inspection.

## Implementation

`lib/chart/transformCapacity.ts` defines a50,000-unit output budget and typed capacity/precision errors. Renko and Range check capacity and representable progress before appending. Point & Figure computes each column's box count before allocation and enforces a total budget across columns. Its indexed expansion avoids additive floating-point stalls; fractional grids include the final intended box, and indistinguishable rounded prices fail explicitly. Failure throws instead of returning a truncated financial series. No larger box is substituted automatically.

`lib/chart/derivedCache.ts` caches typed failures as well as successful calculations, so repainting identical failed input is cheap. A different data-array identity invalidates matching-endpoint history revisions; last-bar OHLCV changes invalidate live edits. Renderer disposal clears its cell's cache entries. Unknown calculation errors are not swallowed or stored as capacity failures.

`lib/chart/derivedRenderState.ts` isolates each issue by layer, owner, symbol, interval and chart type. Repeated identical failures publish once. Successful recomputation clears the issue; obsolete renderer disposal cannot clear a newer issue. Custom renderer layers finish computing before painting marks and their canvases clear before each attempt, so an aborted calculation does not leave partial or stale derived marks.

`components/DerivedChartIssue.tsx` displays an accessible alert in the affected primary/satellite chart. It explains the limit and offers a selected-family reset. Another chart, market data, loaded studies and the toolbar remain usable. Raw OHLCV and study lines remain visible as those separate series; the failed derived price series is absent. Settings are retained until the user edits or resets them, including across reload.

## Verification

- **102 files / 1,212 tests passed**, production build and standalone TypeScript passed. Logs: `artifacts/capacity-tests.log`, `capacity-build.log`, `capacity-typecheck.log`.
- Eleven new contracts cover exact Renko/P&F boundaries, cumulative P&F limits, floating-point progress, fractional grids/rounded precision, ordinary Renko reversal output, failed/successful cache invalidation, revised histories, issue deduplication/recovery, renderer-disposal ownership and propagation of unrelated defects. Existing10 transform tests also pass.
- Same isolated tiny-box input after correction: Renko returns a capacity error in about7ms; P&F in about0.2ms on this host. Recorded times are single-run observations, not device or browser performance guarantees. Before/after evidence: `transform-capacity-before.json`, `transform-capacity-after.json`.
- Actual production browser: Renko Fixed1e-9 shows the50,000-mark message, reload remains responsive, switching to Line removes the scoped issue, and ResetRenko restores computation. P&F Fixed1e-9 shows its own message.
- Mobile375: the P&F alert and full reset button fit; Reset clears the issue. Document scrollWidth375. Mobile screenshot visually inspected.
- Actual two-chart flow: failing BTC/Renko appears only in its inactive satellite section while active ETH/Candles remains usable. Reset from that satellite clears the issue and restores BTC/RenkoATR14 while active ETH/Candles stays selected. Desktop and inactive-cell screenshots visually inspected.
- Final original single BTC/5m/Candles/UTC/Dark, EMA20/Volume, watchlist and collapsed bottom retained. RenkoATR14 and P&F0.5%/reversal3 restored; no capacity issues after reload. No studies/orders/alerts created. Viewport override reset, desktop width1280 matches document width, captured warnings/errors empty and preview retained.

## Evidence and limits

`artifacts/capacity-browser.json`, `capacity-renko.png`, `capacity-pointfigure.png`, `capacity-mobile.png`, `capacity-inactive.png`, `capacity-production.png`.

This is a complete-series failure/recovery contract at an explicit resource limit, not proof of all TradingView transform formulas or history depths. The engine still uses its existing source-bar/free-slot non-time placement and Range intrabar assumptions. Every numerical input, provider, device, transformed-style readout or animation path has not been verified. Full layout/design and algorithm parity remains open; broker execution and social features remain deferred.
