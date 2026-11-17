# Vela Orderflow parity

Objective: reproduce the entire Vela Orderflow segment, including interaction,
settings, rendering and source semantics. Completion is **not established**.
This checklist is based on the official documentation inspected on 2026-11-04;
existing implementations and old TradingView audits do not prove Vela parity.

Multi-chart Replay now delegates to the installed SDK's shared-clock controller.
Real two-column Kraken 1m/5m acceptance verifies independent completed-bar
orderflow cuts, active-cell switches and backward seeking. Deferred React joins
and failed starts are covered with the actual SDK controller in seven regression
tests. See `workspace-replay.md` for quantities, evidence and remaining gates.
This increment remains local; Netlify publication is deferred by user choice.

The independent whole-profile Area background now includes observed gaps and
filtered boundary rows, preserves canonical upper bounds, and remains separate
from the Value Area fill. Eight regressions, 9,720 actual reference-painter
comparisons and a frozen native visual comparison are recorded in
`footprint-background.md`. All 70 static Footprint reference input keys are now
represented after reviewed aliases; dynamic controls, exact defaults/visibility
and complete rendered equivalence remain unproven.

Statistics table follow-up now matches compact/signed numeric formatting,
zero-denominator side suffixes, first-enabled merged-row order and chart-theme
direction colors independently of candle palettes. Six new regressions,
147,456 actual table-painter operation comparisons and native wide/narrow
visual evidence are in `footprint-statistics-style.md`. Unknown underlying
counts remain unavailable rather than using partial-known combined totals.

The final Footprint structure layer now paints VA fill/boundaries after cells
and numbers, then POC outlines inside the one-pixel row gap. VA/POC line gates
use the reference's ten-pixel slot width. Default POC outlines and rays share
light/dark color resolution. Five regressions, 5,400 direct structure-painter
comparisons and frozen native light/dark visual evidence are in
`footprint-structure.md`. Cell text-color/default and full-renderer auditing
remain open.

New Footprints now default to the reference text palette. Text color and the
explicit legacy chart-theme override are grouped in Values, with the custom
picker visible only when that override is off. Dark default POC is corrected to
white, with shared light adaptation for outline/rays. Five regressions and forty
actual reference-parser palette comparisons are in `footprint-theme.md`.
Explicit default-marker selections now retain intent via equivalent eight-digit
CSS emitted by the native picker, including a valid unchanged hex Apply. See
`footprint-color-intent.md`: targeted regressions, eighty reference-parser
comparisons including marker collisions, and native picker/theme evidence.
Old marker intent cannot be inferred retrospectively. Complete controls and
renderer parity remain unproven.

The actual complete per-profile painter now has a real Canvas pixel comparator
against the reviewed reference `ix` path, including independent reference row
preparation in seeded extended cases. It found and fixed the missing center axis
in Bid × Ask Profile and Delta Profile. All 4,520 tested cases match at RGBA pixel
level: 2,520 exhaustive default-mode/width/height/reveal/theme/highlight cases plus
2,000 reproducible extended setting combinations. See `footprint-renderer.md` for
scope and reproduction. This closes that tested profile-layer raster gap, not
side-candle/overlay/hover, multi-chart, Replay or whole-family acceptance.

Normal row hover now uses full observed bands, reads raw display-filtered
observations and paints the measured reference-style tooltip, replacing the old
forty-pixel hit cap/fixed panel. Five new tests, 62,208 exact reference popup
drawing-operation comparisons and native real-pointer/filtered/mobile evidence
are in `footprint-tooltip.md`. Shared-edge/overlap arbitration, magnifier geometry,
capacity, touch, multi-chart and recorded Replay acceptance remain open.

Reference: https://docs.luxalgo.com/platform/charts/order-flow/introduction

Footprint zoom increment: raw-spacing 5–10/140 ms reveal, side/Within candle
modulation and inter-candle slot packing now have dedicated numeric regressions
and native renderer evidence, including independent layer clocks with viewport
zoom animation disabled. See `footprint-reveal.md`. Direct full visual/default
equivalence and the remaining family acceptance gates below are still open.

Netlify runtime follow-up: the authenticated SP500 Hyperliquid/XYZ Footprint
rendered live classified rows after deploy `6aebb6d40697c605193652da`, and native
price-axis double-click reset without an alert dialog. One uncaught
`MutationObserver.observe` non-Node argument error was logged during reload at
2026-11-04T22:53:21.598Z. This exact error was subsequently reproduced in an empty,
script-free inline frame without application, Vela or Netlify code, while both
no-frame controls were clean. See `observer-isolation.md`; the inspection browser's
frame instrumentation is the supported explanation, not a reproduced app defect.
The exact injected call site and other-browser behavior are not established.

Footprint Auto/Manual aggregation now uses verified venue price precision across
all five instances and the independent visible aggregate. The extracted 16-pixel,
power-of-two Auto contract, Manual 1–64 ticks, legacy overrides and asynchronous
native frame updates have 22 regressions, 2,820 raw-source row comparisons and
frozen/native-live/reload/414-pixel evidence. See `footprint-grid-reference.md`.
Historical tick-rule changes, recorded browser Replay and populated multi-chart
acceptance remain open. Current full regression/build gate: 2,306 tests / 212 files.

Footprint diagonal follow-up: missing/hidden price rows no longer masquerade as
observed zero counterparts. The inspected reference comparator, ten regressions,
99,972 independent raw-source side-flag decisions, corrected 703-zone oracle and
native renderer case matrix are recorded in `footprint-diagonals.md`. This closes
the missing-counterpart calculation gap; full visual equivalence stays open.
Default-off highlights/recolor, independent outline and text colors, configurable
width and native percent ratio controls are now implemented with legacy migrations.
There are nine new regressions, 1,280 direct reference-helper geometry comparisons
and native simulated/live/reload/414-pixel evidence. See `footprint-highlight.md`.
Mode-specific histogram palettes are now independent across Bid/Ask, split Volume
and Delta, with per-instance/range persistence, old shared-color migration and a
first-edit binding guard. The reference mono ramp also remains active when side
gradients are off. Seven regressions, 348 actual reference-function color
comparisons and native simulated/live/reload/414-pixel evidence are recorded in
`footprint-palette.md`. Auto/manual text size, proportional fitting, compact row
formatting, side/Delta/scalar alignment and uniform per-instance font planning are
now implemented. Ten regressions, 69,120 direct reference text comparisons and
native simulated/live/reload/414-pixel evidence are in `footprint-text.md`.
Full control/default/background/theme auditing and whole-renderer acceptance stay
open. The Shift magnifier now uses measured neighboring-profile enlargement,
price/time rulers and a separately owned topmost canvas. Its 2,820 exact browser
pixel comparisons and native Shift/release/414px checks are documented in
`footprint-magnifier.md`; full reading-tool acceptance remains open. Current test
gate: 2,390 tests in 224 files, standalone TypeScript and production build passed.
Final-build Kraken recording/reload/Replay and corrected candle-export browser
acceptance are recorded in `kraken-recorded-replay.md`.
Unfinished-auction reference correction now excludes compact-zero dust, paints
High before Low and uses the one-pixel row gap/strict positive outline interior.
There are 1,944 exact classifier and 23,040 drawing-operation comparisons plus
an updated nine-mark/three-revisit retained Kraken oracle; details and remaining
gates are in `footprint-unfinished-auctions.md`. Netlify reports the team credit
limit has paused all projects and deploys on 2026-11-06, so this increment's new
production acceptance remains pending. The POC projection's one-loaded-candle
paint discrepancy is corrected, with 60 direct reference selections, 180 touch
checks and 34,560 exact drawing-operation comparisons. Native completed-prefix,
backward-seek and 414px evidence plus remaining fallback/packing/Replay gaps are
documented in `footprint-poc-reference.md`.
The complete stacked-zone branch now has 12,000 exact reference comparisons
covering raw/mean/filter preparation, run extraction, indexed first contact and
drawing. The stale native fixture was corrected to include observed outer
diagonal counterparts; renewed native prefix/mean/filter/414px evidence and the
current 703-zone/357-contact retained oracle supersede older counts/screenshots.
See `footprint-stacked-zones-reference.md`. No production stack formula change
was needed; full packing/cross-fade/multi-chart/capacity/recorded-Replay gates
remain open.
Cross-family Kraken recording/reload/Replay acceptance now uses 75 real public
BTC/USD observations. Empty/58/75/gap/backward prefixes, removal/restoration,
native Footprint/session totals and tape exports match independent decimal
checks; CVD is verified at displayed one-decimal precision, not exact raw native
precision. The candle CSV provider-label defect is corrected with scoped lineage
and provider routing. This is partial completed-candle local acceptance, not
intrabar/original-arrival, full history, capacity, populated multi-chart or
Netlify production proof. See `kraken-recorded-replay.md`.

| Family | Current implementation evidence | Remaining implementation / verification |
| --- | --- | --- |
| Footprint | Native Footprint and Visible Range Footprint study overlays preserving base candles, independent controls/lifecycle, per-bar projections and Left/Right aggregate alignment, scoped Data-window/inspection surfaces, twelve regressions and 1,770 retained-source row comparisons (see `footprint-overlays.md`); Native row context menu for Stat table / Average trade size / Visible range profile / Footprint Settings, actual-instance and range targeting, source/epoch/completed-Replay/settings fences, primary/secondary host lifecycle and native persistence, seven regressions (see `footprint-context-menu.md`); Independent right-pinned Visible range subsection with raw-tape aggregation, aggregate means/filters/VA/POC, zoom-independent lane, completed-Replay/membership/revision fences, coverage readout and strict backup fields; eleven regressions and 993 raw-row/3,972 aggregate display comparisons (see `visible-footprint.md`); Actual-instance row hover and Shift neighboring-row magnifier with 14px labels, original normalization, canonical gaps, filter/completed-Replay guards and scoped modifier cleanup, ten regressions and simulated real-renderer/Shift/414px evidence (see `footprint-reading-tools.md`); Independent per-instance side-value recoloring versus outline switches, legacy migration and strict disabled-instance backup persistence, seven regressions and four-combination simulated canvas evidence (see `footprint-imbalance-style.md`); Whole-band stacked imbalance projections until first later inclusive OHLC-band overlap, independent alpha fills and 2-40 adjacent rows, displayed-filter/mean flags, indexed contact lookup, repair/completed-Replay fences, inspection/CSV provenance, thirteen regressions, 1,130 retained-source zone comparisons and simulated/native/reload/414px evidence (see `footprint-stacked-zones.md`); `lib/orderflow/footprint.ts`, `footprintHistory.ts`, inspection/readout; six independent inclusive Total/Bid/Ask display bounds with zero-off, fixed blank slots, visible POC/VA/normalization/diagonals, unfiltered raw stats/projected references, raw/mean basis and captured visibility/filter provenance, sixteen regressions and 1,998 row/756 band/756 reference source comparisons (see `footprint-filters.md`); full per-instance Stat table with ten metric toggles, merged side percentages, observed-price Above/Below placement, size/colors/background and values-only lanes, strict underlying count coverage, twelve regressions including 1,024 toggle combinations and 840 three-venue metric comparisons (see `footprint-statistics.md`); per-instance 70% Value Area with canonical POC-outward expansion, upper-neighbor ties, raw/mean basis, independent lines/fill/width and indexed midpoint POC projections with repair/completed-Replay fences and frozen readout/CSV metadata, fifteen regressions and 560 VA/140 reference source comparisons (see `footprint-value-area.md`); up to five simultaneous independent instances with native add/remove tabs, Left/Right/Within packing, one-Within arbitration, shared tape and five bounded incremental grid caches, instance-selectable readout/CSV, strict layout/backup persistence, twelve regressions, 171 three-venue row comparisons and simulated/native/reload/414px evidence (see `footprint-instances.md`); all five display modes with fixed-column Ladder, left-origin Absolute Delta, volume Split/Mono and theme-aware gradient cells, stable stored IDs/legacy mono migration, native conditional controls and mode/split capture provenance, nine regressions, 732 three-venue geometry checks and simulated/native/reload/414px evidence (see `footprint-display-modes.md`); six independent cell-value choices and average trade-size geometry/POC/diagonals with explicit underlying counts, unavailable-count dashes, raw-label preservation and inspection/CSV provenance, nine regressions, 61-row three-venue oracle and native simulated/settings/reload/414px evidence (see `footprint-cell-values.md`); observed unfinished outer-row auctions with minimum per-side quantity, independent colors/width and indexed later-candle revisit rays on merged rows, history/Replay cache invalidation and readout, 11 regressions, independent raw-Kraken 17-mark/7-revisit oracle, simulated rendering and native settings/reload/414px checks (see `footprint-unfinished-auctions.md`) | Direct multi-instance geometry/default comparison and zoom fading, complete mode-specific colors/settings and exact label alignment, direct filter/VA/POC/stack projection comparison and missing-counterpart semantics, direct full-stat-table visual/zoom comparison, direct overlay equivalence and context controls; direct context-menu acceptance; direct magnifier/hover geometry and zoom comparison; direct unfinished-auction Vela comparison, full-capacity/multi-chart/browser Replay and exact zoom behavior |
| TPO | `tpoModel.ts`, `tpoRenderer.ts`; Day/Week/Month calendars, 4h blocks, 62-character alphabet, expanded real-time columns, native per-session Expand/Collapse and chained Merge/Unmerge with persisted scopes, independent 60-minute-default IB with legacy migration, poor extremes, single prints, observed open/close and midpoint markers, canonical POC/VA price tags outside the session left edge, structure-colored rounded backgrounds with contrast text, priority collision omission and parent-switch gating, candle-derived block hover, independent VA fill and canonical VA lines with their own color, configurable 1-5px POC and compact/extension widths (see `tpo-value-area-style.md`), shared Time Price Opportunity overlay with independent instances/readouts and extended references; ten Day trading-window choices, source-resolved Yahoo RTH/ETH and inherited source tape, independent explicit-session candle/calendar loads with separate browser/server alert dependencies and revealed Replay fences, compressed range/VA/POC rails, session-time Simple/Thermal/Spectrum/Ocean/Ember/Custom ramps with alpha and outside-VA opacity, classified row Volume/Trades count/Delta colors and block hover values with source-owned live/archive/Replay collection and truthful Time fallbacks, four delta themes/custom and independent 1000-Kraken-trade oracle (see `tpo-time-colors.md`, `tpo-metric-colors.md`), fixed UTC/overnight HHMM and saved alert-window controls; per-session Left/Right volume ladders with independent rows/width/POC/VA/labels and OHLCV-estimate provenance; 13 shared calendar regressions, independent 720-closed-Kraken-bar oracle and native settings/reload checks; 2,026 tests and build pass; see `session-periods.md`, `tpo-ib-minutes.md`, `tpo-split-time.md`, `tpo-session-operations.md`, `tpo-markers.md`, `tpo-hover.md` and `tpo-overlay.md`, `tpo-volume-ladder.md`, `tpo-trading-hours.md`, `tpo-independent-history.md` | non-Yahoo explicit-session history/calendars, independent-session axes/autoscale and after-hours observation cadence, retained Replay calendars, complete overlay equivalence and direct metric-theme/hover acceptance against Vela; direct Vela rendering/composite-formula equivalence, populated multi-chart, browser recorded Replay, touch and operation Undo/Redo checks |
| Volume Delta / CVD | `cvdModel.ts`, `averageDeltaPath.ts`, `cvdOutput.ts`; standalone signed columns, Total/Average, UTC day/week/month/all anchors, native candles/line/area; legacy Session/Collection controls retained; 14 new regressions, independent raw Binance/Kraken OHLCV checks, default/style/reload/live/414px browser checks; 1,809 tests and build pass | Direct Vela visual/source comparison, populated multi-chart and browser recorded Replay; complete historical coverage and native numeric formatting; Average constituent-print wicks inside aggregate messages remain unobserved |
| Profiles | Session, fixed, visible and rolling implementations; classified/candle source distinction; independent dashed developing POC/VA prefixes with current-grid rebin semantics, timeframe/worker invalidation, 636 raw-Kraken prefix oracle checks, 100k-execution model timing and simulated-prefix/native-settings/reload/414px evidence (see `session-profile-developing.md`); observed completed-session POC extension to first later inclusive candle contact, shared indexed touch lookup, repair/Replay fences and off-screen references (see `session-profile-poc-extension.md`); Session Day/Week/Month and ten Day trading-hour presets with source-scoped RTH/ETH/inherited calendars, named/overnight Custom UTC, captured worker calendars and stale-result fences, 24-row/30%-width defaults with legacy overrides, live/reload/414px checks (see `session-profile-trading-hours.md`); rolling 100/24/30/70 defaults, POC/VA, current-window readout, archive/completed Replay and six independent live Binance/Kraken comparisons; 1,864 tests and build pass | Direct developing-trace and untouched-POC comparison with Vela; direct Vela bins/VA/color/width/numeric-format comparison, full-capacity performance, multi-chart and browser Replay checks |
| Volume Tails | All four variants: visible, rolling, session and fixed two-click/draggable/open-end drawing; Session Tails shares ten Day trading windows, source-scoped RTH/ETH and chart-session inheritance, overnight Custom UTC and Week/Month exclusion, calendar-aware render invalidation retaining collected executions, twelve regressions, eleven raw-Kraken membership comparisons and native settings/reload/414px checks (see `session-tails-trading-hours.md`); threshold/resolution, supply/demand/equilibrium controls, mean/weighted lines, archive/Replay prefixes; 28 model/drawing regressions, three document-binding regressions and 18 retained public-capture comparisons; native placement/anchor/settings/Enter/reload/414px and desktop Undo/Redo persistence checks; 1,840 tests and build pass | Direct Vela visual/default/formula comparison, retained Replay calendars and classified equity-calendar acceptance, full-capacity performance, populated multi-chart/native z-order, complete touch drag and browser Replay verification |
| Trade Count | `tradeCount.ts`, `tradeCountIndicator.ts`; three native panes, UTC anchors, count-path candles/line/area, explicit provider counts, archive/Replay plumbing; 16 focused regressions, Binance/Kraken raw-stream oracle, actual panes/style/reload/mobile checks; saved real 75-record Kraken native 1m/5m Replay: 5 populated and 4 empty checkpoints independently verified, backward seek and archive remove/restore ([scope](trade-count-replay.md)) | Integer Data window/legend, axis/crosshair/value chips checked in native browser, including manual scale and own-scale merge ([format](trade-count-format.md)); direct Vela visual comparison, every layout/anchor, full history/cross-source parity; old count-less archives deliberately stay gaps |
| Bar Stats | `barStats.ts`, `barStatsIndicator.ts`, `barStatsRenderer.ts`; seven categorical rows, visible intensity, adaptive/exact values; 14 focused regressions, raw Binance/Kraken oracle, live/zoom/reload/414px settings checks; 1,791 tests and build pass | Populated multi-chart, browser recorded Replay and full-capacity rendering; direct Vela visual comparison; full source/history equivalence |
| Volume Bubbles | `volumeBubbles.ts`, `volumeBubblesIndicator.ts`, `volumeBubblesRenderer.ts`; 11 original plus 17 price-grid regressions; verified public Binance/Kraken ticks and Hyperliquid price-dependent precision, canonical Manual/Auto grid, explicit overrides and asynchronous lifecycle fences; independent fresh raw-source checks for 516 bubbles across three venues, actual native tick/source market-switch and reload/414px settings checks (see `bubble-price-grid.md`) | Direct Vela visual/default/formula comparison, historical tick-rule coverage, populated multi-chart/browser Replay and full-capacity performance checks |
| VWAP | VWAP Bands with five UTC anchors, eight price sources, stable weighted population moments, three independent standard-deviation/percentage pairs, fill/colors and explicit daily hiding; native source-input correction, stable Band 2/3 identities, 16 new regressions, 21,600 independent raw-Kraken prefix comparisons, Orderflow picker/settings/1D/reload/414px/Replay browser checks; interactive Anchored VWAP construction; see `vwap-bands.md` | Direct current Vela visual/default comparison across modes/themes, full-capacity performance and populated multi-chart acceptance; complete source/history coverage remains unproven |
| Order book panel | Sampled depth heatmap, filtered tape and local archives; panel-session Sold/Bought/Delta, optional Volume/5s Last, quote values and reset ([execution scope](dom-traded-volume.md)); bounded stable viewport with Auto/Fixed/Timed, wheel/keyboard/Center and context reset ([navigation scope](dom-navigation.md)); public venue grids with asynchronous source fences and observed fallback ([grid scope](dom-price-grid.md)); locked-default click trading with limit/stop classification, frozen review and ownership-time validation ([click scope](dom-click-orders.md)). Configurable visibility/reorder with pointer grips, conditional Orders and quote-unit row P&L ([columns scope](dom-columns.md)). Implemented DOM view preferences now survive reload/panel reopen and strict workspace backup, with per-market groups ([preferences scope](dom-preferences.md)). Large-order upper-median/fixed quote thresholds and tiers have 4,608 exact reference threshold comparisons, 373,462 tier checks and computed-style/reload evidence ([highlight scope](dom-large-orders.md)). Persisted DOM colors/zoom, source metrics/even viewport counts and three-row wheel stride have direct arithmetic and browser style/layout checks ([style scope](dom-style.md)). Model, public-raw and controlled actual-component browser evidence is scoped in those documents; Book separates asks and bids with per-level or cumulative depth, grouped inspection and four styles ([Book scope](book-view.md)). Latest full gate 2,451 tests/237 files, TypeScript and build passed | Persisted complete settings/grouping defaults, complete position/order annotations, shared Book/Trades styling, complete theme/raster behavior, combined venues, preset exits/kill-switch integration, dragging/context staging and full official controls; direct visual/grouping/formula equivalence and genuine live/hosted acceptance of new controls; original-arrival Replay and complete historical depth remain unproven |

Dedicated official references:

- https://docs.luxalgo.com/platform/charts/order-flow/footprint
- https://docs.luxalgo.com/platform/charts/order-flow/tpo
- https://docs.luxalgo.com/platform/charts/order-flow/volume-delta
- https://docs.luxalgo.com/platform/charts/order-flow/volume-profiles
- https://docs.luxalgo.com/platform/charts/order-flow/volume-tails
- https://docs.luxalgo.com/platform/charts/order-flow/trade-count
- https://docs.luxalgo.com/platform/charts/order-flow/bar-stats
- https://docs.luxalgo.com/platform/charts/order-flow/volume-bubbles
- https://docs.luxalgo.com/platform/charts/order-flow/vwap
- https://docs.luxalgo.com/platform/workspaces/order-book

Data acceptance: keep venue/source identities, classified aggressor volume,
partial-coverage notices and simulation boundaries. Candle-only feeds cannot
provide aggressor splits, true print counts or depth. A complete visual suite
does not prove equivalent market-data coverage. Never claim consolidated
Nasdaq/CME or complete historical executions from retained public observations.

Completion gate: each row needs reference-by-reference settings and interaction
checks, independent numeric oracles, live/reload/replay and responsive/multi-chart
evidence, appropriate automated regressions and a production build. Keep the
overall goal active while any row remains incomplete or unverified.
