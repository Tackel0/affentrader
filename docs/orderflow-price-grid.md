# Execution price-grid integrity

Follow-up: [Session Volume Profile and TPO grid correction](profile-price-grid.md) extends canonical assignment, edges and centers to those two profile families. Fixed-range/visible-range estimates remain separate.

Seven regressions were reproduced before this correction: decimal boundary prices went into preceding rows, a genuinely below-boundary execution was combined with the boundary execution, sub-ten-decimal rows collapsed to zero, diagonal imbalances and stacked zones used the wrong neighbors, the windowed trade-profile helper shared the boundary bug, and unsupported grids returned a misleading result instead of failing.

For example, the old `floor(price / step)` path assigned prices 0.3, 0.6 and 0.7 at a 0.1 step to rows 0.2, 0.5 and 0.6. Fixed ten-decimal rounding collapsed 3e-12, 4e-12 and 5e-12 into one row at zero.

## Implementation

`lib/orderflow/priceGrid.ts` assigns rows by integer arithmetic on each JavaScript number's canonical decimal spelling. Internal BigInt division implements mathematical floor, including negative coordinates, without adding an epsilon. Canonical decimal products produce lower and upper boundaries. Row identities must be safe integers, and adjacent boundaries must be finite and distinct. Unsupported grids throw `ExecutionPriceGridError`; no partial footprint is returned. Per-calculation maps reuse repeated price assignments and row bounds without allocating the intervening empty price range.

`lib/orderflow/math.ts` now keys Footprint aggregation and diagonal neighbors by those integer row identities. Each generated `FootprintLevel` carries JSON-safe optional `rowIndex` and `upperPrice` fields. The painter and stacked-zone detector use these instead of deriving new identities or edges from rounded display prices. Legacy external rows retain their existing fallback behavior. The separate windowed `tradeVolumeProfile` helper uses the same execution grid and excludes invalid/unclassified executions before indexing.

Automatic `priceStep` now produces canonical decimal powers and scales below the former 1e-8 floor for low-priced markets. Footprint's auto-row multiplier also uses a canonical decimal product. The actual PineTS footprint adapter continues to return its established price/buyVolume/sellVolume schema and now preserves distinct low-price execution rows rather than returning zeros; internal grid metadata is not leaked into that schema.

`lib/orderflow/velaPlugins.ts` catches grid failures through the existing scoped derived-chart issue channel. The user sees a **Footprint chart unavailable** explanation and a **Reset Footprint settings** action. Actual OHLC side candles can remain visible, but no partially calculated classified cells are painted. Errors clear on recovery, chart-type change, Replay or destruction; token ownership prevents another layer from clearing the current owner's error. Replay never evaluates the live execution grid and retains its explicit missing-recorded-bid/ask-history notice.

## Verification

- **1,365 tests in 114 files**, production build and TypeScript pass. Logs: `artifacts/orderflow-price-grid-{tests,build,typecheck}.log`.
- Tests cover the seven reproduced regressions plus quarter ticks, negative floor, subnormal finite prices, unsupported indices/overflow, canonical edge projection, auto-step multiplication, scoped failure/recovery and actual PineTS adapter output. Existing indicator/profile/TPO/Replay/storage tests also pass; that does not prove equivalence of their separate algorithms.
- Production browser, public Hyperliquid BTC: setting row size to 1e-12 shows an explicit error; it survives reload and Reset restores live Bid/Ask cells. See `artifacts/orderflow-price-grid-error.jpg`, `orderflow-price-grid-error-reload.jpg` and `orderflow-price-grid-recovery.jpg`.
- Mobile 375 x 812: the error and Reset action fit, Replay clears the live-grid error while showing only price candles and the missing-history caption, returning live restores the still-invalid setting's error, and Reset recovers actual cells. See `artifacts/orderflow-price-grid-mobile-error.jpg`, `orderflow-price-grid-replay.jpg` and `orderflow-price-grid-mobile-recovery.jpg`.
- A local deterministic 5,000-distinct-price fixture ran 25 complete calculations with all 5,000 rows and total volume retained: median 7.70 ms, p95 11.09 ms, maximum 13.45 ms. This is a local calculation probe, not a browser/exchange throughput guarantee. Raw result: `artifacts/orderflow-price-grid-performance.json`; the bundled runtime used is `orderflow-price-grid-runtime.cjs`.
- Final browser warning/error capture: `artifacts/orderflow-price-grid-browser-errors.json`. Reset restored default preferences; Candles, recent view and the normal viewport were restored. No orders or alerts were created.

## Limits and remaining work

Input is still JavaScript numeric market data; precision already lost when parsing a venue's raw decimal cannot be recovered by grid assignment. Output boundaries remain floating-point projection coordinates. Unsupported numeric ranges fail explicitly rather than being represented with arbitrary-precision chart axes.

The subsequent Session Volume Profile/TPO assignment-and-projection audit is linked above. Fixed-range/visible-range estimates still require separate grid audits. These corrections do not establish all-profile or TradingView/Vela parity. Partial classified history, mobile header overlap, the separate intermittent older-native-candle issue and licensed Nasdaq real-time/US-depth coverage remain open.
