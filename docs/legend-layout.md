# Indicator legend layout — 2026-10-27

The chart heading now gives each study its own row. A compact arrow folds the legend without removing studies or stopping their plotted calculations. The folded count reflects current study instances. Desktop controls appear on hover or keyboard focus; narrow single-chart views expose an explicit actions button with visibility, settings and removal commands in a dialog outside the chart clipping context.

The display preference persists in chart storage, individual workspace cells, saved layouts and validated backups. Older backups without this optional field remain accepted. Cell/layout application suppresses intermediate automatic captures across the chart and workspace stores; otherwise the newly active cell could capture the outgoing chart's settings. Removal from the mobile actions dialog restores focus to the legend arrow, or the Indicators toolbar button when no studies remain.

Reference behavior: TradingView documents its [legend folding and hover controls](https://www.tradingview.com/blog/en/the-new-chart-legend-redesign-14700/) and [indicator settings/removal](https://www.tradingview.com/support/solutions/43000506677-how-do-i-remove-or-customize-an-indicator/). These references guide this surface; complete product parity is not established.

## Verification

- 92 test files / **1,134 tests passed**. Production build and standalone TypeScript passed. Logs: `artifacts/legend-layout-tests.log`, `legend-layout-build.log`, `legend-layout-typecheck.log`.
- Three additional contracts cover optional/legacy backup validation, independent cells and saved layouts, and capture subscriptions during cross-store application. The last test reproduces the browser-discovered transition race.
- Actual production browser: desktop studies occupy separate rows at y115/y137, no document overflow at1280px. Folding survives reload and reports count2. After the race correction, cell1 returns folded while cell2 remains expanded.
- At375px, explicit actions open, EMA hide/show isolates its values, settings opens Length20, and removal of a temporary SMA restores focus to the legend arrow. Document scrollWidth375. Temporary study removed; original EMA20/Volume restored.
- Final original BTC/5m/Candles/UTC single chart with watchlist, expanded legend and collapsed bottom panel. No alert/order commands created. Captured warning/error logs empty. Production server serves the checked build.

Evidence: `artifacts/legend-layout-browser.json`, `legend-layout-production.png`, `legend-layout-collapsed.png`, `legend-layout-mobile-actions.png`, `legend-layout-mobile.png`. Browser viewport override reset after capture.

Small multi-chart cells retain their existing compact heading policy. This verifies the tested active-cell transitions and mobile single-chart controls, not every device, layout combination, script, native pane legend or complete TradingView interaction. Native per-instance plotted-value evidence remains in [the preceding checkpoint](indicator-legend-values.md).
