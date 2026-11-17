# Market consumer isolation and trade-drain ownership

Two defects in the actual MarketService were reproduced before changing its implementation:

1. An exception in a quote/trade consumer could abort `drainHyperliquid` before its active flag was released or another batch scheduled. Subsequent source messages accumulated without delivery. An exception also prevented later consumers of that observation from running.
2. An already-scheduled old-generation drain cleared the shared queue after stop/start. It could erase replacement-generation trades or reset that generation's draining state. A source replacement during notification could also allow the remainder of the old batch to write into the new state.

Both new original regression cases failed against the unchanged implementation: `artifacts/trade-drain-before.txt`. One failed with the consumer exception; the other received no replacement trade instead of its expected price 202.

## Changes

- MarketService publishes quote, trade, bar, close and book observations independently to consumers. A throwing synchronous consumer no longer prevents later consumers or subsequent observations from running. Removed listeners are skipped; newly attached listeners do not receive an observation already being dispatched.
- A failed consumer is reported once per failure episode. A successful later invocation clears that episode so a later failure is reported again. Permanently failing callbacks do not log once per trade. The callback is still invoked on later data so it can recover.
- Delivery checks the service generation. Replacing/stopping the source inside a callback abandons the old observation's remaining work instead of publishing it into the new source.
- Stopping clears the queue and releases its active flag. Old callbacks return without touching a replacement queue. Each drain owns its captured queue/generation, checks ownership before each trade and releases/reschedules only its own work in `finally`. Unexpected core trade-processing exceptions are reported and do not permanently lock the remaining queue.
- Native candle repair retains its existing source/socket identity checks and explicit historical-close suppression. This change does not synthesize missing executions, change OHLC/volume mathematics or turn failed analyses into valid results.

## Verification

Five new actual-service tests verify queued quote/trade consumer failures, later bursts, replacement-generation ownership, native candle/close/book consumers, derived candle aggregation, failure-episode logging, and a source restart from inside a quote callback. The focused service suites passed **56 tests across two files**. The full suite passed **1,539 tests across 135 files**. Final production build including TypeScript passed. Logs: `artifacts/trade-drain-{focused,tests,build}.txt`.

`node scripts/verify-trade-drain.mjs` runs an isolated MarketService with in-memory stores against the real public Hyperliquid BTC trade/candle feed. It intentionally throws in two consumers while retaining independent healthy consumers. It then replaces the source from inside a quote callback, checks new deliveries against raw messages from the replacement socket, and verifies that the new candle series is available. It modifies no browser workspace, user alert database, exchange account or orders.

The final public run completed at **2026-10-30T14:42:04.809Z**:

| Check | Observed |
| --- | ---: |
| Intentional quote consumer exceptions | 61 |
| Intentional trade consumer exceptions | 59 |
| Reported failure episodes | 2 |
| Healthy trade deliveries before restart | 69 |
| Healthy trade deliveries after restart | 34 |
| Socket connections | 2 |
| Retained trades matching replacement source messages | 34 / 34 |
| Replacement native candle callbacks | 2 |
| Unexpected processing errors | 0 |

Every delivered tick matched actual provider trade id/time/price/quantity. These are observations received through each connection, including the provider's initial trade snapshot; they are not a claim that every replacement trade occurred after the local restart clock. Evidence: `artifacts/trade-drain-live.json` and `trade-drain-live.log`.

## Browser and evidence boundary

Before loading the change, the existing BTC/5m browser showed **Candle history interrupted**, unavailable technicals, a stale BTC last-trade timestamp and a still-changing book/other watchlist symbols. Captured console messages were empty. Evidence: `trade-drain-pre-update-browser.{txt,jpg}` and `trade-drain-pre-update-browser-errors.json`.

After loading the production build, Main menu → Reconnect market data showed the waiting-for-history state, then returned to fresh BTC last-trade prices and computed technicals. The BTC/5m Candles workspace retained EMA20, Volume, Watchlists and UTC with Replay off. No captured browser warnings/errors were recorded. Evidence: `trade-drain-reconnecting.txt`, `trade-drain-production.{txt,jpg}` and `trade-drain-browser-errors.json`. Production server remains on port 3000.

The deterministic regressions and public fault-injection run establish these two defects and their corrections. They do **not** prove that these defects explain every previously observed selective BTC candle/trade interruption, nor that every provider and long-running browser lifecycle is now covered. Captured console output is not a complete record of every possible browser exception. Selective subscription stalls, independent availability reporting, complete trade archives, exchange entitlements and full TradingView/Vela parity remain open.
