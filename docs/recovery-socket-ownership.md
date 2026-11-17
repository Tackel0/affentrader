# Candle-repair ownership across socket replacement

Two same-generation reconnect defects in the actual MarketService were reproduced before the fix:

1. A range repair captured an old WebSocket. A replacement connection resumed the same candle and cleared its waiting state. When the old HTTP request later completed, its rejected socket check nevertheless wrote a new retrying gap into the healthy series, withholding technical history again.
2. An old repair remained in the shared pending map after a replacement socket opened. Its promise was reused by the replacement connection, preventing a fresh repair until the stale request settled.

The pending repair map is now detached when a replacement socket is installed. Old requests still finish under their existing HTTP timeout, but their failure path can only publish into the same captured socket. The existing identity-checked promise cleanup prevents an old completion from deleting a newer pending task. Genuine gaps and waiting flags are preserved across reconnect until a valid current-socket snapshot or repair resolves them.

The two new regression tests run the actual service, feed range port, native-candle parser and HTTP history loader. They preserve current volume after a stale same-bucket completion, prove an immediate second request starts on the replacement connection, and resolve the old request while the new one is pending to verify its loading state and request coalescing survive. Both tests fail on the unchanged implementation; see `artifacts/recovery-socket-before.log`. All 39 focused service tests pass after the fix.

The full suite passed **1,496 tests across 131 files**. Production build and final TypeScript passed. Logs use `artifacts/recovery-socket-{tests,build,typecheck,focused}.log`.

The existing public gap probe accepts an optional validated artifact basename (`node scripts/verify-hyperliquid-gap.mjs recovery-socket`) so this checkpoint does not overwrite earlier evidence. It uses isolated in-memory stores and suppresses this client's real incoming deliveries for 130 seconds; it does not change the browser workspace or synthesize candle prices.

## Evidence boundary

The final public BTC/1m probe passed on 2026-10-30T13:30:53Z. Across three sockets it suppressed 690 deliveries for 130 seconds, restored the missed closed candle at 13:29 UTC and compared restored OHLCV against actual source messages/history responses. Incomplete technical history was withheld; recovery emitted two chart callbacks and zero historical close signals. Evidence: `artifacts/recovery-socket-live.json` and `.log`. An earlier attempt did not produce a report and its process handle was missing after an environment interruption; only the completed run is acceptance evidence.

The corrected production browser was loaded with BTC/5m, UTC, Candles, EMA20, Volume and the five-symbol watchlist. Main menu → Reconnect market data visibly entered Waiting for fresh candles/Reconnecting, then returned to Market data connected with fresh OHLCV and computed technicals and no interruption badge. Screenshot/state: `artifacts/recovery-socket-production.jpg`, `.txt` and `recovery-socket-reconnecting.txt`. Browser warnings/errors were empty. This exercises normal reconnect; the exact late-response races are established by the deterministic service tests, not by a claim that the live run happened to reproduce those races.

The long-running pre-update browser tab did show interrupted/loading history during this investigation, then recovered without loading the fix. These defects are established by controlled regressions, not proven to explain every earlier live interruption. The before-build browser capture was taken after spontaneous recovery. Complete outage recovery for every provider/interval, missing trade/depth archives, the separate histogram raster failure, licensed Nasdaq data and full TradingView/Vela parity remain open.

Follow-up: [market consumer isolation and trade-drain ownership](trade-drain-lifecycle.md) corrects two independent trade-delivery lifecycle defects. Neither checkpoint attributes every observed interruption to its particular reproduced races.
