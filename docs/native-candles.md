# Native Hyperliquid candle updates

The core chart now consumes Hyperliquid's public cumulative candle stream for requested native intervals, alongside classified trades and depth. Trades continue to feed quotes, the tape and order flow, but are not added again to the volume of a native-stream candle. Explicit simulation remains separate. Custom/resampled intervals keep their existing aggregation path.

The adapter supports the venue's native 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, daily, weekly and monthly intervals. Daily/weekly API spellings are translated explicitly; builder coin names retain their case. Requests subscribe once per series on each socket and re-subscribe when that socket reconnects. Requested series remain subscribed for the current market-service session; this is not a claim of unlimited exchange subscription capacity.

Incoming OHLCV, timestamps, bucket alignment and cumulative trade counts are validated. Duplicate/lower counts and shrinking cumulative volume cannot replace newer stream state. REST and stream snapshots share a bucket by choosing its newer cumulative volume, rather than summing overlapping values. Four recent full revisions are retained, independently of the bounded historical series. Arrays are processed chronologically and by revision before a new bucket closes the preceding known venue bucket. Late updates can repair retained historical buckets without sending an old bar to the live callback or re-firing its close event.

An obsolete socket is fenced even when quote-only watchlist subscriptions refresh within the same market generation. A connection handshake that stalls for 15 seconds is retried; an open Hyperliquid socket with no incoming traffic for 45 seconds is closed and reconnected. Ping/pong traffic keeps it alive. Disconnects show Reconnecting, and HTTP metadata alone cannot relabel a closed Hyperliquid socket as connected. No synthetic Hyperliquid fallback is introduced.

## Verification

- `tests/hyperliquid-candles.test.ts`: 19 parser/reconciliation tests, including malformed data, duplicate/stale messages, REST overlap, closing one known full bucket, avoiding closure of a partial trade bucket and bounded revision storage.
- `tests/hyperliquid-service.test.ts`: 21 actual service tests, including native subscription/re-subscription, cumulative volume separation, unordered batches, stale socket callbacks, heartbeat timeout, handshake timeout and HTTP history races. Existing feed/depth/watchlist tests remain.
- `tests/symbols-formatting.test.ts`: seven cases ensure gains and losses use symmetric magnitude-based precision. The browser review exposed the earlier negative-change formatting defect.
- `scripts/verify-hyperliquid-candles.mjs` runs the real service with public WebSocket data and the local public-history proxy. It uses isolated in-memory persistence and makes no account or broker changes. The recorded live run received four native candle messages/callbacks and 182 real trades, forcibly closed only its own test socket, and resumed on a second connection. Every chart callback matched an actual native OHLCV snapshot. Same-bucket volume rose from 157.30636 to 157.50163, rather than being added twice. Evidence: `artifacts/native-candles-live.json` and `.log`.
- Full-suite/build/typecheck logs use the `artifacts/native-candles-` prefix. Browser evidence is recorded with the final production checkpoint.

The final suite passed **1,033 tests across 85 files**. Production build and standalone TypeScript verification passed. In the production browser, BTC/15m and BTC/5m loaded with native updates, interval transitions showed the loading state instead of stale OHLC, and the chart retained EMA and Volume. Captured browser warnings/errors were empty. `artifacts/native-candles-browser.json` records transparent quote-box backgrounds with matching red/blue text and borders; `native-candles-production.png` shows the final desktop.

The same review found and fixed the sidebar's missing close toggle. Watchlist, Alerts and Object tree buttons now expose their pressed state and close the already selected panel. Entering the phone breakpoint also closes the panel after a resize, not just on initial mount. At a 375px viewport the chart measured 282px wide, document scrollWidth remained 375px, and the sidebar was closed. Watchlist open/close, Alerts close, Object tree open/close and automatic close on resize were exercised. Viewport settings were reset and BTC/5m with the watchlist was restored. See `native-candles-mobile.png` and the browser JSON. Existing alerts still showed 15 total; none was created or edited.

The Sell/Buy legend boxes also follow the inspected public TradingView reference: transparent backgrounds, colored borders and colored prices. This changes their appearance, not their existing local-paper action.

## Remaining evidence limits

That checkpoint verified native cumulative updates and a short reconnection within a candle. The subsequent native gap recovery is documented in [candle-recovery.md](candle-recovery.md). It still does not prove every prolonged-outage/retention case, recovery of all dropped order-flow trades, every market/interval in production, provider corrections that reuse a trade count, or the timing of a late final correction arriving after the next bucket. Yahoo and custom interval snapshot/stream boundaries remain separate follow-ups. Exact TradingView data, indicator and layout parity is not established by this checkpoint.

Protocol reference: [Hyperliquid WebSocket subscriptions and Candle fields](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions). The adapter uses public market channels and requires no account credentials.
