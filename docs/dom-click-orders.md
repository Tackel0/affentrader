# DOM click-order interaction

Reference: https://docs.luxalgo.com/platform/workspaces/order-book
(Order book / Click to trade, inspected 2026-11-06).

The DOM ladder now starts locked on mount/reload. Explicit Click to trade unlocks
its Bid/Ask placement buttons and turns amber. Market/source/timeframe, selected
cell or paper-account-context changes relock the ladder. Working-order cancel
controls are unchanged. Header market buttons remain separate explicit actions.

An unlocked row's tooltip identifies side, type, quantity and price. Buy below
the reference and sell above it prepare limit orders; buy above and sell below
prepare stop orders. Equal prices prepare limits. The existing fresh trade /
book-midpoint reference policy is used; its exact Vela fallback equivalence is
not established. The clicked absolute price is frozen as the limit or trigger,
not silently recomputed when the market subsequently moves.

Ask before placing defaults on. The dialog displays the frozen side/type,
symbol, quantity, limit/trigger price and absence of automatic exits. Cancel and
Escape dismiss it without placement. Explicitly disabling Ask uses the same
guarded command path. Mount/reload restores the default. Quantity/grid changes
invalidate an open preview; source/account/cell changes also relock. A synchronous
submission latch prevents duplicate in-flight UI submissions.

`placeDomReviewed` clones the draft and its review before the paper-account
ownership wait. Inside that transaction it rechecks symbol, timeframe, feed and
market epochs, source, selected cell, paper mode/epoch and current ticket quantity,
plus current matching non-simulated depth freshness. Replay and simulation cannot
pass by presenting matching stale context. A changed context or stale depth does
not place the order. The normal broker remains responsible for execution and
order validity. No exchange/broker credentials or real-money routing are added.

Four pure draft/review regressions cover six side/price cases, market drafts,
invalid quantities/references and every context fence. Three actual ownership
transaction tests cover queued chart changes, frozen inputs and stale depth at
commit. The actual component browser fixture uses empty paper state and an inert
placement stub: locked start, buy-stop preview, cancel/no request, confirmed
buy-limit handed over once, explicit ask-off handover, market relock and reload
defaults all pass. No actual account order was sent in this browser acceptance;
it verifies UI handover, not broker fills. Its warning/error list is empty.

Evidence: `artifacts/dom-order-{tests,typecheck,build}.log`,
`dom-order-browser-checks.json`, `dom-order-browser-errors.json` and
`dom-order-preview.png`. Full gate: 2,424 tests in 231 files, standalone TypeScript
and production build passed.

Full Vela trading interaction remains open: preset-derived automatic SL/TP,
global kill-switch/confirmation preference integration, context-menu staging,
dragging working orders/exits, complete position/P&L labels, persisted settings
and direct live/hosted acceptance. This increment implements the default no-exit
click workflow, not all trading or Order book functionality.
