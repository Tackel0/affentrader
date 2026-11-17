# Alpaca IEX equity data — 2026-11-01

Alpaca IEX is now an explicit fourth provider, with identities such as `IEX:AAPL` and `IEX:BRK.B`. It does not replace or merge with `YF:AAPL`, Binance or Hyperliquid markets. Open **Main menu → Market data connections…** to supply an API key and secret for the current tab, or select **Alpaca · IEX only** under the Stocks/ETFs search's Data source control. The chart's missing-connection state links directly to these settings.

## Coverage contract

The official [Alpaca plan documentation](https://docs.alpaca.markets/us/docs/about-market-data-api) describes Basic as free IEX real-time equity data, with a 30-symbol WebSocket allowance. IEX activity is an exchange subset, not the consolidated Nasdaq/NYSE market, complete US trading volume, or Nasdaq depth. Account eligibility and entitlements still apply. The connector explicitly selects `feed=iex`, never silently requests the default SIP feed.

| Surface | Behavior |
| --- | --- |
| Current price/watchlist | Observed IEX executions, original provider timestamps and bounded price previews. Change/range are observed since connection; volume is unavailable rather than an invented consolidated/session quantity. |
| Charts/indicators | Raw provider minute/day OHLCV, including available extended hours. Bars update from the provider's completed-minute, updated-bar and daily-bar channels. Price observations can arrive between those bar updates. |
| Resolutions | Minute and longer intervals; second/tick history is explicitly rejected. Intraday bars aggregate minute records; coarser calendar bars aggregate daily records. Native daily exchange-local timestamps are preserved. |
| History bounds | At most 20,000 source records per request, with bounded pagination. Coarse intraday requests can therefore return fewer than the requested number of chart candles. Empty IEX minutes stay absent. A truncated first source bucket cannot overwrite a complete older aggregate. |
| TradingView-style analysis | Native/Pine studies consume the same chart series. Source identity, USD currency and New York timezone reach Vela/Pine metadata. Browser strategy loading recognizes IEX and reports subset/raw-data and estimated-trading-increment warnings. No broker trading rules or authenticated strategy run were verified. |
| Alerts | Browser price alerts evaluate IEX observations. Technical/Pine calculations receive a candle-update event after derived series updates; close events follow provider bar completion. Server rules reject IEX scope/condition symbols because session credentials are unavailable there. |
| Orderflow | No classified `Tick`, Bid × Ask Footprint, delta/CVD, Session Volume Profile or Level 2 book is manufactured from these executions. Source-specific messages explain the missing classified feed. Ordinary OHLCV volume studies and OHLC-derived analysis remain distinct. |
| Offline mode | Auto mode never generates substitute IEX prices/history. Explicit Simulation mode remains separately labelled. Yahoo session/dividend controls do not apply to this raw, extended-hours IEX source. |

Stream protocol references: [stock channels and bar corrections](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data), [authentication, limits and connection behavior](https://docs.alpaca.markets/us/docs/streaming-market-data), [historical pagination and feed selection](https://docs.alpaca.markets/us/reference/stockbars).

## Credentials and lifecycle

Credentials live in a module-private session value, outside serializable Zustand state, persistence, workspace backup and window synchronization. Disconnect clears that value; reload creates a fresh disconnected session. Unsaved form fields clear on closing the dialog. Keys are not accepted via symbol IDs or URLs.

The browser authenticates directly with `wss://stream.data.alpaca.markets/v2/iex`. REST history sends a same-origin POST to `/api/alpaca`; the fixed read-only proxy forwards credentials as headers only to `https://data.alpaca.markets/v2/stocks/bars`. It selects raw IEX data, rejects redirects/invalid parameters/cross-site requests, and returns `no-store, private` responses. It does not cache credentials or upstream payloads, call an account/trading endpoint, or echo raw upstream error bodies. Public error messages cannot contain provider-echoed credentials.

The authenticated stream updates subscriptions in place, prioritizes the active chart, caps its requested set at 30 symbols and lists omitted symbols in the connection dialog. Transport failures reconnect with bounded exponential delay; auth/entitlement/limit errors stop with a public explanation and manual reconnect/disconnect controls. Another application or tab can consume the account's one-stream allowance.

A transport interruption fences pending history requests, clears candle readiness and forces a new source generation. Late messages and stale REST completions cannot replace the new series. Provider minute replacements/corrections do not sum volume twice or replay an old close signal. Backward pages retained by the actual Vela feed remain present after subsequent minute updates. Missing classified flow is never represented as sell volume.

## Verification

- **137 files / 1,565 tests passed**; successful final production build including TypeScript; final standalone TypeScript passed. Logs: `artifacts/alpaca-iex-tests.log`, `alpaca-iex-build.log`, `alpaca-iex-typecheck.log`.
- Eighteen new tests cover source identities/Pine metadata, nanosecond clocks and unclassified executions, invalid OHLCV, private credential state and real backup validation, fixed proxy/header-only credentials/no-store/error redaction, cross-site rejection, source pagination/session fences, correction volume, source-capacity edges, real native backward paging, auth/subscription ordering/limits, quote-only edits without reconnection, duplicate/obsolete messages, retry cleanup, actual MarketService quote/bar/close consumers, consumer exception isolation, no historical close replay, explicit missing-session behavior, and rejection of direct/mixed-market server rules.
- **Actual public transport probe, no credentials:** the IEX WebSocket returned its connected welcome; unauthenticated history returned HTTP401. `artifacts/alpaca-iex-transport.json` explicitly records `authenticatedAccountVerified: false`. This proves reachability/auth gating, not authenticated history, subscriptions or live equity prices.
- **Actual production route:** empty credential-free POST returns HTTP400 with `Cache-Control: no-store, private` and a fixed validation message. `artifacts/alpaca-iex-route.json`.
- **Actual production browser:** mobile connection dialog exposes disconnected status, coverage/credential limits, password fields and actions. Invalid short fixture input is rejected locally. Closing/reopening clears both unsaved password fields. At414px, scrollWidth equals viewport width; footer actions remain reachable. No real credentials were entered.
- Choosing `IEX:AAPL` without a session displays **IEX connection required** and **Manage IEX connection**; price/trade controls remain empty/disabled. The direct action opens the connection dialog. Stocks search selects the IEX source and resolves MSFT with an explicit key-required/IEX-only caption. Desktop1280px and mobile controls were visually inspected.
- Browser artifacts: `alpaca-iex-{mobile,desktop,no-session,symbol-search}.jpg`, matching text snapshots, and `alpaca-iex-browser-errors.json` (no captured warning/error entries). Original BTC/5m/Candles/UTC/Regular scale with EMA20/Volume restored; no test watchlist symbol, alert or order saved. Viewport override reset; production preview retained.

**Evidence boundary:** no account credentials were supplied, so an authenticated user-account connection, real equity history/chart rendering, entitlements, exchange-hour behavior, live quote/alert delivery and full strategy run remain unverified. Protocol/consumer fixtures do not establish those facts. Full licensed Nasdaq/SIP/depth feeds, execution archives, all chart settings and full TradingView/Vela parity remain open. The overall goal remains active.
# Delayed SIP history

In **Symbol search → Stocks or ETFs → Data source**, select **Alpaca · delayed SIP history**. **Market data connections → Open delayed SIP chart** also accepts a US ticker. The `SIP:` identity is separate from `IEX:` and uses consolidated, unadjusted historical bars with a 16-minute query cutoff. A valid Alpaca API key and secret are required. The provider describes delayed historical SIP access in its [Market Data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq).

The SIP option loads history for analysis and Replay. The active chart checks the recent history window once per minute. The chart applies new bars and updates to its latest bar. These updates go to the chart only. IEX streaming remains available for explicitly selected `IEX:` symbols.

