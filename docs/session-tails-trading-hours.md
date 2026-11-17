# Session Volume Tails trading hours

Reference: https://docs.luxalgo.com/platform/charts/order-flow/volume-tails, inspected 2026-11-04. Session Volume Tails is documented to share Session Volume Profile's day/week/month and trading-hour controls.

`volumeTails.ts` now uses the same `tpoTradingCalendar` engine as session profiles. Day sessions offer Full day, RTH, ETH, Pre-market, Market, Post-market, London, New York, Asian and Custom. Named windows are fixed UTC approximations; Custom accepts UTC HHMM, including overnight windows and 2400 as midnight. Impossible minute fields such as 1260 are rejected when Custom is active for Day. Existing custom day clocks, time zones and weekday filters remain available for Full day and continuous-venue RTH/ETH fallback. Week and Month remain UTC calendar periods and ignore day-hour controls.

Full day inherits the individual native chart's regular/extended mode whenever source windows exist. Explicit RTH/ETH selects the corresponding source calendar. Missing source dates are not extrapolated; unavailable ETH windows cause an explicit error. A venue without a source calendar falls back to the configured day clock, with this basis disclosed in the study status. No classified equity feed or exchange calendar is invented.

The native indicator captures chart-scoped calendar windows independently from its retained execution collection. The render-cache key includes these windows and their revision/mode. A calendar correction or chart-session change therefore recalculates quiet drawings without discarding executions that have rotated out of the service tape. Session filtering uses actual execution timestamps, including windows inside a chart candle, and remains subject to the existing loaded/revealed candle and archive-prefix limits.

The settings dialog reuses session-profile field definitions and conditionally shows day, custom-HHMM and clock fields. Rolling/Visible Tails do not gain session controls. The compact legend identifies the named or custom window; Week/Month labels identify UTC. The tail threshold, price-bin and weighted-mean formulas were not changed.

## Verification on 2026-11-04

- Twelve new cases in `tests/session-tails-hours.test.ts`: all six named UTC windows with inclusive/exclusive boundaries, overnight/midnight/invalid custom times, source RTH/ETH/inherited chart modes and missing ETH, legacy fallback and Week/Month behavior, metadata/conditional fields/legend, quiet calendar corrections with retained tape, and missing dates/completed Replay bounds.
- **2,091 tests across 193 files passed.** Standalone TypeScript and production build passed. Logs: `artifacts/session-tails-hours-tests.log`, `artifacts/session-tails-hours-build.log`.
- `scripts/verify-session-tails-hours-source.ts` independently compares raw timestamp membership, IDs and summed quantities for eleven configurations using the retained public Kraken capture dated 2026-11-04T17:56:56.380Z. All 1,000 observations are selected for Full day; Custom 1750–1751 selects 142 observations. The script's synthetic daily bar timestamps define eligibility only; their OHLCV values are not market data. RTH/ETH in this oracle exercise continuous-venue fallback, not an equity feed. Results: `artifacts/session-tails-hours-source.json`.
- Actual protected production-build test instance: added a separate Session Tails study while retaining the older hidden Week study. Verified ten options, hidden day controls under Week, Custom 1300–2200 fields and persisted values after reload, conditional removal of Custom fields under New York, the applied named-window legend, and 414px settings with the Apply action. No captured browser console errors. Screenshots: `artifacts/session-tails-hours-settings.png`, `artifacts/session-tails-hours-mobile.png`.

These checks do not prove direct Vela visual/formula equivalence, real classified equity-calendar integration, retained Replay calendars, full-capacity/multi-chart rendering, complete touch drag, or combined browser recording/reload/Replay acceptance. The broader Orderflow objective remains incomplete.

The rebuilt local production server was restarted on port 3000 (PID 26024). HTTP 200 and the password gate were verified; the loopback test server on port 3001 was stopped.
