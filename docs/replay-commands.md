# Replay command delivery and mobile control visibility

The previous Footprint Data-window checkpoint observed Replay remaining active after an immediate Exit / close sidebar / change style / Reset sequence. This continuation reproduced that sequence in the baseline browser. A two-step double-click already advanced two native bars in that baseline; it is not evidence of a previously broken manual double-click.

## Reproduced cause

DOM hit testing then showed that, with the phone sidebar open, the center of the Exit button hit the sidebar rather than the button. The sidebar's absolute positioning covered the Replay controls. The apparent command race was an occluded-control interaction. The first attempt to fix command delivery alone did not remove the browser symptom. No claim is made that React batching caused the originally observed Exit failure.

The sidebar is now bounded at the chart grid's actual bottom. `bindSidebarChartBounds` measures the positioning owner and chart, updates a CSS inset using ResizeObserver/window resize, and removes its observers/listener/style on close. Both relevant mobile stylesheets consume the inset; `features.css` is loaded later and previously overrode the earlier mobile bottom rule. Desktop positioning is unchanged. Replay/date/bottom-panel controls remain outside the overlay as their heights change.

## Command lifecycle

Independently, `bindReplayCommands` consumes each published command synchronously through a Zustand subscription rather than reading a single pending slot in a later React render effect. Claiming clears only the same command object. Step/play/pause/stop invoke the native API at receipt. Start/seek wait for initial history and check command revision, chart identity, owner, market, interval and feed epoch before native entry, then recheck before publishing the selected bar. A later Stop cancels entry that is still awaiting initial history. Disposal unsubscribes and prevents pending host presentation/errors.

This does not replace Vela's own cancellation of a native deep-history start already in progress, or establish every possible interleaving in its internal history loader. The existing live-return settlement remains separate in [Replay return](replay-return.md).

## Automated evidence

The suite passed **1,433 tests across 123 files**, and production build/TypeScript passed. Logs: `artifacts/replay-commands-{tests,build,targeted}.log`. Eleven command tests cover synchronous repeated steps/stop, start followed by stop, competing seeks, fresh history, source/market/owner changes, post-start presentation fencing, queued-before-bind commands, disposal, speeds and stale errors. Two sidebar tests cover geometry, expanded-control bounds and observer/event/style cleanup.

Browser evidence and final restoration are recorded with the final production check below. Baseline snapshots: `artifacts/replay-commands-baseline-{step,exit}.txt`, `replay-commands-baseline-exit.jpg`.

## Final production browser check

The final phone view measured a sidebar bottom at 1642 px and an Exit button beginning at 1648 px. After focusing/scrolled positioning of the native overflow toolbar, its center hit the actual `Exit replay` button rather than the sidebar. Evidence: `artifacts/replay-commands-hit-after.json`, `replay-commands-controls.jpg`. The toolbar retains its existing horizontal overflow behavior on narrow screens.

The exact previously failing sequence (Exit while Data window is open, close sidebar, switch Footprint to Candles, Reset) now produced Replay=false and current live BTC/5m candles on the first attempt. Snapshot: `artifacts/replay-commands-exit-fixed.txt`.

Opening the lower panel changed the measured chart/sidebar boundary from 1642 to 1272 px and the inset from 108 to 478 px; Replay's top was also 1272 px. Both controls and the lower panel stayed outside the overlay. A native double-click moved Replay from 07:25 to 07:35 on a 5m chart, retaining both steps; the baseline double-click already worked too. Expanded snapshot: `artifacts/replay-commands-expanded.txt`. No paper order was submitted; opening the panel displayed its existing ticket only.

The final focused Exit click with the sidebar still open returned to live 15:40 candles and removed the Replay bar. Candles, recent view, closed sidebar and collapsed lower panel were restored, without changing indicator parameters or applying a viewport override. Captured warnings/errors: `artifacts/replay-commands-browser-errors.json`.

This verifies the reproduced overlay failure and the documented local command contracts. It does not establish full TradingView parity, every deep-history/native-start cancellation ordering, complete trade archives or a fix for the separate intermittent native candle issue.
