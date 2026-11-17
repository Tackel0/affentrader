# Persistent chart canvas appearance — 2026-10-27

Canvas settings now persist per chart cell and separately for Dark and Light: background and text colors, font family/size, vertical/horizontal grid colors, crosshair and label inks, axis border, pane separator and top/bottom/right margins. Native UI exposes the existing engine controls; font family and crosshair label background additionally round-trip through validated backups. This does not add an unverified font-selector UI.

## Implementation

`lib/chart/appearance.ts` defines explicit bounded schemas and narrow config projections. No arbitrary native config blob enters storage. Font size6–32, margins0–40 percent and right margin0–200 integral bars match the installed engine. Colors accept bounded hex/rgb/hsl/transparent values; font strings reject control characters and CSS injection delimiters. Theme buckets are strictly Dark/Light. Missing/null preferences retain factory defaults and legacy backups remain valid.

`lib/chart/appearanceBinding.ts` owns theme application plus canvas restoration. Native `theme:changed` events update the canonical workspace theme; workspace changes and native choices use the same state path. Synchronous renderer events during restoration cannot overwrite saved values. Theme defaults use the original canvas geometry and the matching palette, so one theme does not inherit the other's edited font/margins. Missing/applying owners and obsolete theme writes are fenced. Disposal detaches native config, public chart-theme and host subscriptions.

Primary and satellite charts install the same binding. The old independent theme effects are removed to avoid overwriting restored colors. Appearance-only satellite changes are excluded from renderer recreation. Chart state, workspace-cell capture, named layouts and validated backups all retain preferences.

A browser check exposed stale numbers in the open native dialog after a theme change: the chart had switched to size12/margins10, while the dialog still displayed16/20. The pinned Vela adapter now presents theme settings after synchronous host listeners settle. It reads the latest config/theme in a microtask, preserving responsive behavior and selected section. Six known anchors across five bundles are version-checked and reproducible through the normal build scripts. Upstream license and modification notice remain included.

## Verification

- **99 files / 1,186 tests passed**, production build and standalone TypeScript passed. Logs: `artifacts/appearance-tests.log`, `appearance-build.log`, `appearance-typecheck.log`.
- Nine added tests cover strict schema/bounds, copy-safe narrow patches, native capture and startup restoration without feedback, separate theme buckets and repeated native/workspace choices, defaults/disposal, independent cells/layouts/backups, malformed imports/ownership fences, inherited/custom crosshair colors, and the actual patched `NativeRenderer.setTheme` presentation order.
- Actual before-fix browser: native text size16 reverted to12 after reload.
- Final production browser: Dark background#101828, font16 and margins20/15/25 survive reload. Light starts with font12/margins10, a Light-only font14 survives reload, and returning to Dark restores its independent values. After the adapter correction, the open dialog immediately shows the correct theme's values.
- Actual two-column flow: cell2 starts at font12/margins10; editing it to13 leaves cell1 at16/margins20/15/25. Switching back retains13. Cell2 restored12 afterward.
- Mobile375: native More chart controls/Sections/Canvas navigation exposes retained values. Right margin30 persists through reload. Document scrollWidth375; native modal scrolls to the margins. Mobile and custom desktop chart screenshots visually inspected. Desktop1280 also has no horizontal overflow.
- Original single BTC/5m/Candles/UTC/Dark, black background, font12, margins10/10/10, EMA20/Volume, watchlist and collapsed bottom restored. Explicit default preferences remain saved in the tested theme buckets. No orders, alerts or studies created. Viewport override reset and preview retained. Captured warning/error logs empty.

## Evidence and remaining scope

`artifacts/appearance-browser.json`, `appearance-dark-settings.png`, `appearance-custom-chart.png`, `appearance-mobile.png`, `appearance-mobile-margins.png`, `appearance-production.png`.

Only the stated native UI paths were exercised in-browser. Other color fields have schema/binding test coverage but were not individually edited in that browser run. Device hardware, all style/pane/provider combinations, arbitrary CSS color semantics and full TradingView settings/layout equivalence remain unproven. Per-series colors/styles, all motion controls and color-picker accessibility need separate audits. Broker trading and social features remain deferred; the full1:1 goal remains active.
