# DOM collected execution volume

Official reference inspected 2026-11-06:
https://docs.luxalgo.com/platform/workspaces/order-book

The DOM now includes Sold, Bought and Delta alongside waiting bid/ask sizes.
Optional Volume and Last columns default off. Last is the most recent execution
at that grouped price, visible for five seconds. Execution units can be base
quantity or quote value; quote totals sum each execution's actual price times
quantity. Waiting-order quantities remain explicitly labelled base quantities.
Reset starts a new collected interval and clears values immediately.

`DomTrades` retains raw-price aggregates so changing grouping can rebin without
losing the current panel interval. Executed quantities use nearest ladder price;
the existing waiting-book grid continues to round bids down and asks up. This
grouping choice is disclosed in the panel and is not claimed to match Vela's
undocumented row-assignment formula. No waiting liquidity is counted as a fill.

`useDomTrades` subscribes only to subsequent market-service live ticks. It does
not hydrate from the bounded tape, archive, REST history or study Replay. A new
collection starts on opening the panel, market/source epoch changes, or return
from Replay. Symbol, feed/market epoch and source/Replay identity are checked on
every delivery as well as on React subscription replacement. Simulation,
Replay, wrong-symbol, old and invalid records are excluded. Closing the panel
unsubscribes and discards its collection. No alert or paper-matching path changes.

IDs are deduplicated, including reconnect overlap; conflicting IDs fail closed.
Counting is bounded at 100,000 IDs and 20,000 raw prices, with an explicit Reset
message on capacity/overflow instead of silently truncating displayed totals.
Last uses execution time and sequence/ID tie order, not delivery order.

Evidence:

- Five model regressions cover base/quote grouping, input/source exclusions,
  deduplication/conflicts/reset, ordered Last/expiry, and explicit capacity.
- `scripts/verify-dom-trades-source.ts` independently checks all 75 saved public
  Kraken records at five price steps in both units using integer-tenths indices.
  All bought/sold/delta/volume rows match. A 100,000-observation/1,000-price model
  run retains exactly 100,000 volume; its measured local elapsed time was about
  53 ms. This is not an end-to-end browser performance guarantee.
- `scripts/verify-dom-trades-browser.mjs` mounts the actual DOM component and
  hook with explicitly controlled fixture delivery, empty paper state and inert
  trading commands. At price 100, buy 2 and sell 3 produce delta -1 and volume 5;
  price 101 buys 4. Quote values are 200/300 and 404. Group 5 gives bought 6,
  sold 3, delta 3, volume 9 and latest quantity 4. Browser checks cover Reset,
  market switch, Replay exclusion, leaving Replay and panel close/reopen. The
  final fixture warning/error list is empty. An initial fixture stub returned a
  fresh account object and caused a React snapshot loop; fixing that stub to
  return stable empty state resolved it, without changing production accounts.
- Local artifacts: `dom-trades-source-verification.json`, `dom-trades-quote.json`,
  `dom-trades-grouped.json`, `dom-trades-browser-checks.json`,
  `dom-trades-browser-errors.json`, and `dom-trades-browser.png`.

Full gate: 2,407 tests in 228 files, standalone TypeScript and production build
pass (`artifacts/dom-trades-{tests,typecheck,build}.log`).

Stable viewport/follow/scroll behavior is subsequently implemented and scoped in
[dom-navigation.md](dom-navigation.md).

Full Vela DOM parity remains open: grouping
metadata, configurable/reorderable columns, P&L, large-order emphasis, combined
venues, direct visual/formula comparison and genuine live/hosted acceptance of
these new columns. This
increment does not add archived DOM or complete execution/depth history.
