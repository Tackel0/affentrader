# DOM columns and row P&L

Reference: https://docs.luxalgo.com/platform/workspaces/order-book
(DOM Columns/P&L, inspected 2026-11-06).

Columns settings now provide ten independently ordered entries: Orders, P&L,
Sold, Bid size, Price, Ask size, Bought, Delta, Volume and Last (5s). Bid/Price/Ask
always remain visible. P&L, Volume and Last default off. Orders appears only with
a matching position or working orders; P&L additionally requires a matching
position. The default no-exposure table is Sold/Bid/Price/Ask/Bought/Delta.

Checkboxes control optional visibility. Each column has left/right controls,
a native drag path and a direct pointer grip; the latter avoids dependence on
HTML drag activation and uses a same-settings-list drop target. Pointer handlers
are cleaned up on cancellation/unmount. Reset restores the default ordering and
visibility. Durable storage and workspace export/import were subsequently added
in [dom-preferences.md](dom-preferences.md).

Header and row cells are rendered from the same ordered column list. Their grid
tracks and minimum width are derived from the shown columns. Hiding/reordering
does not mutate executions, liquidity, positions or orders. One conditional
Orders cell replaces the old duplicate empty buy/sell columns; it identifies an
entry-row Long/Short and displays individual working-order type/quantity cancel
controls. Complete reference order markers/drag/protection behavior remains open.

Row P&L uses the existing broker's `(row price - entry price) × signed quantity`
mark-to-market. It excludes realized profit and fees, uses the market's quote
units and performs no currency conversion. Unknown quote labels use “quote
units”; there is no unsupported universal USD claim. Invalid/overflow values
are unavailable, and short-position entry zero is normalized to `0.00`.

Four regressions cover defaults, 2,048 visibility/position combinations,
required/account-column constraints, immutable drop/shift operations and
long/short/partial/zero/invalid P&L. Actual-component controlled-browser checks
cover long +2/-2, short -2/+2 and zero at 100 for quantity 2/entry 100, absence
without a position, optional hiding, required controls, left-button movement,
real pointer dragging Delta before Orders, reset and correct Volume price
mapping after the scheduled 500ms render. The first native HTML-drag attempt
did not move columns; the added direct pointer path was then verified. This is
not physical-touch or hosted-account acceptance. Fixture positions are inert;
no account position was opened.

Evidence: `artifacts/dom-columns-browser-checks.json`,
`dom-columns-browser-errors.json` (empty), `dom-columns-browser.png`,
`dom-columns-{tests,typecheck,build}.log` and `dom-columns-targeted-final.log`.
Full suite: 2,428 tests in 232 files. TypeScript and production build pass.

Remaining parity: full working-order/position annotations
and modification, complete reference P&L currency policy, physical touch and
direct Vela visual/behavior plus real live/hosted acceptance.
