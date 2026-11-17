# Local order presets

This module was completed before the priority changed to core chart functionality. Further trading expansion is deferred.

The library stores up to ten named presets. Market, limit, stop and stop-limit entry types preserve signed offsets from the appropriate side quote. Brackets support percent or tick distances, and multiple exits retain quantity shares. Applying a preset recalculates against the current symbol and side while retaining the ticket quantity. Verified venue tick/lot metadata is required; unavailable metadata produces an error. Explicit offline simulation does not initiate metadata requests.

Save and Apply only edit the library or ticket. A chart-selected preset is scoped to that tab. Shift+B/Shift+S uses the normal chart trading path: with instant placement disabled it stages a ticket; with instant placement explicitly enabled it can submit a local paper order. Shortcuts ignore editable inputs, repeats and open dialogs. No real broker connection is involved.

Library writes use a shared Web Lock, latest-storage reads and per-item revisions. Stale edits and quota failures leave the prior persisted library intact. Corrupt/future library envelopes are retained with an error instead of overwritten. Selection uses session storage separately from the shared library.

`tests/order-presets.test.ts` contains 25 math, metadata, actual-store concurrency and chart-command tests. The browser check saved, applied and removed only the temporary preset `Core check temporary`; no order or position was created and all six original live-account paper fills stayed unchanged. The final library was empty. Native presets, backup/cloud integration, validity settings, every venue filter and complete TradingView behavior are not established. Chart shortcut/instant cases are covered by code-path tests, not a new manual browser placement in this checkpoint.

References: [TradingView preset creation](https://www.tradingview.com/support/solutions/43000742710-how-to-create-an-order-preset/), [ten-preset limit](https://www.tradingview.com/support/solutions/43000742711-how-many-order-presets-can-i-create/), [Hyperliquid tick and lot rules](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size), [Binance symbol filters](https://github.com/binance/binance-spot-api-docs/blob/master/filters.md).
