# Multiple footprints per candle

The Footprint chart type now has five independent native settings instances. Footprint 1 is always present; the native `+` adds Footprint 2–5, and the active removable tab's cross disables it without losing its settings. Each instance owns its display mode, row grid, numeric cell choice, average-size calculation, colors, diagonal/stack settings, statistics and unfinished-auction options.

Reference inspected on 2026-11-04: https://docs.luxalgo.com/platform/charts/order-flow/footprint

The five slot defaults were additionally checked against Vela's public application configuration: Bid × Ask Profile / Right, Bid × Ask Ladder / Left, Volume Profile / Within, Delta Profile / Right and Absolute Delta / Left. Existing explicit saved choices take precedence.

## Positions and rendering

Right and Left profiles occupy separate lanes around the candle. A Within instance occupies the candle lane. The first enabled Within instance wins; subsequent Within preferences render on the Right without rewriting their saved settings. Removing the earlier Within instance lets the next requested Within preference take effect. The configured lanes share the available bar spacing so they cannot overlap each other or the corresponding footprints of neighboring candles. The candle stays at its timestamp and is hidden when a readable Within footprint occupies it. Narrow profiles fall back to candles; exact Vela cross-fading remains unfinished.

Unfinished-auction boxes and ray origins use the same instance geometry as the volume cells. Off-screen candle anchors do not discard a side profile whose assigned region remains visible. A single source candle is painted rather than one candle per footprint.

## Collection and inspection

`FootprintHistory` keeps one execution tape, one deduplication set and one chronological delta path per candle. Up to five named grid views keep separate incremental price rows and caches. Changing one grid or imbalance configuration does not rebuild the other views. Disabled views release their rows. Whole-candle eviction, source changes and precision/capacity failures apply consistently across views. The combined grid-row limit remains 200,000; a failure withholds derived output instead of truncating quantities.

The native **Data window / inspection** selector chooses the instance published to the existing data window and capture UI. If the selected instance is disabled, Footprint 1 is used. The readout explicitly names the inspected instance. Captures and CSV include its `fp1`–`fp5` identifier; switching the published instance invalidates a stale capture target. Legacy captures without an instance identifier remain readable.

Existing Footprint 1 keys remain unchanged. Instance 2–5 values have separate flat `fp2…`–`fp5…` keys in the SDK's per-type settings bag, including nested color and conditional-control keys. Native capture, cells, saved layouts and strict workspace backup validation preserve enabled and disabled instances. Unknown keys and malformed values are rejected.

## Verification

- Twelve new regressions cover independent settings, the Within rule, disabled-state JSON capture, namespaced native controls, all 243 requested position combinations, shared-tape deduplication and cache isolation, whole-bar eviction, disabled-grid release, combined capacity failure, five painters on one candle, visible side profiles with off-screen anchors, simulation/live resets, inspection identity and CSV. The existing cell/layout/backup round-trip now carries multiple instance settings.
- `scripts/verify-footprint-instances-source.ts` independently groups retained raw Binance/Kraken/Hyperliquid tuples into five grids. It checks incremental additions, duplicate overlap, per-side volume/counts, bar totals and isolated regrids: 171 price rows across 2,010 executions. Evidence: `artifacts/footprint-instances-source.json`. The source capture is from 2026-11-04T18:39:55Z; this is not a fresh network collection.
- Synthetic 100,000-execution model timing: approximately 87 ms for five initial grids and under 1 ms for 100 subsequent five-grid cached reads on this machine. This measures model work, not complete browser rendering.
- `tests/browser/footprint-instances.ts` and `scripts/verify-footprint-instances-browser.mjs` provide an explicitly simulated comparison: five profiles on the same candle, six shared executions, native settings, removal/re-addition and isolated-origin reload persistence. `artifacts/footprint-instances-comparison.png` is the five-mode comparison.
- The complete production app was checked on an isolated loopback test origin with ephemeral test authentication: native five-instance creation, separate defaults, Footprint 5 row size 25, inspection selection, reload and 414px navigation. Long labels were shortened after the structured desktop settings grid exposed horizontal overflow; the final visible grid reports equal client/scroll widths (308 px in the full app, 309 px in the fixture). The final app browser reported no console errors. The real site credential was not read or changed. Screenshots: `footprint-instances-settings.png` and `footprint-instances-mobile.png` under `artifacts/`.
- Full suite: 2,149 tests in 198 files pass. After checking and aligning the five reference slot defaults, all 83 focused Footprint tests also pass. Standalone TypeScript and the final production build pass. Logs: `artifacts/footprint-instances-tests.log`, `artifacts/footprint-instances-build.log`. The local production server was refreshed; HTTP 200 still serves the password gate. Temporary test servers were stopped.

## Remaining fidelity work

This does not establish complete Vela parity. Direct Vela geometry/default comparisons, smooth zoom opacity, exact numeric alignment and mode-specific palettes, value-area shading, projected POC/stacked references, all ten statistics, volume filters, hover/magnifier, the edge-pinned range variant, overlays, populated multi-chart and browser recording/reload/Replay acceptance remain open. Venue-specific collected data does not establish Vela's historical execution coverage or consolidated equity data.
