# Native chart settings and responsive dialogs — 2026-10-27

The native Symbol → Type selector now updates the workspace's chart type. Previously, selecting Line drew a line while the top toolbar still said Candles; reload then restored candles. The native choice now feeds the owning cell's existing chart state, so the toolbar, cell activation, layouts and backups use the selected type.

The bridge uses Vela0.9.0's public `priceStyle:change` event. This fires before repaint, so publication waits until the microtask boundary and checks the settled renderer value. A sequence number rejects superseded native events; a host-version fence preserves newer toolbar/layout selections. Unknown/unsupported styles and disposed callbacks are ignored. Cell ownership is resolved at write time, with missing-owner and cell-application guards. Existing host-to-renderer behavior remains in place.

Native dialogs now receive `setLayoutMode` from the same760px viewport breakpoint as the application. The full-workspace dialog uses native mobile navigation instead of retaining a180px desktop rail inside a375px screen. Narrow desktop chart cells do not independently force phone navigation. Media-query listeners detach with their chart.

Actual resize testing exposed a second native issue: rebuilding the open dialog used its original configuration, so it could show Candles while the current chart was Line. The pinned adapter refreshes the complete current config immediately before native settings re-presentation. The existing reproducible patch validates five unique anchors across five Vela0.9.0 bundles, accepts only known original/patched shapes, and safely replaces entries. The new method test executes the actual installed `NativeRenderer.setLayoutMode`, including a changed grid preference, to verify that its dialog receives the current config rather than the open-time snapshot.

## Verification

- **96 files / 1,162 tests passed**; final production build and standalone TypeScript passed. Logs: `artifacts/native-chart-type-tests.log`, `native-chart-type-build.log`, `native-chart-type-typecheck.log`.
- Nine added cases cover settled/coalesced events, duplicate/unknown/abandoned choices, newer host choices, disposal, unsupported renderers, owning-cell guards, native-origin layout/backup persistence, media-query lifecycle and the actual native responsive snapshot method.
- Reproduced in the production browser before editing: native dialog Line, toolbar Candles, reload Candles. After correction: native dialog and toolbar both Line, and reload retains Line.
- Actual two-cell flow: cell1 retains Line, cell2 changes through the native selector to Area, and returning to either retains its independent type. Cell2 restored to its original Candles afterward.
- Mobile375 native Heikin Ashi selection and reload retain the toolbar type. Final build also verifies an open Candles dialog changed to Line before switching from desktop to mobile: the rebuilt dialog still shows Line and uses `.vela-sd-mobile`.
- The final mobile screenshot was visually inspected: full-width labels/controls replace the clipped desktop rail. Native Sections → Status line exposes all six switches with left/right edges26.25/48.25; returning to desktop retains that section. Mobile document scrollWidth375, desktop1280.
- Final original BTC/5m/Candles/UTC single chart, EMA20/Volume, watchlist and collapsed bottom panel restored. No indicator, alert or order commands created. Captured warning/error logs empty; viewport reset and checked production preview retained.

Artifacts: `artifacts/native-chart-type-browser.json`, `native-chart-type-fixed.png`, `native-chart-type-mobile-before.png`, `native-chart-type-mobile.png`, `native-chart-type-production.png`. The JSON retains intermediate and final-build observations; the final responsive correction is under `responsiveFinal`, `mobileSections` and `finalBuildReload`.

This verifies the listed native selection and responsive flows. Every chart style's algorithm/data requirement, inactive-cell dialog interaction, device, cosmetic/theme setting, price-scale label preference and full TradingView settings/layout behavior remain unproven or separate work. The broader1:1 goal stays active.
