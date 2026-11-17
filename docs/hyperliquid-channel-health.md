# Independent Hyperliquid chart-channel recovery

The shared Hyperliquid socket's global traffic/heartbeat guard was insufficient for partial failures: mids, valuations, depth or pongs could continue while a registered chart candle or classified-trade channel stopped. A new bounded channel-health model complements that guard. It does not manufacture candle data or classified executions.

## Detection

- Registered native candle subscriptions record their own request and accepted-current-candle receipt times. Fresh classified trades record their exchange timestamp and receipt time. Reconnect snapshots more than ten seconds old and future prints beyond a one-second allowance cannot act as fresh evidence.
- A channel silent for more than **20 seconds** becomes suspect only with recent contrary activity: fresh classified trades versus missing candles, or increased current-candle execution counts versus missing trades. The condition must persist for a further **five seconds**; a resumed channel or stale contrary evidence clears it. These thresholds are not a guaranteed wall-clock recovery SLA.
- Quiet markets are not assumed to be broken. If both chart channels stay quiet for more than **45 seconds**, a bounded REST probe requests two native candles. An unchanged history, zero-volume new bucket, older snapshot, failed request or rate limit does not justify closing the socket. A later positive-volume candle or a changed/nondecreasing-volume traded bucket can demonstrate that the stream is behind.
- A quiet probe rechecks source generation, socket identity, open state and whether the stream remains quiet after HTTP completes. A late response cannot close a recovered or replacement socket. There are at most **two active quiet probes**, with a **60-second per-channel cooldown**, and a 1,000-channel guard. The native loader may fetch a second page if its first response does not supply two distinct candles. Known recovery tasks/gaps are not probed in parallel for the same key.
- A confirmed failure closes the affected shared socket and uses the existing reconnect, subscription restoration, candle suspension and fenced REST gap repair. Probe ownership is cleared on replacement; old completions cannot delete replacement tasks. Trade gaps remain missing observations, not invented aggressor volume.

The provider's [WebSocket documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket) describes subscription acknowledgements and reconnect handling; the application's independent-channel checks above are its own recovery policy. See also the [subscription definitions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions).

## Verified evidence

**1,707 tests across 150 files passed**, and the final production build/TypeScript passed. The 59 focused health/service tests include eight dedicated health tests and seven additional service regressions covering selective channel silence, quiet markets, REST-confirmed dual silence, probe cooldown, current-source recovery and replacement-socket fences. Existing candle-gap repair and consumer-isolation contracts also remain passing.

Three independent, isolated clients used actual public BTC/1m messages and the local authenticated public-history proxy. Each client deliberately suppressed selected incoming messages without affecting the user's browser or changing exchange subscriptions:

| Suppressed channel | Dropped messages | Unrelated mids still received | Replacement and restored delivery |
| --- | ---: | ---: | ---: |
| Candles only | 27 | 5 | 38.017 seconds |
| Classified trades only | 32 | 5 | 29.556 seconds |
| Both, final causal run | 80 | 9 | 48.986 seconds |

Each run used two sockets and ended with no candle-recovery status pending. In the final dual-channel run, a successful REST response completed at **18:58:40.787 UTC on November 2, 2026**; the observed client-initiated socket close followed at **18:58:40.788 UTC**. Both current trades and candle callbacks resumed on the replacement. This verifies local recovery after actual selective message suppression, rather than merely observing that a new socket appeared.

The final production browser was additionally observed for **90 seconds** with BTC/5m, Footprint, the existing studies and Watchlist sidebar. Its chart readout continued changing, its latest trade reached 19:02:02 UTC, and no history-interruption/recovery or technical-history waiting message remained. Browser warnings/errors were empty. This is a short live smoke check, not a long-duration availability guarantee.

Reproduce the isolated checks with the already configured private local environment:

```powershell
node --env-file=.env.local scripts/verify-hyperliquid-channels.mjs candle
node --env-file=.env.local scripts/verify-hyperliquid-channels.mjs trades
node --env-file=.env.local scripts/verify-hyperliquid-channels.mjs both
```

The verifier uses a signed session only for the local history proxy. It prints no cookie or server secret and sends no account credentials to the public exchange. Fresh test storage lives only in that process; no paper orders, alerts or user browser storage are modified.

Artifacts: `artifacts/channel-health-focused.log`, `channel-health-tests.log`, `channel-health-build.log`, `channel-health-candle-live.json`, `channel-health-trades-live.json`, `channel-health-both-live.json`, corresponding logs, and `channel-health-production.png`/`.txt`.

## Evidence boundaries

These checks prove the described failure modes and their recovery. They do not establish that every previously observed browser interruption had the same cause. The new policy applies to registered native Hyperliquid chart channels; quote-only subscriptions, other providers, full trade/depth restoration and every custom/derived interval remain separate work. REST/provider outages can prevent proof or repair. Full historical coverage, source entitlements and overall TradingView/Vela parity remain open.
