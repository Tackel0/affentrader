# Quote metrics and provider provenance

`Quote.metrics` separates base quantity from independently reported notional turnover. `Quote.volume` remains a numeric compatibility field containing base units; consumers use `baseVolume()` so an unavailable quantity is never mistaken for zero. `notionalVolume()` never estimates turnover by multiplying the latest price by the base volume.

| Provider | Base volume | Turnover | High / low |
| --- | --- | --- | --- |
| Binance | `v` / `volume` | `q` / `quoteVolume`, in the pair's quote currency | Published rolling 24h ticker |
| Hyperliquid | `dayBaseVlm`, nullable | `dayNtlVlm`, USD | Verified closed-minute 24h candle window |
| Yahoo | Unavailable from the current quote endpoint | Unavailable | Provider session range |
| Simulation / observed tape | Collected quantity | Sum of each collected trade's price × quantity when available | Explicitly simulated / observed period |

Live trades update the tape and candles independently. They do not add quantities to an already published rolling-volume snapshot. A quote's price timestamp and its volume snapshot timestamp are distinct. Cached Hyperliquid registry responses retain their original `asOf`; an active chart also consumes live `activeAssetCtx` messages. Watchlist prices consume one `allMids` subscription per dex, including case-sensitive builder markets. Large mids snapshots publish a single Zustand update and skip unchanged prices. Registry requests are coalesced and cached for 60 seconds.

The Hyperliquid range is `[last closed minute − 24h, last closed minute)`. All 1,440 consecutive candles must have valid, aligned OHLC values. Gaps, invalid prices, duplicated minutes replacing a missing minute, and future/open candles cannot produce a valid range. This is a minute-aligned candle window, not an exact rolling tick-level range at the current second. Its resolution, bounds, completeness and count are explicit. A window older than two minutes is unavailable to display, sorting, CSV and alerts.

Visible consumers and range-dependent alert rules request windows lazily. The server coalesces per-coin/minute requests, allows two candle-window requests concurrently and retains 128 windows. Complete windows refresh incrementally; incomplete ones retry the whole window on the next minute. An older response cannot overwrite a newer cache entry. Exchange failure leaves the range unavailable rather than substituting observed marks.

Watchlist cells, detail metrics, Market Overview, sorting, CSV and browser/server condition evaluation use the same helpers. CSV includes separate quantities, currency, volume period/as-of and range bounds/resolution/completeness. Unknown numeric values are empty CSV cells. Missing operands mark an evaluation incomplete, preserving an established alert edge until data recovers.

Changing quote-only watchlist subscriptions preserves the active chart's loaded history, trades and feed epoch. Only the required sockets/polls refresh; full source resets remain reserved for chart/source reconfiguration.

Evidence: `tests/quote-metrics.test.ts`, `tests/hyperliquid-service.test.ts`, `tests/service.test.ts`, `tests/server-alerts.test.ts`, `artifacts/hyperliquid-quote-metrics.csv` and `artifacts/workspace-quote-metrics.png`. The real browser showed independently changing main-dex watchlist prices while the active chart remained on `HL:xyz:BRENTOIL`; a complete 1,440-candle window supplied high 113.75 / low 110.97. This verifies these local data paths, not complete TradingView parity or a multi-hour network soak.

Primary API references: [Hyperliquid perpetual contexts](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals), [WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions), and [candle snapshots](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint).
