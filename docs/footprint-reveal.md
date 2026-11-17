# Footprint zoom reveal and candle slots

The per-bar chart type and the Footprint study now share a raw-viewport-spacing
reveal: smoothstep from 5 to 10, exponential 140 ms easing, and a 0.001 end snap.
First frames, nonpositive frame deltas and gaps above one second snap directly
to the new target. Source changes, invalid contexts and backwards Replay seeks
reset the layer clock. A missing execution stream cannot reveal fabricated cells.

Side profiles narrow candle bodies towards 7% of normal width. Within profiles
fade body fills towards 7%, preserving wicks. Grid opacity falls with the reveal.
The normal Footprint overlay uses the SDK's `modulateBase`; the Footprint chart
type paints its own candles and uses the same modulation geometry. Independently
pinned Visible Range Footprint stays fully opaque and does not modulate the base.

Within owns the actual candle-body width. With groups on both sides, side regions
stop at half the bar pitch; one-sided groups can use the gap up to the next candle.
Multiple profiles on one side divide that region with bounded gaps. There is no
180 px profile cap or fixed 42 px all-or-nothing cell gate. Positive-width dense
histograms, VA/POC and projection marks fade together. Numeric row labels require
22 px and sufficient row height; statistics additionally require 60% reveal.
Hover ignores fully faded lanes but can inspect narrow visible rows. Shift retains
its dense-row magnifier. Pixel-identical label thresholds in every display mode
still require direct reference comparison.

## Native SDK animation contract

Vela 0.9.0 only started custom-layer clocks while viewport zoom animation was on,
and its animator's completion result ignored a layer that was still animating.
A frozen synthetic fixture reproduced a fade stuck at roughly 0.4. The pinned,
guarded `patch-vela-layer-animation.mjs` now starts layer clocks independently and
keeps frames alive while a visible, non-collapsed layer requests them. It stops
when all such layers settle. Five distribution bundles and both start sites plus
one animator-completion site per bundle are checked before any replacements.

## Evidence and limits

- Ten new regressions cover raw/prototype coordinates, numeric targets, frame-rate
  independence, clock resets/Replay rewinds, data loss, exact side/Within slots,
  fading histograms, candle fill versus wick opacity and statistics gating.
- Existing Footprint regressions were updated where they asserted the superseded
  42 px gate; calculations, raw counts, Replay guards and filters remain tested.
- `verify-footprint-reveal-browser.mjs` runs the real native renderer with an
  explicitly SIMULATED 400-candle classified tape. With native zoom animation off,
  a completed fade recorded 126 intermediate frames and reached opacity 0.
  Within reached body alpha 0.07; combined Left/Within/Right reached body scale
  and alpha 0.07. The intermediate-spacing and 414 px checks are retained in
  `artifacts/footprint-reveal-browser-evidence.json`; screenshots cover Within,
  three instances and the narrow layout. Browser error logs were empty.
- The actual local production app rendered live Binance Footprints, reset its
  price scale after a manual axis drag/double-click without opening an alert,
  and opened the price alert on a subsequent single click. Four gesture tests
  cover the 500 ms click arbitration, immediate context/Shift actions and cleanup.
- After the final SDK clock patch, all 2,284 tests in 211 files and the production
  build passed again. Logs: `artifacts/footprint-reveal-tests.log` and
  `artifacts/footprint-reveal-build.log`.

Reference behavior was inspected from the retained public Vela chart bundle listed
in `artifacts/vela-footprint-reference/index.json`, and the installed renderer SDK
types/source. The official feature guide is
https://docs.luxalgo.com/platform/charts/order-flow/footprint.

This increment does not establish complete Vela parity, historical execution
coverage, exact default colors/fonts, automatic row-grid parity, full-capacity
performance or populated multi-chart/recorded-Replay browser acceptance.
