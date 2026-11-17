# Persistent price-scale modes

The native Regular, Percent, Indexed to 100 and Logarithmic selections now survive reload and belong to their chart cell. The former bridge retained only the log flag, causing relative modes to revert to Regular after reload.

`lib/chart/scaleMode.ts` defines the shared selection and invariant: logarithmic means absolute price mode; selecting either relative mode clears logarithmic state. `lib/chart/priceScale.ts` applies the public native mode/log pair atomically, captures native changes, normalizes legacy log-only mixed states and fences updates during workspace application or after owner removal. The legacy renderer fallback still supports its log feature. Primary and satellite charts share the owning-cell host. View-only satellite changes do not rebuild the data session.

Chart state, cell switching, named layouts and validated workspace backups include the mode. Older backups without this field remain valid. Unknown modes and incompatible imported relative/log pairs are rejected.

## Verification

- 98 test files / 1,177 tests passed. Seven new cases cover normalization, central setter coherence, atomic binding and cleanup, independent cells/layouts/backups, malformed imports, legacy compatibility and ownership fences. The log-only mixed renderer case is a unit test; an actual native L-button click was not claimed.
- Production build and standalone TypeScript passed. Logs: `artifacts/scale-mode-tests.log`, `scale-mode-build.log`, `scale-mode-typecheck.log`.
- Actual browser first reproduced Percent reverting to Regular after reload. Percent and Indexed to 100 now each survive reload. Cell1 Indexed and cell2 Log remain independent. Cell2 Log to Percent survives reload without rebounding. The final production build also passed a fresh Percent/reload check.
- Actual price-axis clicks in Percent and Indexed each opened an alert draft with raw price 80280.828; mobile Percent produced raw price 80322.114. All drafts were canceled. These are observed coordinate prices, not percent/index thresholds. Native engine math remains responsible for transforms.
- Mobile375 retains Percent after reload and native Sections navigation; document width remained375. Desktop1280 also had no horizontal overflow. Desktop indexed and restored-production screenshots were visually inspected.
- Original single BTC/5m/Candles/UTC, Regular scale, EMA20/Volume, watchlist and collapsed bottom panel restored. Both tested cells restored Regular. No new orders, alerts or indicators were created. Viewport override reset; preview retained. Captured warnings/errors were empty.

## Evidence and limits

`artifacts/scale-mode-browser.json` records before/after and final-build checks. Screenshots: `scale-mode-percent.png`, `scale-mode-percent-alert.png`, `scale-mode-indexed.png`, `scale-mode-mobile.png`, `scale-mode-production.png`.

This persists the selected mode, not a viewport or relative baseline. The native engine chooses its baseline. Every pane, chart style, provider and native log control has not been browser-tested. Complete TradingView settings and layout parity remains open; broker execution and social features remain deferred.
