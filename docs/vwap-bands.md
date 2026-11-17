# VWAP Bands

Reference inspected on 2026-11-04:
https://docs.luxalgo.com/platform/charts/order-flow/vwap

The existing `vwap` catalog entry is now VWAP Bands under Order flow, using the
`af-vwap` native descriptor. Its persisted definition ID is unchanged. It uses
the host's candles and volume on every market; no classified executions are
needed or inferred. The original point-anchored VWAP drawing remains available.

Controls: Session / Week / Month / Quarter / Year anchors; eight native price
sources including HLC3 (default), OHLC4 and Close; Standard Deviation or
Percentage; three independent band pairs and multipliers; hide on 1D or above;
bull/bear colors, band fill color and fill toggle. Band 1 defaults on at 1;
Band 2 and 3 default off at 2 and 3. Anchors use UTC calendar boundaries, with
Monday weeks. The average inherits the host candle session, rather than
fetching another regular/extended tape.

Corrections to the pinned native implementation:

- Weighted population deviation is computed with stable incremental moments,
  avoiding the cancellation of `E[p²] - E[p]²` on a large price base. Finite
  HLC/OHLC sums also avoid overflowing before division.
- Band 2 and 3 retain their real titles, IDs and fill references when earlier
  bands are disabled. Explicit null slots clear disabled renderer buffers.
- Daily hiding uses the actual chart interval, including a one-bar daily
  chart. A sparse intraday tape or weekend gap does not make it a daily chart.
- The primary-chart generic source field no longer overwrites VWAP's native
  HLC3 default with Close. Settings show and retain the complete native Source
  input, including OHLC4/HLCC4, instead of the generic six-source dropdown.

Leading zero-volume bars remain gaps; later zero-volume bars carry the weighted
state without contributing price. Missing volume is not invented. A malformed
contributing observation makes the rest of its anchor period unavailable;
the next anchor can recover. Failed recalculation clears previously emitted
series. Native history, candle corrections and Replay trigger fresh prefix-only
calculations. Instance state is separate and requires no polling or trade feed.

Verification:

- Sixteen new VWAP tests, plus existing anchored-VWAP coverage, compare an
  independent two-pass oracle at every prefix; exercise all five reset clocks,
  all sources, large-base precision, percentage offsets, zero-volume handling,
  explicit interval hiding, corrections/deeper history, bad periods, stable band
  names/fills, input preparation and native suspend/resume/settings lifecycle.
- **2,042 tests across 189 files passed**, TypeScript and production build
  passed. Logs: `artifacts/vwap-bands-tests.log`, `artifacts/vwap-bands-build.log`.
- `scripts/verify-vwap-bands-live.ts` compared 720 closed Kraken BTC/USD hourly
  candles against independent raw-tuple weighted two-pass calculations:
  21,600 prefixes over 30 anchor/source/mode configurations, all three pairs,
  with absolute tolerance 0.000001. Capture: `artifacts/vwap-bands-live.json`.
- Isolated production-browser checks: Orderflow library entry; HLC3 default;
  Week + OHLC4 + Bands 2/3; correct band names/readouts with Band 1 off; 1D
  hiding on/off; reload persistence; 414×720 settings; candle Replay and exit.
  Screenshots: `artifacts/vwap-bands-native.png`,
  `artifacts/vwap-bands-mobile-settings.png`, `artifacts/vwap-bands-replay.png`.

Remaining acceptance: populated multi-chart behavior, direct current Vela
visual/default comparison across all modes/themes, full-capacity performance,
and the broader Orderflow checklist. This verification proves the described
candle calculations and interactions, not complete market-data or platform parity.
