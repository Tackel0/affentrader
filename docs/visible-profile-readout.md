# Visible Range Profile inspection — 2026-11-01

The Data window now exposes the native VPVR renderer's current painted profile. It shows the selected volume source, first/last included candle in UTC, included candle count, POC row boundaries/center, value-area boundaries, area volume/share and actual price-row count. Classified mode additionally shows first/last observed execution, observed count, buy/sell quantities, total, delta and delta percent. OHLCV mode displays estimated candle volume and excluded invalid candles, without presenting candle direction as aggressor-side volume.

These are whole visible-range snapshots, including partially visible end candles. Crosshair movement alone does not turn a range total into a candle value or historical signal. Classified Replay uses only completed candles and explicitly loaded archived observations. The included-candle labels use the clipped source bars, excluding a forming Replay candle. Unknown history and recording gaps remain unknown. Quantity/percentage display uses 12 significant digits to suppress binary arithmetic residue; price boundaries and centers retain their model Number representation to distinguish narrow rows.

## Ownership and stale-value fences

The native contribution includes its stable native handle ID in its renderer payload. Each renderer layer publishes its actual result, selected bounds and settings under that ID, scoped to its owning chart cell. There is no second profile calculation in the Data window. Multiple VRVP instances are now available from the catalog; an obsolete singleton restriction was removed. Each instance retains its own source, rows, styling and readout.

Consumers accept only visible native handles with the matching symbol, timeframe, market epoch, feed mode/candle source/archive revision stamp, normalized settings, live/Replay state, completed Replay cutoff and current native visible time range. Panning before a new paint hides old numeric rows. Pending workers, missing observations and calculation failures display their notice instead of old quantities. Renderer destruction/null payloads clear owned surfaces; cleanup from a previous owner cannot delete a replacement surface. The shared Data-window observer uses the public native `getVisibleRange()` and existing 250ms refresh, alongside chart/config/crosshair events.

## Verification

The full suite passes **1,635 tests across 143 files**, including source separation, decimal display, narrow POC precision, viewport/settings/source/market/Replay fences, independent identities/cells, owner-safe cleanup, pending/error/empty states, shared Data-window refresh and completed-only included bounds. Production build includes TypeScript validation.

Actual production-browser checks with an existing real Hyperliquid BTC archive:

- At the completed 12:40 UTC 5m candle, the Data window and painted classified VRVP reported 983 executions, buys 20.42795, sells 7.9804, total 28.40835 and delta 12.44755. The window exposed POC row `[77857.8, 77860.6)`, center 77859.2 and value area `[77804.6, 77883)` from that painted 40-row model.
- A pure crosshair move preserved the range readout. Zooming from eight to three included candles reduced the observations to 699, buys 12.55891, sells 5.52663, total 18.08554 and delta 7.03228. Those quantities equal the independently checked 983-prefix minus its earlier 284 observations.
- Seeking back to the completed 12:20 UTC candle rebuilt the readout to 284 observations, buys 7.86904, sells 2.45377, total 10.32281 and delta 5.41527. Source switching displayed the OHLCV estimate separately, with no buy/sell/delta rows.
- Final production build: two actual native instances reported independent 40-row classified and 24-row OHLCV results. The same eight selected candles yielded 28.40835 observed volume versus 274.7319 estimated candle volume. Hiding the classified instance removed only its section; showing it restored it. The temporary second instance was then removed, leaving the original study intact.
- The final Number presentation removed visible binary sum residue and shortened percentage readouts, while POC bounds stayed unrounded. At the normal 414px viewport the responsive profile updated to the narrower range (699 observations), rendered its rows in the mobile Data window, and document width remained 414px. Temporary desktop viewport overrides were reset. Browser warning/error inspection was empty. Archive recording remained off.

Artifacts are saved under `artifacts/visible-profile-readout-*`. This feature does not provide complete exchange history, original-arrival execution Replay, equity aggressor/depth data or full TradingView parity. Fixed Range drawings retain their canvas captions/settings and do not yet have a dedicated Data-window section.
