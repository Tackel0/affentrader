# Drawing workspace and panel navigation

The left rail uses Vela 0.9.0's public `DrawingToolbar` in its workspace-docked mode. One shared rail controls the active chart. All 79 registered tools are included in the seven native groups: lines/channels/pitchforks, Fibonacci/Gann, patterns/waves, measurements, shapes, text and icons. The searchable **All drawing tools** catalog remains available below the rail.

Click a group icon to arm its last-used tool, or its chevron to open the full group. A star adds a tool to the floating favorites bar without closing the group. The floating bar uses the registered native icons; its handle supports dragging, arrow-key positioning and Home to return to the default position. Favorites persist; the floating bar's screen position resets on reload.

The native rail also exposes the temporary measure ruler, eraser, Off/Weak/Strong magnet modes, repeated drawing mode and collapse/expand. Lock/hide/remove batch buttons act on the active chart through the public drawing API; batch edits and removals use native undo steps. Collapsing the native rail releases its width from 44 px to 16 px.

To style an existing drawing, select it in **Object tree** and click **Drawing settings**. The native floating palette and full settings dialog supply the tool's actual style, text, coordinates and type-specific fields. Remembered defaults and named style templates persist through the engine's `drawing:defaults` and `drawing:templates` events. Imported values are bounded by the workspace parser and individual native entries are validated by Vela.

Shared preferences live in `useChartStore.drawingPreferences`: magnet, repeated drawing mode, favorites, last-used group tools, remembered defaults and named styles. They are included in LocalStorage, workspace exports and sync backups. The active chart receives the same settings after a layout or active-chart change. Renderer-local measure/eraser state is transient.

Drawings are archived under complete symbol IDs, including `HL:BTC` and `YF:SAP.DE`; symbol identifiers are not split on colons. Initial restoration waits for `chart.ready()`. Market transitions suppress intermediate serialization while the native chart clears/reloads its drawings, and an uncommitted transition cannot overwrite the target symbol's archive. Older malformed prefix-only archive keys are retained rather than guessed into a different market.

Host overlay updates repaint their own registered canvases using the most recent native projection. They do not call `chart.resize()` on live ticks. A genuine container resize still reaches the native renderer. This keeps drawing palettes usable while paper-account P&L, comparisons, alerts and strategy overlays update.

The bottom panel strip stays on one line. When it overflows, **More** lists all eleven panels. Arrow Left/Right and Home/End navigate the strip; the popup supports Arrow Up/Down, Home/End, Enter and Escape. Selecting a panel scrolls its tab into view. The resizer, maximize and collapse controls keep their own fixed space.

Verification: `tests/drawing-preferences.test.ts` exercises the public preference adapter and import bounds; `tests/canvas-repaint.test.ts` exercises cell isolation, coalescing, latest-projection painting and teardown. Real browser checks created and styled actual drawings, saved a named style, imported/reloaded the resulting workspace, switched between Binance and Hyperliquid, tested keyboard navigation and checked 375 px and default 1280 px views. The mobile popup exposes eleven items, measures 388 px tall and stays within the viewport; the page's scroll width remains 375 px. This is browser viewport coverage, not a physical-device test.

Artifacts include `drawing-preferences-workspace.json`, `drawing-native-styles-workspace.json`, `drawing-multi-market-workspace.json`, `workspace-chrome-light.png`, `workspace-chrome-mobile.png` and `tradingview-layout-reference.png`. The public reference and local chart use different instruments and chart contents; they demonstrate chrome comparisons, not a pixel-difference benchmark. Full TradingView drawing-catalog and pixel-exact layout equivalence remain unproven.
