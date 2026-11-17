# Replay legend and keyboard readout lifecycle

Follow-up: [per-instance host legend values](indicator-legend-values.md) adds the numeric host-chip UI left open by this checkpoint. Its 1,131-test gate and native/PineTS browser evidence are separate; the pinned adapter now checks four anchors across five bundles.

Core-function checkpoint, 2026-10-27. The previous Data window continuation made concrete progress and exposed stale native legend/keyboard state. This follow-up resolves that specific issue; full TradingView parity remains unproven.

## Corrections

The native data window already bounds its hover index inside the currently revealed series. Vela's separate legend method still used the old index after Replay shortened the series. It now applies the same integer/range check, preserving valid historical crosshairs and falling back to the latest revealed bar for invalid/stale indices. Empty series clear legend rows normally.

The keyboard live region retained a previously spoken live-bar summary after a series replacement. Native `setBars` now clears that old text whenever it installs the replacement series, including empty and same-length replacements. It does not immediately generate a replacement announcement while indicator data may still be settling. Subsequent ordinary keyboard navigation produces the native summary for the current historical bar. The native prepend/preserve-view crosshair offset logic remains intact.

The pinned readout adapter validates three unique anchors in each of five non-minified Vela 0.9.0 bundles before writing. It supports the package's explicit four/six-space forms, runs idempotently before dev/build/test/typecheck, and replaces temporary directory entries rather than modifying shared package hardlinks. Unknown versions or missing/duplicate anchors fail for review. Package notices and the unused minified UMD bundle remain intact.

The mobile browser check also exposed missing names on the three top-bar buttons whose text is hidden at narrow widths. Indicators, Alert and Replay now have stable accessible names; Replay exposes its pressed state. Their visible layout and existing actions are unchanged.

## Verification

- **91 test files / 1,119 tests passed**, production build and standalone TypeScript passed. Logs: `artifacts/replay-readout-tests.log`, `replay-readout-build.log`, `replay-readout-typecheck.log`. The final mobile-label attributes additionally have final build/typecheck and real browser action evidence.
- Eleven added tests execute actual installed NativeRenderer methods: stale/negative/nonfinite/fractional/null legend indices, valid historical legend values, empty series, same-length/shorter/empty replacement announcement clearing and retained crosshair offsets after prepending. Together with the original native readout tests, that file has 20 passing tests; the six data-window lifecycle tests also pass.
- The adapter was run again after application with no further mutations, and each test/build/typecheck entry point exercised it again. These deterministic tests provide actual native-method evidence, not a full GPU/browser benchmark or proof for every native input path.
- Final production browser: ordinary keyboard inspection spoke the live 13:30 UTC bar (O 80,143 / H 80,143 / L 79,930 / C 80,111, EMA 80,151.96, volume 479.72). Starting Replay at 05:20 UTC cleared the native live-region text to an empty string. The next keyboard action spoke only that revealed bar (O 79,866 / H 79,875 / L 79,775 / C 79,785, EMA 79,774.55, volume 11.57), matching the chart header and Data window. No prior live price remained in the new announcement.
- At 375px, the three named buttons were discoverable and usable. Replay toggled off/on and reported `aria-pressed=true` while active. Indicators opened its dialog; Alert opened the price-alert dialog, which was canceled without creation. Document scroll width equaled 375px. Captured warnings/errors were empty.
- Native Replay exited, UTC and the original BTC/5m/Candles, EMA/Volume and five-symbol watchlist remained, bottom panel stayed collapsed and the temporary viewport override was reset. No order or alert command was created.

Artifacts: `artifacts/replay-readout-browser.json`, `replay-readout-production.png`, `replay-readout-mobile.png`.

## Boundaries

Native legend behavior is covered through its actual method because the application uses its own indicator chips, with native indicator-title UI hidden. Showing current per-instance plot values in those host chips remains separate UI work. The browser verifies the actual keyboard live region and Data window, not spoken audio in every screen reader. Every script/style/cell transition, accessible navigation pattern and exact session/indicator equivalence still requires broader verification.
