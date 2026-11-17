# Exact, bounded DOM ladder — continuation documented 2026-11-02

The DOM panel now uses the separate `lib/orderflow/depthLadder.ts` math module. The previous implementation applied binary epsilons and a fixed ten-decimal rounding scale, which could collapse tiny prices. Its spread loop also scaled with every empty price row between best bid and ask. Both paths have been replaced. Verification below was captured on 2026-11-01; it is evidence of that production build, not a claim that an old quote remains current.

## Price and quantity contract

Bid prices group downward and ask prices upward using canonical decimal integer ratios. A genuine boundary and a price strictly beside it remain distinct. Ask ceiling uses exact divisibility, rather than comparing a rounded projection boundary with the input price. Working orders follow their side's bucket; the position marker uses an exact nearest-row rule. Grouping multipliers use decimal multiplication, so a binary product cannot silently change the selected row size.

Quantities are accumulated in decimal integers within each displayed bucket before conversion to chart Numbers. Nonfinite grouped totals fail explicitly. Tiny price labels retain their Number spelling; sizes use 12 significant digits instead of rounding small quantities to zero. Relative size bars normalize to actual positive size, including sizes below `1e-12`.

The compatibility export `bookTick` now measures canonical **observed spacing**. Sparse top levels do not establish the exchange's permitted tick size. The UI names this distinction and reports the actual row size and book timestamp. Grouped row prices remain app display/limit-price inputs; they do not certify venue filters or exchange order eligibility.

## Bounds and missing data

Each input side is limited to 1,000 levels, with positive finite prices/quantities, unique strictly ordered levels and an uncrossed spread. The model supports 1–100 rows per side and at most 100 intervening empty spread rows: at most 300 price rows overall. A wider spread retains the two side windows and adds a separate, explicit omitted-row marker. A test with 999,998,999,999 omitted empty rows yields only 24 price rows at the UI's 12-per-side setting. Depth outside those windows is not claimed to be visible. Grouping that would put the best bid at zero is rejected with a reduce-grouping explanation.

The panel requires a matching real two-sided book. Simulation and Replay exclude the live ladder. Books older than five seconds, excessively future-dated books, invalid timestamps and malformed levels clear displayed price rows. A 500ms clock updates this status even without another book event. The new-order controls are disabled while unavailable, and click handlers recheck current market/source/book age before requesting a paper command. Position/order management controls remain present. This availability check does not change the paper execution model: queued orders/fills still use the existing guarded paper-command and quote logic; depth is not consumed and partial fills/queue position are not modeled.

## Verification

- **1,650 tests across 144 files pass**, with production build/TypeScript validation. Ten DOM tests cover the previous behavior plus tiny prices, exact canonical sums, decimal multiplier products, strict bid/ask boundaries, rational ask-ceiling comparisons, nearest ties, dense/wide spread bounds, malformed/oversized snapshots, unsupported grids, quantity overflow, nonpositive grouping and source/age/Replay/simulation status.
- Actual production browser, real Hyperliquid BTC: fresh top-level rows rendered with the grouped row spacing 5 and an explicit UTC book timestamp. Bid/ask quantities retained their nonzero decimal sizes. No order-placement or position-management action was executed.
- An actual feed gap crossed the freshness threshold: rows disappeared and the new market controls became disabled. A subsequent fresh book restored the ladder. Replay displayed its missing-recorded-depth explanation and disabled new DOM orders, rather than mixing a live book with a historical account. Replay was exited after the check.
- Grouping was restored to ×1. At the default 414px viewport, toolbar/status/ladder remained accessible and document width equaled viewport width. Browser warning/error inspection was empty. Temporary viewport overrides were reset.
- Tiny-price and enormous-spread cases were model tests, not actual exchange observations. The production browser check covers Hyperliquid; every venue, extreme-price instrument and multi-chart transition remains unverified. Complete market depth, verified exchange tick/lot metadata and recorded depth Replay remain open.

Artifacts: `artifacts/depth-ladder-tests.log`, `depth-ladder-focused.log`, `depth-ladder-build.log`, `depth-ladder-typecheck.log`, `depth-ladder-live.jpg`, `depth-ladder-stale.jpg`, `depth-ladder-replay.jpg`, `depth-ladder-mobile.jpg`, `depth-ladder-browser-errors.json`.

The overall TradingView/Vela objective remains active. This continuation fixes the actual depth-analysis contract and display; it does not establish complete exchange or application parity.
