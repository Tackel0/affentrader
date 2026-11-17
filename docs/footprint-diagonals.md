# Footprint diagonal membership

Reference: https://docs.luxalgo.com/platform/charts/order-flow/footprint,
checked 2026-11-05. The official documentation defines diagonal side comparisons.
The retained public Vela client in
`artifacts/vela-footprint-reference/1-1mg-s23l974.js` supplies the additional edge
contract: the opposite row must exist and be visible. Positive own volume is
compared by multiplication against the ratio times the diagonal opposite side.
An observed zero side is valid; an absent or filtered price row is not a zero.

`footprintRows` now follows this rule for batch, incremental per-instance and
visible aggregate grids. It checks both directions independently, excludes hidden
own/counterpart rows and uses an inclusive multiplication threshold. An explicit
legacy `ignoreZeroOpposite` override still excludes observed zero counterparts;
the separate minimum imbalance volume override is retained. Display filtering
and average trade size recompute flags against the actually displayed membership.
Raw volume/count fields, observed auctions, cell values and source tape stay intact.

This fixes false extreme/gap flags and the stacks those flags could create. Old
tests that asserted a missing row was zero were corrected. Canonical stack tests
now supply a genuinely observed lower diagonal, so they still test real stacks.
No market event, alert callback or synthetic trade is emitted by this calculation.

Evidence on 2026-11-05:

- Ten focused cases cover isolated/extreme/gap rows, observed zero versus missing,
  explicit nonzero policy, inclusive ratio/minimum and floating point boundary,
  hidden own/neighbor membership, per-side means, raw immutability, regridding,
  actual stacks, late incremental updates, visible aggregation and candle/Replay
  prefix isolation. Focused regression: 277 tests in 25 files passed.
- `scripts/verify-footprint-diagonals-source.ts` uses the retained 2026-11-04
  23:19:16 UTC raw public capture, independent decimal integer row assignment and
  independently decoded Binance/Kraken/Hyperliquid observations. It compares
  raw/mean sizes, three ratio thresholds and three display filters over multiple
  grids: **99,972 side-flag decisions / 49,986 rows**, including 59,832 absent,
  6,084 positive-versus-observed-zero and 20,244 hidden membership checks. These
  counters are exercised comparisons across configurations, not unique trades.
- Previous independent cells and stacked-zone verifiers were updated from the
  old missing-as-zero assumption and rerun. Cells: 61 rows. Stacks: 703 zones
  across 192 configurations (93 Binance / 610 Kraken / 0 Hyperliquid), 357 observed
  revisits. The older 1,130-zone result is superseded by this corrected contract.
  Logs: `artifacts/footprint-diagonals-{cells,stacked-zones}-source.log`.
- Native simulated renderer case matrix distinguishes isolated rows, actual zero
  sides, interior gaps, filtered neighbors and simultaneous exact-threshold flags.
  Only the observed-zero upper ask and the valid central bid/ask have highlights.
  Console warnings/errors are empty. Screenshot:
  `artifacts/footprint-diagonals-renderer.png`; browser evidence JSON alongside.
- Full suite: **2,316 tests in 213 files passed**, production build passed.

Limits and next comparison: this establishes diagonal membership and threshold
semantics, not full rendering/source equivalence. The same reference inspection
found highlight and value recolor default off, independent Ask/Bid outline colors,
independent Ask/Bid text colors, configurable 1–10 highlight width (default 2), and
a 100–10,000 percent ratio control. Affentrader's current default-on switches and
shared colors/ratio UI remain a concrete implementation gap. Direct full-mode
pixel comparison, populated multi-chart and recorded browser Replay remain open.
