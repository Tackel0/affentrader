# DOM venue price grid

The DOM now prefers the shared public venue-metadata loader already used by
Footprint and Volume Bubbles. Binance uses spot `PRICE_FILTER.tickSize`, Kraken
uses AssetPairs `tick_size`, and Hyperliquid derives the current price tick from
verified perpetual `szDecimals` and the current reference price. The selected
grid is independent of which orders are present in the sampled book.

Until usable metadata is available, the first matching book's observed spacing
remains a disclosed fallback. It is not labelled verified. The status identifies
the source and, for venue metadata, the last-check timestamp. A transient refresh
failure retains last-confirmed metadata with an explicit refresh error; it does
not silently update its timestamp. No historical tick-rule reconstruction is
claimed. A different price-dependent Hyperliquid step legitimately changes the
grid and resets the navigation identity. User grouping multiplies the chosen tick.

`watchDomGrid` owns one request/timer chain per panel source identity, refreshes
after five minutes and backs off failures for thirty seconds. The underlying
loader also shares and bounds requests across studies. Wrong symbols, empty
provenance, invalid/future timestamps and disabled/invalid tick precision are
rejected. Stop prevents queued requests, pending results and timers from updating
a later context. `useDomPriceGrid` additionally hides state under a different
market/feed/source identity or Replay/simulation. No credentials are required.

Five regressions cover matching/static/price-dependent choice, invalid metadata,
cancelled requests, late result exclusion, refresh/backoff/retained provenance
and wrong-market results. The controlled actual-component browser fixture checks
fallback step 1, asynchronous fixture venue step 0.25, market-switch fallback,
wrong-market rejection, delayed old-session exclusion and current-session apply.
The final browser warning/error list is empty. Fixture values are explicitly
labelled controlled metadata and do not prove an actual live browser connection.

`scripts/verify-dom-grid-live.ts` independently reads fresh public BTC responses
from Binance, Kraken and Hyperliquid. On 2026-11-06T19:12:55Z the DOM choice matched
raw tick fields for Binance (0.01) and Kraken (0.1), and the documented precision
rule for Hyperliquid at its observed mark 75764 (tick 1). Binance/Kraken calculation
prices are fixture reference values; their ticks are not price dependent.
Hyperliquid raw metadata is adapted into the existing internal route's assets
shape, so this check does not test that authenticated route itself.

Local evidence: `artifacts/dom-grid-live.json` retains public raw metadata,
`dom-grid-browser-checks.json`, `dom-grid-browser-errors.json` and
`dom-grid-browser.png`. Full gate: 2,417 tests in 230 files, standalone TypeScript
and production build pass (`artifacts/dom-grid-{tests,typecheck,build}.log`).
Remaining gates include reference grouping choices/defaults, persisted settings,
direct Vela visual/formula comparison, live/hosted acceptance of the new DOM
metadata wiring and historical rule coverage. This does not add consolidated or
complete depth/execution history.
