# Volume Bubbles

Reference inspected 2026-11-04:
https://docs.luxalgo.com/platform/charts/order-flow/volume-bubbles

Indicators → Order flow → Volume Bubbles adds a native price-pane overlay.
Total mode colors a circle by its dominant aggressor side (or Neutral); Delta
mode draws proportional buy/sell sectors. Both encode total traded quantity
in radius. Highlight rings, labels, opacity, gradient fading and hover values
are independent settings. Manual bucketing uses the explicitly entered price
tick size and integer ticks per row; decimal multiplication uses the canonical
price grid. Auto rows follow the pane's price range and height.

Each cluster is one chart time bucket and one price row of retained classified
executions. IDs are deduplicated by the shared FootprintHistory collection.
Volume bounds, relative visible-maximum threshold, absolute delta percentage
and deterministic top-N filtering select at most 500 bubbles. The visible
maximum is measured before filters; panning and zooming recalculate it.
Circle radius uses a square-root volume ratio between the configured bounds.
This interpolation is an explicit implementation choice pending direct Vela
visual comparison, not a claim of pixel equivalence.

The native instance collects bounded live data independently of the rolling
market-service buffer. Style edits preserve accumulated history. Archive
revision/source changes rebuild it. Completed-bar Replay uses only an explicit
archive prefix, resets on backward seeks, and never attaches to live trades.
No candle-volume fallback is used. Missing classifications/archives, unsupported
intervals and capacity/precision failures produce coverage notices rather than
invented clusters. Late callbacks are fenced after suspend and stop.

Tests: `tests/volume-bubbles.test.ts` covers independent sums, deduplication,
filters, viewport normalization, exact tiny/decimal grids, pie proportions,
inverted projections, hover values, input validation, retained style changes,
live batching, wrong symbols, lifecycle fences, archive changes and backward
Replay. The pure renderer tests do not prove browser rendering or visual parity.

Verification on 2026-11-04: all 1,761 tests in 162 files pass, including 11
focused Bubbles tests. Production build and TypeScript pass. On an isolated
loopback-only production test server, actual Binance BTCUSDT observations
painted Total circles and Delta sectors on 15m/1m charts. The coverage dialog
reported 618 retained executions at the inspected checkpoint. Hover showed a
price interval and separate buy/sell/total quantities. Delta/Auto settings,
manual tick size and labels persisted through browser reload. A 414×720 settings
dialog fits and scrolls with its action buttons visible. Captured browser
warning/error log was empty. Evidence: `artifacts/volume-bubbles-tests.log`,
`volume-bubbles-build.log`, `volume-bubbles-live.png`,
`volume-bubbles-tooltip.png`, `volume-bubbles-mobile-settings.png`.

These UI checks do not independently reconcile every live bucket against a raw
exchange capture, prove pixel equivalence with Vela, test full-capacity rendering,
or establish multi-chart/browser Replay parity. Recorded-prefix behavior is
currently covered by model/descriptor regressions. The existing password
configuration was not changed; the temporary test listener has separate
process-only authentication.

The complete parity checklist is [vela-orderflow-parity.md](vela-orderflow-parity.md).
