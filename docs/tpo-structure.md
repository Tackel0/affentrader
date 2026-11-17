# TPO observed structure and Value Area tie correction

**Evidence correction:** prior histogram-disappearance claims in this checkpoint are superseded by the [presented screenshot re-audit](tpo-presented-evidence.md). The cited captures do not prove that failure. This does not affect the independently verified mathematical features.

The native TPO settings now have independent Poor high, Poor low and Interior single-print zones switches, with colors for poor extremes and single prints. All new switches default off and persist through the existing series-preference path. Older preference generations remain valid. The Data window always reports the observed structural ranges and opportunity counts, independently of marker visibility.

## Definitions and calculation

The public [TradingView TPO indicator reference](https://www.tradingview.com/support/solutions/43000713306-time-price-opportunity-tpo-indicator/) defines poor extremes as extreme price levels occupied by multiple TPO blocks and single prints as non-extreme levels occupied by one block. The implementation marks a poor high at the upper grid boundary of a multi-block highest row and a poor low at the lower boundary of a multi-block lowest row. Data-window ranges retain both canonical half-open row edges; they are grid levels, not claims that the raw OHLC high equals the upper grid edge.

Consecutive one-block rows form an interior zone only when bounded on both sides by occupied multi-block rows. Tapering tails and runs adjoining an empty price gap are excluded. The complete zone is shaded and bounded, with its row count and exact [lower, upper) extent available in the Data window. The model does not infer the first intrabar traversal from OHLC: this whole-zone display is not TradingView's single chosen chronological print marker. That exact selection policy remains a parity gap.

Structure is computed once with each session model. Styling reuses the model; older candle repairs, row-size changes and newly revealed/revisited prices rebuild it. Values describe the currently loaded session snapshot, may change during development and can be understated by missing candles. There is no historical signal or completed-profile alert claim. Each single-print zone is reported without truncation.

Reference review also exposed an existing Value Area discrepancy. The expansion now adds one neighbor at a time. On equal counts it chooses the neighbor nearest the POC; if distances also tie, it chooses the upper one. It stops when the target count is reached. Previously both tied neighbors entered together, potentially adding an unnecessary side. The existing POC selection policy (nearest range midpoint, lower on ties) is unchanged. This correction supersedes older documentation of simultaneous tied-neighbor expansion and can change displayed VA boundaries/counts.

## Verification

- **1,494 tests across 131 files passed**, with production build and final TypeScript passing. Logs: `artifacts/tpo-structure-{tests,build,typecheck}.log`.
- Eight new tests cover two tie-rule counterexamples, nearest-side and empty-row expansion, canonical structural edges, tails/gaps, developing revisits, legacy/native settings, cache reuse, actual regular/inverted painter coordinates, visibility and exact Data-window values.
- Actual BTC/Hyperliquid, 5m, UTC: the Auto grid reported seven one-block rows but zero interior zones, distinguishing tails from single prints. With a temporary 1,000 price row, the live profile reported poor high [78,000, 79,000) with 13 opportunities and poor low [76,000, 77,000) with five. Both orange boundaries/labels were visible. All switches and the temporary row size survived reload.
- Actual Replay at 00:15 showed no poor extremes. At 04:00 the same grid showed three high-row opportunities and five low-row opportunities. Disabling Poor high left Poor low visible. Native screens and numerical readouts are saved under `artifacts/tpo-structure-*`.
- A separate, explicitly simulated browser fixture runs the actual application model/painter on a real Canvas2D context. Its [101, 104) interior zone rendered 159,397 purple pixels and the poor extremes 4,667 orange pixels. Turning markers off produced zero of both; a later zone revisit removed all purple pixels while retaining the poor extremes. Report and image: `tpo-structure-fixture-report.json` and `tpo-structure-fixture.jpg`. This is a direct painter raster check, not a full native Vela integration or proof of every asynchronously presented frame.
- Reproduce the fixture with `node scripts/verify-tpo-structure.mjs` and open `http://127.0.0.1:4319/`, then Run raster checks. The server binds loopback only; stop with Ctrl+C. The verification server was stopped after this run.
- Candles, EMA20, Volume, Watchlists, UTC and 5m were restored; Replay stopped, Auto row sizing restored and the three new switches returned off. No browser console warnings/errors were captured in the final session.

The prior long-running tab showed Candle history interrupted before this build was loaded; `tpo-structure-prior-candle-recovery.txt` preserves that separate reliability observation. The known histogram raster failure, complete history recovery, mobile/very dense label layouts, extended structural levels and alerts, exact first-print policy, profile merge/split, full chart parity and licensed Nasdaq real-time data remain open.

The next checkpoint adds [completed POC/VAH/VAL reference extensions](tpo-reference-levels.md) with explicit full-session candle coverage. Poor-extreme and single-print extensions remain separate work.
