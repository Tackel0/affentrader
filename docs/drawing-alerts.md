# Linked drawing alerts

Choose **Drawing** in Create alert, or use the bell beside an object in the Object tree. The dialog selects a price-pane drawing, target, operator, trigger cadence, expiration, sound and browser/server execution. Drawing alerts have their own editable subscription; creating one no longer immediately enables a hard-coded line alert.

Fib targets and alert summaries show the actual calculated price with the workspace's normal price formatting. The Object tree reserves action space so hovering cannot move the label under the pointer into a Hide/Delete control. Selecting a drawing by keyboard also reveals its actions. Checkbox labels in the alert forms remain beside their controls.

Supported native Vela tools:

- Trend line, ray, extended line, info line, trend angle, horizontal line/ray and the price arm of a cross line: crossing, crossing up/down, greater than and less than.
- Fib retracement, Fib extension and trend-based Fib extension: one enabled level, any enabled level, or a zone between two enabled ratios. Custom level labels appear in generated messages. Reversal and negative/extension ratios are preserved. Each observed update produces one alert event even if several selected levels cross.
- Parallel, disjoint and flat top/bottom channels, regression channels and rectangles: entering, exiting, inside and outside.
- Anchored VWAP: the midline, upper/lower deviation line, or the band channel, using the native HLC3 and volume-weighted variance convention. A wholly zero-volume window uses the native equal-weight fallback.

The browser and Node evaluator use the same geometry pipeline. Sloped drawings use actual candle positions, including gaps between sessions, and the chart's captured linear/log projection. Their line extensions follow the native drawing settings. Channel fills include the disjoint tool's end caps; rectangles include both time and price bounds. Fibonacci price levels remain observable beyond the drawing's displayed width.

## Logarithmic Fibonacci construction

On a logarithmic price axis, native Fib retracement, Fib extension and trend-based Fib extension settings expose **Fib levels based on log scale**. The default remains arithmetic. With the option enabled, the canvas and alert evaluator share `lib/drawings/fibonacciMath.ts`: a retracement uses `exp(log(B) + ratio * (log(A) - log(B)))`; reversal swaps its endpoints. Trend extensions project the signed log-price distance from the third anchor. Both the axis and drawing option must be enabled. Returning to a regular axis uses arithmetic levels while remembering the preference. Positive finite prices are required; unrepresentable levels are omitted from painting and rejected for selected alert targets.

The runtime registry extension preserves Vela's actual drawing classes, painter, settings, hit testing, serialization and undo path. Original package files are unchanged. Native level fills and labels use the same construction. Trend-based extensions additionally support reversal and left/right extension. The option survives drawing JSON and style templates. Chart log axes are independent per cell and survive named layouts, workspace backups and reloads.

New alerts capture the local owning chart cell as well as the full symbol/drawing identity. Changing that cell's axis updates the linked condition and quietly rebaselines observations. A different chart displaying the same symbol does not take over its axis. Older subscriptions without a cell retain their captured projection until explicitly rebound in the dialog. Missing owner cells retain the last captured projection. This is local chart context, not distributed ownership between devices or multiple main tabs.

## Following edits

The binding is `(full symbol identifier, drawing id, native tool type)`, so `dw-1` on Binance and `dw-1` on Hyperliquid do not collide. Hiding a drawing does not disable its alert. Moving anchors, changing Fib ratios/labels or changing VWAP band settings updates the bound condition. The observation baseline is re-established without a notification caused only by moving the drawing. Existing rate counts, last-firing cadence gates, expiration and webhook credentials remain intact.

Deleting the drawing, replacing its identity/type or disabling a selected Fib level stops the alert visibly with a drawing reason. Its last usable geometry is retained for inspection and backup. Restoring it or re-enabling the level repairs availability while leaving the subscription stopped; explicitly restart it to begin another run. Saving changes in the alert dialog also starts a new run. Legacy alerts created by the earlier line-only bell retain their frozen numeric/line conditions.

Local and server geometry updates compare the previous source revision, including missing/disabled drawing states. An older chart cannot overwrite a newer bound drawing merely by loading or editing it; conflicts are shown for explicit review. Server updates use an authenticated, geometry-only compare-and-swap PATCH and retain authoritative status, counters and credentials. Only an observed local drawing/owning-axis edit queues an update. Rapid local edits are coalesced along a continuous revision chain. Server edits need an open main tab and a connected key; while tabs are closed, the server keeps its last acknowledged geometry. [Browser alert ownership](browser-alert-ownership.md) elects one evaluator while permitting serialized edits from standby main tabs. Popouts do not publish updates. Cross-device conflict review remains separate from distributed drawing ownership.

## Observation and data boundaries

Crossings compare the current price and geometry with their matching previous observation. Intrabar VWAP and regression values are stored with the observed price in server edge state, rather than recomputed from a later forming candle after a restart. Drawing edits and source changes rebaseline without firing. Candle-close alerts use confirmed bars at their own boundary. Historical warm-up produces no notification.

Time-based intervals are supported. Anchored calculations and sloped candle-grid geometry require the complete actual anchor history, with the existing 20,000-bar request cap and provider availability limits. Missing history makes the condition unavailable rather than substituting a shorter VWAP or inventing candles. Anchors outside the provider's history must be moved or evaluated with an interval that supplies their full window. Browser execution requires an open main tab; the Node runner observes provider snapshots every 15 seconds, not every intervening tick.

These alerts are functional local implementations checked against Vela 0.9.0 geometry. Exact TradingView drawing/session/time-domain conventions, full native equivalence of all Fibonacci settings, alerts on every other drawing family, every non-time chart style and hosted continuous observation remain unproven or outstanding.

## Verification

`tests/drawing-alerts.test.ts` compares native Vela Fib levels, channel segments, regression fitting and VWAP/deviation values, including reversed Fib ratios, session gaps, log projection, disjoint end caps and zero volume. It also checks transitions at equality, rectangle time exits, prior intrabar samples, edit rebaselining, disabled-level stops, explicit repair/restart, backup validation, history planning and the actual browser-rule dispatcher.

`tests/drawing-alert-server.test.ts` uses temporary JSON directories and actual module reloads. It covers durable crossings and intrabar VWAP samples, authenticated geometry updates, stale revisions, in-flight edits, preserved rate/timing/secret fields, removal and repair.

`tests/fibonacci-construction.test.ts` exercises actual registered Vela drawings, geometric levels, native fill bands, hit testing, reversals, numeric bounds and JSON/template restoration. `tests/price-scale.test.ts` checks axis ownership, renderer/store synchronization, layout switching and backup validation. Server tests include axis-change rebaselining and log geometry after module restart. `tests/debounced-storage.test.ts` checks that unchanged hot market snapshots in another main tab cannot overwrite a newer persisted drawing; simultaneous intentional edits still require explicit ownership/conflict handling.

Comparison references: [TradingView technical alerts](https://www.tradingview.com/support/solutions/43000763315-getting-started-with-technical-alerts/), [Fibonacci drawing alerts](https://www.tradingview.com/blog/en/alerts-on-fibonacci-drawings-58692/), and [Fib retracement settings](https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/). These describe the target behavior, not evidence of full service equivalence.
