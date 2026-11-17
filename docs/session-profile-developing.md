# Developing session POC and value area

Reference: https://docs.luxalgo.com/platform/charts/order-flow/volume-profiles, inspected 2026-11-04. The documented session-only Developing POC and Developing VA controls draw dashed migration traces. Rolling profiles deliberately omit both controls. A focused inspection of Vela's public client confirmed cumulative per-candle observations on the currently observed session grid, 4/3 dashes, independent POC/VA switches, and a terminal step bounded by the session/revealed-chart end.

`volumeProfileModel.ts` now emits a cumulative point after all retained classified executions in each chart time bucket. A point contains the canonical POC center, VAL/VAH edges, cumulative quantity and execution count. Day, Week, Month and trading-hour calendars share the existing session assignment. Session-crossing chart buckets are clamped to the session. No execution from a later bucket contributes volume to an earlier point.

The points share the final **currently observed** session grid. New extrema can change the automatic row size or grid extent and therefore move earlier POC/VA positions and tie resolution. These are rebinnable observed prefixes, not immutable historical signals. An unfinished live bucket uses only its observed executions; the existing Replay source supplies only the revealed archive prefix. Missing source history remains unknown. An empty candle does not manufacture a new observation.

`volumeProfileSettings.ts` exposes independent, default-off Style controls. The painter uses the existing POC and VA colors with dashed steps; final-level visibility does not suppress developing traces. Rolling settings suppress and reset both flags. The data window separately labels the selected observed candle's cumulative quantities and grid semantics. The new options do not publish market events or alerts.

The native indicator passes the chart interval through synchronous and worker paths. Interval and developing-option changes invalidate cached models and fence obsolete results. Developing snapshots above 1,000 executions use the shared worker; other profiles retain their existing 10,000-execution threshold. The shipped worker has been regenerated.

## Verification on 2026-11-04

- Twelve new regression cases cover equal-time grouping, an independent prefix POC oracle, Day/Week/Month final-level agreement, revealed-prefix rollback and auto-grid rebins, clipped custom windows and duplicate trades, independent controls/rolling exclusion, shipped-worker equivalence, dashed paths, asynchronous invalidation and data-window provenance.
- All **2,079 tests in 192 files** passed, including the earlier three Kraken recovery follow-up cases. Standalone TypeScript checking and the production build passed. Logs: `artifacts/session-profile-developing-tests.log`, `artifacts/session-profile-developing-build.log`.
- `scripts/verify-session-developing-source.ts` independently checks raw tuples from the retained public Kraken capture dated 2026-11-04T17:56:56.380Z: **1,000 executions, 636 prefix comparisons** across 1s/1m and 70%/100% VA. It compares POC, both VA edges, cumulative volume and execution count. This is a retained capture, not a fresh network collection.
- The same script checks the 100,000-execution model capacity with synthetic observations: 80,000 points, 24 rows, about 118 ms in the local Node run. This does not establish full browser rendering performance or the worst-case 2,000-row load.
- Native Vela fixture screenshots show all three traces, a 60-to-20 revealed-candle rollback, and independent POC/VA toggles. The fixture is explicitly simulated; it does not prove combined archived recording/reload/Replay acceptance.
- In the actual protected production-build test instance, the newer New York session study exposes both controls, applies them, and retains both after browser reload. The 414px settings view fits both controls and the Apply action. No captured browser console errors in this check. The older hidden Month study remains intact.

Screenshots: `artifacts/session-profile-developing-full-fixture.png`, `session-profile-developing-prefix-fixture.png`, `session-profile-developing-settings.png`, and `session-profile-developing-mobile.png`.

The rebuilt local production instance was restarted on port 3000 (PID 4592) and returned HTTP 200 with the password gate intact. The loopback test servers on 3001 and 4321 were stopped after verification.

Direct side-by-side Vela binning/VA/numeric/visual equivalence, worst-case browser performance, populated multi-chart behavior and combined browser archive Replay remain open in `vela-orderflow-parity.md`. The overall Orderflow parity objective is not complete.
