# Kraken candle recovery

Kraken reconnects suspend requested candle series and repair the interrupted window from closed REST candles. Recovery waits until the candle containing the reconnect is closed, retains newer trade aggregation, retries temporary errors and reports an unavailable window when the interrupted anchor is outside retained history. Technical history remains withheld while recovery is pending.

Repairs notify chart subscribers through the native range seam. They do not emit historical close or trade events. Late trades cannot add volume to already repaired closed candles. Unsupported historical intervals are reported explicitly; missing candles are not synthesized.

Initial history requests also capture the Kraken connection identity. A response from a disconnected or replaced socket is rejected before it can merge candles or return partially aggregated history. This applies when the old HTTP request succeeds and when it fails and would otherwise fall back to cached bars. The existing feed-generation fence remains in force.

Backward paging (`history` with an end timestamp, including Vela `loadRange`) observes the same barrier. Requests reaching the interrupted candle share its pending repair and filter the repaired result to the requested endpoint. A cached prefix strictly before the interrupted candle remains available while disconnected. Requests touching the interrupted window fail while disconnected instead of exposing partial candles.

## Verification, 2026-11-04

- `tests/kraken-recovery.test.ts`: interrupted-window repair, quiet-market close suppression, automatic retry, withheld technical history, retention limits, stale repair responses, shared requests, unsupported intervals, and two initial-history socket races. The new successful-response race failed before the connection fence was added.
- Backward-paging follow-up: both new regression cases failed before the barrier was extended; **95 tests across 5 targeted files passed** afterward (Kraken recovery/history, shared candle recovery, Hyperliquid service and market service).
- Complete suite: **1,936 tests across 177 files passed** (`artifacts/kraken-history-fence-tests.log`). Standalone TypeScript verification and production build passed (`artifacts/kraken-history-fence-build.log`).

These checks use deterministic provider/socket fixtures. They do not establish a fresh public-network outage test or combined recording, browser reload and Replay acceptance. Individual missed trades and order-book updates are not reconstructed by candle recovery.

## Recovery follow-up, 2026-11-04

The existing recovery implementation was re-inspected without changing runtime behavior. Three additional regression cases cover a second disconnect during REST recovery (both successful and failed obsolete responses) and Monday-aligned weekly recovery from daily candles. An obsolete response must leave the newer request and its loading barrier intact. Weekly recovery waits for the reconnect week to close, replaces its partial trade aggregate with the closed daily-source result, and emits no historical close alarm.

The expanded Kraken recovery file passes all 17 cases. Standalone TypeScript verification passes. The targeted test run is recorded in `artifacts/kraken-recovery-followup-tests.log`. This follow-up uses deterministic fixtures; it does not add public-network outage or combined recording/reload/Replay acceptance evidence.

## Public Kraken verification

Run `./scripts/verify-kraken-recovery-live.ps1` in PowerShell with the project dependencies installed. The check starts an isolated market service, closes its BTC/USD WebSocket, waits for automatic reconnection and candle repair, then compares the interrupted minute's OHLCV with a separate public Kraken response. It also checks that the minute did not emit a live close. This check runs against the market service and requires public Kraken connectivity.
