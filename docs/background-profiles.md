# Background Developing Fixed Range Volume Profiles

Developing profiles over 200 loaded candles run in a shared Web Worker. The worker executes the existing `FixedProfileCache` and rational range-grid implementation without substituting a different estimator. Small profiles, static profiles and capacity validation retain the immediate path. The 5,000 developing / 50,000 static limits remain.

`BackgroundProfile` snapshots every OHLCV field, settings, anchors and the owning canvas cell context. Before committing a response it checks the current range, all candle fields, inputs, context and connected canvas again. Changed snapshots expose a pending caption instead of geometry belonging to another range. Worker completion requests a native repaint through a version-checked extension to Vela 0.9's drawing projector; it does not edit drawing history or introduce a continuous renderer loop.

One CPU worker serializes jobs and retains the newest queued request per drawing, bounded at 64 queued drawings. The worker caches at most 64 drawing histories and 250,000 source bars. Incremental updates preserve the original prefix cache. Worker errors remain visible until inputs change rather than entering a repaint/retry loop. A superseded active computation finishes in the worker and its result is discarded; it is not forcibly interrupted. Sustained edits or many large profiles can delay a fresh result, while the UI remains available.

## Verification

- 1,406 tests in 119 files passed; production build and TypeScript check passed. Logs: `artifacts/background-profile-tests.log`, `background-profile-build.log`, `background-profile-targeted.log`.
- Nine new tests exercise pending/reuse, context switches, old-bar corrections, settings, detached charts, explicit errors, queue coalescing and execution of the actual bundled worker against the exact synchronous result, including an old-bar repair.
- The native, explicitly simulated 5,001-bar browser fixture calculated all 5,000 developing prefixes. A counter click completed during calculation; the animation heartbeat continued, with a 68 ms maximum observed frame gap including initialization. The completed profile appeared after the pending caption. This is a local fixture observation, not a universal performance guarantee or exchange-data test. Evidence: `artifacts/background-profile-complete.jpg`, `background-profile-browser.txt`.
- A fresh fixture started the developing calculation and immediately restored static mode. The static profile remained after the superseded calculation finished: `artifacts/background-profile-superseded.jpg`. No warning/error entries were captured for the fixture.

The native source caption now paints after all profile geometry in the upper visible pane, rather than below the profile where clipping/volume could conceal it. Two tests execute all five native painters to verify foreground ordering, pane bounds and missing-layout notices. The final 5,000-prefix browser screenshot shows the completed profile with its OHLCV estimate/count/volume caption: `artifacts/background-profile-caption.jpg`. That run retained the responsive counter, with a 124 ms maximum observed heartbeat gap including initialization, and no captured warnings/errors.

The initial math remains quadratic; moving it off the main thread addresses UI blocking, not total CPU cost. Multiple overlapping drawing captions can still overlap each other. The historical-candle investigation, full parity audit and exchange-data entitlement gaps remain open.
