# TPO render-state cleanup and presentation evidence

**Evidence correction:** the prior reproduced-display-failure claim is superseded by [the screenshot re-audit](tpo-presented-evidence.md). The cited before/after/idle captures each contain 12792 blue pixels with intact profiles. Canvas state cleanup below is independently tested; it is not proof of a raster defect or fix.

The TPO painter and shared canvas-layer wrapper now restore their saved Canvas2D state in `finally` blocks. A projection exception previously skipped both cleanup operations and could leave nested clipping/state frames on the context. This is an independently demonstrated defect; it is not the established cause of the disappearing TPO histogram.

The regression test uses the actual wrapper, cell binding, TPO model and painter. It injects a projection failure, verifies that both saved frames are released, then verifies 40 subsequent frames with all 12 expected histogram rectangles and no accumulated saved-state depth. A second test covers normal rendering, geometry-only diagnostics, explicit pixel diagnostics and the histogram-off negative control.

## Opt-in diagnostics

`?tpo-frame-audit=1` logs `[tpo-frame-audit]` at most twice per second per context: source count/tail timestamp, rectangle count, projected area, session geometry, settings, canvas dimensions, bounds, scale and restored alpha/compositing mode. Normal rendering emits no diagnostic logs and performs no pixel reads. Geometry-only diagnostics also perform no pixel reads.

Adding `&tpo-pixel-audit=1` explicitly enables a blue-pixel count from the TPO layer. Readback can change browser raster behavior, so a successful pixel-audit run must not be treated as proof that asynchronous presented frames are stable.

## Production verification and remaining failure

- **1,479 tests across 129 files passed.** Production compilation, TypeScript and static generation passed (`artifacts/tpo-render-state-tests.log`, `artifacts/tpo-render-state-build.log`).
- An initial diagnostic run with pixel readback showed intact profiles after a direct Replay seek to 04:00 and sidebar scrolling. This run is observational only.
- The final build was checked with geometry-only diagnostics, BTC/Hyperliquid, 5m, UTC and EMA/Volume. Replay followed 00:15 → 01:05 → 04:00. The Data window moved from developing IB (4/12) to complete IB (12/12); the final IB remained high 78,222, low 76,685, range 1,537.
- The initial 04:00, post-scroll and idle screenshots all show full TPO profiles, with identical measured blue counts. The earlier statement that most blocks disappeared is withdrawn for these artifacts.
- Concurrent geometry reports still showed 984 rectangles, projected area about 14,554.18, histogram enabled, 548 source bars ending at 04:00, canvas 874×539, unchanged session projections, source-over compositing and alpha 1. DOM canvas dimensions/positions remained consistent. These values establish that the painter attempts the same geometry; they do not establish the final pixels or a graphics-driver cause.
- Evidence: `artifacts/tpo-render-state-before.jpg`, `tpo-render-state-after.jpg`, `tpo-render-state-after-idle.jpg`, `tpo-render-state-geometry-audits.json` and `tpo-render-state-browser-errors.json`.

Candles, EMA20, Volume, Watchlists, UTC and 5m were restored; Replay and diagnostic URL flags were removed. Full chart parity, licensed Nasdaq data and the separate native-candle investigation remain open. Do not describe the cleanup hardening as a fix for the reproduced histogram failure.

Follow-up: [row batching and raster investigation](tpo-raster-investigation.md) records additional reproductions, removed failed workarounds and a no-reload readback intervention.
