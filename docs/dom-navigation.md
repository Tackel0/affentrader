# Stable DOM viewport and follow modes

Reference inspected 2026-11-06:
https://docs.luxalgo.com/platform/workspaces/order-book

The DOM now renders a contiguous viewport at fixed price-grid indices, instead
of rebuilding its row list around whatever best bid/ask happens to exist. Order
changes update quantities in place. The subsequent [style increment](dom-style.md)
uses the reference's zoomed row/header metrics and admits even row counts below
the header, bounded to 101, so a large spread never allocates its
whole missing range. Positive-price and safe-index limits apply.

Follow modes:

- Auto follows the current target outside the ladder. With the pointer on it,
  rows stay still until a moving target would leave the viewport.
- Fixed preserves the viewport until Center or a manual navigation action.
- Timed holds while hovered, then recenters after 5/10/30/60 seconds from pointer
  leave. The existing 500ms UI clock bounds deadline display granularity.

The target is a fresh matching classified trade when available, otherwise the
best-bid/ask midpoint. Its grouped row is highlighted. Center is shown whenever
the viewport center differs from that target. Wheel input moves price rows;
horizontal/Shift wheel and Ctrl zoom gestures retain their native handling.
Up/down buttons, arrow keys, Page Up/Down and Home provide explicit navigation.
Quantity-only/clock refreshes do not undo an explicit Auto-mode browse; it is
released by pointer leave or a changed market target. A moved target outside the
window can then recenter. This detailed browse arbitration is a local policy,
not a directly measured Vela implementation formula.

Changing market/source epoch, group step or Replay/account mode resets the
viewport identity. An unavailable intermediate context clears an older identity
so returning from Replay cannot revive a stale Fixed viewport. Temporary stale
depth on the same identity retains its center while rows are unavailable.

The panel now holds the first valid matching book's observed price spacing for
that market/source identity. Otherwise disappearing adjacent orders could change
`bookTick` and unexpectedly change even a Fixed ladder. It remains explicitly
inferred spacing, not verified exchange tick metadata; venue metadata, dynamic
tick-rule changes and settings persistence remain open. Group selection still
applies a multiplier to the captured spacing. All current raw book levels are
rebinned with exact decimal quantity addition and outward bid/ask rounding.

Five regressions cover Auto/hover/outside-window behavior, Fixed, all four Timed
deadlines, explicit scroll/clamps, stable rows with added/removed liquidity,
grouped quantities, wide spreads and low-price viewport bounds. The actual
component/hook browser fixture additionally checks Fixed versus a moving market,
Center, manual button, keyboard, real wheel, Timed before/after five seconds,
Auto outside the pointer, Replay/market reset and sparse-order grid stability.
Final fixture warning/error logs are empty. These checks do not establish true
exchange/live hosted behavior, touch dragging or direct Vela visual equivalence.

Evidence (local, excluded from upload):
`dom-navigation-browser-checks.json`, `dom-navigation-context-checks.json`,
`dom-navigation-sparse-check.json`, `dom-navigation-{browser,final,sparse}.png`,
and the corresponding `*-errors.json` files under `artifacts/`.

Full test gate: 2,412 tests in 229 files. Standalone TypeScript and production
build are recorded in `artifacts/dom-navigation-{typecheck,build}.log`.
Venue grid selection is subsequently implemented in [dom-price-grid.md](dom-price-grid.md).
Remaining DOM work includes persisted settings, column
reorder/P&L, large-order styling, combined venues, reference click-order workflow
and complete direct rendering/source parity.
