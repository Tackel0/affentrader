# Native color picker verification — 2026-10-27

The shared pinned Vela palette now includes an explicit Hex color field and Apply action. Enter or Apply commits; leaving a draft unconfirmed does not change the chart. Accepted forms are #RGB, #RGBA, #RRGGBB and #RRGGBBAA (optional hash). RGB-only values preserve current opacity. Invalid drafts show a status message and aria-invalid without emitting fallback colors.

Palette/recent buttons have color names and pressed state. Arrow keys move within the ten-column palette; Home/End move to row bounds and Ctrl/Meta+Home/End to palette bounds. Enter/Space retain native selection. The opacity track exposes a keyboard slider with arrows, PageUp/Down, Home/End. The native OS chooser remains available as More colors.

Escape dismisses the popover and restores its trigger focus while the owning native settings dialog remains open. A second Escape closes the dialog. The native dialog Escape callback defers to an open popover; the popover stops immediate propagation before restoring focus.

Implementation: lib/chart/colorPickerEnhancement.ts and scripts/patch-vela-color-picker.mjs. The adapter verifies Vela0.9.0 and all six nonminified UI bundles before writing, replaces package directory entries safely and runs from the normal patch/build/test/typecheck chain. Re-running the adapter is idempotent. Licensing remains in THIRD_PARTY_NOTICES.md.

Verification: 1,224 tests across104 files passed, production build and standalone typecheck passed. Three new tests cover exact parsing/alpha, invalid drafts and navigation boundaries. Actual production browser checks cover invalid #12, #33adeb80 with50% opacity, keyboard opacity to51%/#33adeb82, reload retention, arrow focus without selection, Enter selection, Apply, unconfirmed draft Escape, dialog/focus retention and second Escape. At375x812, the page scroll width stays375 and both input and Apply remain inside the viewport (input x20..203.6; Apply x209.6..256). Contrast corrected to foreground209/212/220 on black. Captured console warnings/errors empty.

Artifacts: color-picker-tests.log, color-picker-build.log, color-picker-typecheck.log, color-picker-desktop.png, color-picker-mobile.png. Original native bullish body #089981 with100% opacity restored, other native/plugin preferences unchanged. Temporary viewport overrides reset; live production preview retained. No alerts/orders/studies created. Shared picker consumers beyond the tested candle setting, all OS chooser paths, screen-reader behavior and full TradingView/order-flow pixel parity remain unproven.
