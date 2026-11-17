# Volume Tails: shared model and three native variants

Reference: [official Vela Volume Tails documentation](https://docs.luxalgo.com/platform/charts/order-flow/volume-tails), inspected 2026-11-04.

Visible Range, Rolling and Session Volume Tails are available under Indicators →
Order flow. They use classified execution prices and quantities, never a candle
direction estimate. Supply consumes sell bins downward from the observed high;
demand consumes buy bins upward from the observed low. Each targets Threshold %
of combined range volume. Defaults are 10%, 50 price bins and 100 rolling bars.
The crossing bin is included in full. A missing side has no zone; insufficient
side volume produces an explicit unmet-target notice instead of invented size.

Each side and equilibrium has independent area, average and weighted-average
toggles and colors. Side averages are zone midpoints. Weighted averages use side
quantity at bin centers. The equilibrium midpoint lies between the inner tail
edges; its average/weighted lines are the midpoints of the corresponding side
lines. When tails overlap, no equilibrium gap area is filled. These explicit
formula choices still require direct comparison with Vela's implementation;
the prose reference alone does not establish exact boundary/mean equivalence.

Visible tails follow the viewport. Rolling tails select the newest N loaded bars,
including the observed forming bar in Live mode. Session tails group actual trade
timestamps into custom calendar Day windows (DST, weekdays and overnight handling)
or UTC Monday Week / calendar Month periods. Week/month ignore the day-hour
controls. A session boundary inside a chart candle partitions trades at the
actual boundary rather than assigning the whole candle to one session.

Each instance retains its own observed executions beyond the service's rolling
display tape, bounded at 100,000 executions with explicit capacity failure. Native
renderer caches follow source/archive identity, settings, bar timestamps and
viewport. Removed/suspended callbacks cannot continue filling a replacement
instance. Replay requires an archive and exclusive completed-bar clock, rebuilds
when seeking backward and never subscribes to the live stream. Coverage is partial;
the range high/low comes from observed executions, not a claim of complete venue
history. No chart candles or timestamps are fabricated.

## Evidence

- Sixteen focused cases cover combined-volume thresholds, full crossing bins,
  missing/insufficient sides, midpoint/weighted calculations, exact range ends,
  rolling changes, completed Replay boundaries, UTC week/month boundaries,
  intrabar day boundaries, DST/weekends, source/ID conflicts, retention, stale
  callbacks, archive seek/removal, cache invalidation and rendering controls.
- `scripts/verify-volume-tails-capture.ts` independently assigns retained public
  Binance/Kraken records to bins using integer price arithmetic. Three resolutions
  and three thresholds give 18 passing comparisons for 40 Binance aggregates and
  five Kraken records. This reuses the earlier Volume Delta capture; it is **not**
  a fresh capture. Each source has only two distinct prices. Evidence:
  `artifacts/volume-tails-capture.json`, including source capture time and both
  expected/actual quantities, zone boundaries and means.
- The full suite passes **1,825 tests across 166 files**, production build and
  standalone TypeScript. Logs: `artifacts/volume-tails-tests.log` and
  `artifacts/volume-tails-build.log`.
- An isolated production browser checked all three catalog entries, actual live
  overlays, default 10/50/100 controls, independent weighted lines, a 100→20 rolling
  window change, reload persistence, Week session selection, visible-range pan/zoom
  and applying a threshold at 414px. Captured warnings/errors were empty. Screenshots:
  `artifacts/volume-tails-{rolling,session,visible,mobile-settings}.png`.

## Remaining parity work

Fixed Range Volume Tails with two-click placement, draggable anchors and an open
right end are now implemented separately in [fixed-volume-tails.md](fixed-volume-tails.md).
Venue-calendar RTH/ETH and named UTC trading-hour
presets, Full-day chart-session inheritance, exact Vela default colors/toggles,
direct visual/mean/boundary comparison, full-capacity performance, populated
multi-chart checks and browser recorded Replay remain open. Numeric model tests
do not establish those UI/source requirements. Generic native value-display
controls currently have no numeric plot aliases for these overlays.
