# Collected Footprint history

The native Footprint chart previously reconstructed every frame from `MarketService.tradesFor`, a rolling 5,000-execution tape. Once executions left that tape, previously observed price rows and older Footprint candles could disappear even though the chart had stayed open.

`FootprintHistory` now belongs to each active Footprint canvas. It seeds once from the retained tape and consumes matching live executions directly. Its canonical price-row maps update incrementally; unchanged bars retain their calculated output. Batch and collected models share the same finishing pass for diagonal imbalance, POC, delta and volume. Snapshots returned by an earlier read do not mutate when subsequent executions arrive.

Retained execution copies allow auto/fixed price-row changes to reconstruct the collected surface without dropping old observations. Threshold/display changes preserve collection. Symbol, interval, market-source epoch, chart-style and Replay transitions reset collection, and destruction removes the existing shared tick subscription. The history is local memory, not a durable exchange archive.

## Bounds and source semantics

Each canvas retains up to 100,000 executions, 20,000 time buckets and 200,000 price rows. When the execution or bar limit is reached, complete oldest observed buckets are evicted and an expiry watermark prevents old seeds from restoring them. The caption names partial history, retained trade count, simulation when applicable and old-bar eviction. One bucket exceeding the execution limit, grid capacity or numeric precision fails visibly through the existing chart error panel; changing chart type restarts collection. No partial failed aggregate is presented.

The initial seed remains limited by the provider's retained tape, and missed/disconnected executions cannot be recovered by collection. Replay explicitly retains its candles-only/no-recorded-bid-ask notice. This work does not add recorded Replay trades, persistent archives, SVP history retention, Nasdaq entitlements or complete exchange coverage.

## Evidence

- Full suite: **1,413 tests in 120 files**, production build including TypeScript checks passed. Logs: `artifacts/footprint-history-{tests,build}.log`.
- Seven new tests compare 6,500 collected executions against the full batch reference after exceeding the rolling tape. Other contracts cover late deliveries, grid/threshold changes, duplicate seeds, source-copy isolation, unchanged output reuse, whole-bucket eviction, expired seeds, source separation, invalid events and explicit capacity/precision errors.
- `node scripts/verify-footprint-history.mjs` ingested 100,500 deterministic simulated executions. The final 94,500 retained quantity equaled the retained trade count; 6,000 executions were evicted as one complete oldest bucket. The local probe measured about 78 ms initial processing, 0.020 ms median update, 0.118 ms p99 and 1.32 ms maximum over 500 incremental updates. Raw report: `artifacts/footprint-history-performance.json`. This is a bounded synthetic probe, not a device-independent timing guarantee.
- Actual production Hyperliquid BTC/5m: native cells and the partial-history trade count updated live. Row size changed through 5 and 50 and returned to auto; the collected count continued growing. At size 5, cells were too short to label at the current vertical scale; size 50 produced readable cells. Screenshot: `artifacts/footprint-history-live.jpg`.
- Actual Replay removed live cells and displayed the no-recorded-history notice: `artifacts/footprint-history-replay.jpg`. The manual zoom/scale left the selected historical price region outside the screenshot; this check proves separation, not historical candle rendering. Original Candles/recent view and auto row size were restored. No orders or alerts were created; no viewport override was applied. Captured warnings/errors: `artifacts/footprint-history-browser-errors.json`.

Full feature/layout parity, recorded order-flow Replay, complete trade backfill and the separate intermittent native candle issue remain open.
