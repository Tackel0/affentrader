# Large waiting orders in DOM

Official documentation: https://docs.luxalgo.com/platform/workspaces/order-book
(Large orders). The public chart's lazy-loaded Order book module was inspected
2026-11-06. Reference module:
`https://vela.luxalgo.com/_next/static/chunks/0kh_muujoeolo.js`, SHA256
`42f2ea4bd3efd7d848ef453f8648616c6fd3469feeaddc70f9ed51c763278c6a`.
The local public-source capture is excluded from the website upload package.

Implemented numeric contract from the reviewed `B`, `H` and actual DOM tier
branch:

- Include populated bid and ask levels in the visible ladder viewport, using
  each grouped row's price times its waiting quantity (quote value).
- Relative mode requires at least six populated side levels. Its typical value
  is the upper median, including the upper member for an even count.
- Relative choices are 2/3/5/10/20×, default 3×. Set amount uses a positive quote
  value and requires no minimum sample count.
- Large starts at the threshold inclusively. The strongest tier begins at five
  times that threshold, also inclusively. Empty slots are not observations.

Large values use weight 600 and a 30% side-color bar. Normal bars use 14%; the
strongest tier adds a 1px inset side-color outline at 60%. Read-only locked
buttons retain opacity 1 so disabling click trading does not dim the book.
Default side colors are used; configurable DOM colors remain a separate gate.
The calculation is independent of the selected execution-display unit.

Highlight settings are persisted in the validated DOM view preferences. Existing
backups/local preferences without `highlight` remain valid and gain default 3×
without losing their saved view. Invalid amount drafts leave the previous valid
threshold applied with an explicit hint. The reference also exposed a 10-second
Timed default: new default preferences now use 10s, preserving existing values.

Four regressions cover median/minimum observations, both tiers and inclusive
boundaries, fixed quote semantics and legacy-preference validation/defaults.
`scripts/verify-dom-large-orders-reference.ts` pins the public source hash and
executes only the reviewed arithmetic helpers/branch in an isolated VM. All 4,608
threshold cases and 373,462 classifications match exactly. It additionally pins
the reference's Timed default. This is comparison on the same prepared visible
rows, not raw-book aggregation or complete renderer equivalence.

Actual-component browser acceptance uses seven controlled populated levels:
upper median 102, default large 306/block 1530; bid 98×20 receives the outline,
97×4 receives the middle tier, and normal levels stay unmarked. Computed styles
verify weight, opacity, bar alpha and ring. Relative 20× clears these marks;
fixed quote amount 400 leaves only the expected middle-tier bid. The fixed value
and resulting classification survive actual workspace reload. Prior saved group,
follow/unit and columns remained present when the new default was introduced.
The final warning/error list is empty.

Evidence under `artifacts/`: `dom-large-orders-reference.json`,
`dom-large-orders-browser-checks.json`, `dom-large-orders-browser-errors.json`,
`dom-large-orders-relative.png`, `dom-large-orders-fixed.png` and
`dom-large-orders-{targeted,tests,typecheck,build}.log`.
Full gate: 2,437 tests in 234 files, standalone TypeScript and production build.

DOM custom colors and reference zoom metrics were subsequently implemented in
[dom-style.md](dom-style.md).

Open: complete pixel comparison, raw venue grouping/tick-rule
equivalence, full-capacity browser/multi-chart and live/hosted acceptance. These
checks do not establish full Vela DOM, Book or Trades parity.
