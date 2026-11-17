# Watchlist quote basis and live trade verification

TradingView core-function checkpoint, 2026-10-27. Broker execution and social features remain deferred; complete 1:1 parity remains unproven.

## Corrected behavior

Hyperliquid `allMids`, asset-context `markPx`, and public trade `px` previously overwrote the same quote field. Consequently, a mini-chart could alternate between different definitions of price without a new trade. Metadata also advanced its apparent observation time.

The pure reducer in `lib/market/hyperliquidQuotes.ts` now promotes mark to midpoint to actual trade, never downgrades an observed trade, and rejects older observations of the same basis. Promotion starts a new mini-chart history instead of connecting unlike prices. Changed observations append up to 48 points; unchanged prices and metadata retain the history array. Price time is the actual accepted observation time. Reference price/time and volume metadata refresh independently. Missing provider change reference produces an unavailable change, rendered as a dash and exported blank. Complete candle ranges remain separate from mark metadata and volume.

Quote-only trade channels serve up to 150 additional Hyperliquid watchlist markets, excluding markets already streamed for chart/alert/order-flow use. The currently visible virtualized rows receive priority, followed by the active list and other watched markets. Viewport state is transient and excluded from persistence. Extra subscriptions reserve 128 slots for native candle requests and account for the current client's chart channels and builder dex subscriptions. Shared-IP connection/subscription limits across multiple clients are not coordinated by this local budget.

Quote-only messages coalesce the latest trade per symbol per incoming batch. They do not create chart candles, add trade quantities to reported daily volume, populate order-flow tape, or emit execution ticks. Full chart streams retain their existing trade pipeline. Priority changes use the existing same-generation socket refresh and candle-freshness gates; reordering an unchanged priority set avoids a reconnect.

The watchlist displays `mid`/`mark` on fallback prices. Price tooltips and symbol details identify the basis and observation time. CSV appends `price_basis` and `price_time`, retaining the existing metric columns.

## Evidence

- 87 test files / **1,066 tests passed**, production build and standalone TypeScript passed. Logs: `artifacts/quote-basis-tests.log`, `quote-basis-build.log`, `quote-basis-typecheck.log`.
- Seven reducer/budget tests cover basis promotion, stale price/reference rejection, absent references, bounded history, flat trades, invalid observations, independent metrics and capacity. Two additional real-service tests cover batched quote-only trades without execution/candle side effects and priority refresh without replacing native history or reconnecting for mere reordering. Existing service expectations now require actual trade prices to survive mark refreshes.
- `node scripts/verify-hyperliquid-quotes.mjs` runs the actual MarketService with isolated memory stores and actual public messages. The final short probe recorded nine trade deliveries and two allMids deliveries, 13 quote publications and nine unchanged-price checks after allMids. BTC, ETH and SOL prices/timestamps matched the latest delivered public trades, with zero mismatches and zero execution ticks. See `artifacts/quote-basis-live.json` and `.log`. This is a short public-data test, not an exchange-wide endurance benchmark.
- Production browser: five original watchlist symbols all show Last trade with source timestamps; single-basis mini-chart; BTC/5m/Candles/UTC, EMA and Volume; 1280px document has no horizontal overflow. At 375px the sidebar closes and document scroll width equals viewport width. Desktop restored. Captured warnings/errors are empty. Alerts remain 15 total / 0 active / 123 log entries. No alert or order command was created.
- Actual Watchlist-menu CSV download contains five rows with trade basis and ISO observation times. Missing incomplete candle ranges remain blank. Evidence: `artifacts/quote-basis-browser.json`, `quote-basis-production.png`, `quote-basis-mobile.png`; downloaded `C:/Users/Niklas/Downloads/hyperliquid (1).csv`.

## Boundaries

A 1,000-symbol list does not receive 1,000 simultaneous last-trade streams. Unprioritized markets use labeled midpoint/mark fallback until a trade is observed. A market that loses its trade subscription retains its last observed trade and its original time; metadata does not make it current. Scrolling reprioritizes visible markets, but that large-list workflow was exercised through reducer/service contracts rather than a 1,000-symbol production browser run. Trade price change uses the provider's previous-day reference; it is not a reconstructed rolling trade-close return.

Provider documentation: [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions), [rate and user limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits). The public API distinguishes mids, marks and trades and applies shared-IP subscription limits. No frequent per-symbol recentTrades REST polling was added.
