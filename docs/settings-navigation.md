# Accessible native settings navigation

## Corrected diagnosis

The previous report that the mobile **Scales and lines** page itself closed the dialog was a test-path error. The test addressed a named button in the off-screen section rail without first opening **Sections**. The normal visible Sections → Scales and lines path already worked before this change.

The underlying accessibility defect was real: the closed rail was translated off-screen but its named buttons remained exposed to accessibility and focus traversal, and the Sections button had no expanded/control relationship. `artifacts/settings-navigation-before.json` records its off-screen rectangle and missing ARIA attributes. This change fixes that exposure and makes the supported navigation explicit.

## Implementation

`lib/chart/settingsRail.ts` manages each mobile rail build. Closed navigation has `inert` and `aria-hidden=true`; its pane remains available. Opening navigation focuses the selected visible section, marks Sections expanded, and makes the covered pane inert and hidden to accessibility traversal. Closing returns focus to Sections before making the rail inert. Each build has a linked unique ID. Listeners belong to the rail and are collected when reset/resize replaces its nodes.

Arrow Up/Down, Home and End move between visible enabled sections. Enter/Space retain native button activation. The active page has `aria-current=page`. Escape first closes an open section menu and leaves the settings dialog; a second Escape closes the dialog. Native select/color popovers retain priority, so their first Escape still dismisses only the popover.

`scripts/patch-vela-settings-navigation.mjs` bundles the helper into the five pinned Vela 0.9.0 settings implementations and adapts the six dialog Escape implementations. It validates all anchors/counts before atomic file replacement and is idempotent. `patch-vela-viewport.mjs` invokes it after the existing color-picker adapter, whose Escape installation now preserves the later rail extension. Desktop sections remain directly available.

## Verification

- **1,395 tests in 117 files**, production build and TypeScript pass. Logs: `artifacts/settings-navigation-{tests,build,typecheck}.log`.
- Unit contracts verify inert/ARIA state, selected-entry focus, focus restoration, visible/enabled keyboard destinations, modified keys, repeated close and connected/unique identity. Tests extract and execute the actual native Escape callback from all six patched bundles to verify focused-dialog scoping and popover priority. All five settings bundles contain exactly one helper and current-page binding.
- Actual production browser at 375 x 812: a closed rail has inert/hidden state, Sections reports `aria-expanded=false`, and a named Scales and lines locator finds zero off-screen buttons. Open state exposes the navigation, focuses the selected page and makes covered inputs unavailable. Evidence: `settings-navigation-closed.json`, `settings-navigation-open.json`, `settings-navigation-menu.jpg`.
- Actual End → Arrow Up → Enter navigated Symbol → Canvas → Scales and lines. Escape closed the menu while preserving the Scales dialog and restoring Sections focus; the second Escape closed the dialog. Escape on the open scale-mode selector dismissed its options while leaving settings open.
- Actual Invert scale + Percent editing rendered a descending percentage price axis, survived reload, and retained its current section/values through desktop/mobile re-presentation. Evidence: `settings-navigation-scales.jpg`, `settings-navigation-inverted.jpg`, `settings-navigation-reload.txt`.
- Actual Footprint retained readable classified cells under the inverted percentage axis. Opening its section menu focused Footprint and made the covered row-size control unavailable; Escape restored the same Footprint settings pane and its controls. Evidence: `settings-navigation-footprint-inverted.jpg`.
- Final browser warning/error capture: `settings-navigation-browser-errors.json`. Regular/uninverted scale, Candles/recent view and normal viewport were restored. No orders, alerts or drawings were created.

This is browser/keyboard/accessibility-tree verification, not a physical assistive-device test. Full TradingView/Vela parity, initial large developing-profile latency, header/attribution overlap, the separate older-native-candle issue and licensed Nasdaq real-time/US-depth coverage remain open.
