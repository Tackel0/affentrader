# Shared chart data-coverage notices — 2026-11-02

Orderflow source and calculation messages now share one accessible **Data coverage** control per chart. Footprint, Session Volume Profile, VRVP, CVD, the Liquidity Heatmap and native Fixed Range profiles no longer paint several long captions on top of one another in the app. A short canvas line identifies partial/estimated data or gaps/waiting. The control's count is the number of current study/drawing notices, not the number of distinct exchange connections.

The dialog shows the owning symbol, interval and Replay state, followed by each contribution's full message. It preserves observed versus estimated quantities, partial histories, unknown gaps, missing archives and unavailable depth. The dialog updates with current data; it is not a frozen historical report. Its stable record identities preserve section order through live counter changes. Existing per-study numeric Data-window values remain separate.

## Layout and native integration

- `ChartCoverage` mounts on primary and satellite chart hosts. Its modal is portaled to the document body, so a short chart, pane overflow or CSS containment cannot clip the detail list. The body scrolls, text wraps, and the existing dialog focus/Escape behavior remains available.
- Container queries reduce the primary legend's scrollable list to two rows in short charts and one row below 240px height. They do not remove studies or their settings/actions. The small-height rule takes precedence over the ordinary legend's later CSS rule. The narrow canvas summary is deliberately shorter than the desktop wording.
- Existing native/custom painters route their actual message into the shared registry only while an accessible host is attached. Standalone consumers retain the previous canvas-caption fallback. The pinned Vela 0.9.0 Fixed Range foreground painter has an idempotent, version-guarded host callback bridge; the original `frvpNotice`, native geometry and drawing persistence remain intact.
- The shared canvas summary remains in native chart PNGs. The HTML detail dialog is not embedded into a chart image; the exported image still contains its normal source/market/interval/UTC header, Vela attribution and the short coverage line.

## Ownership and lifecycle

Records are scoped to the actual native chart context plus market generation, feed/candle source and selected execution-archive revision. Market, interval, live/Replay state and completed Replay cutoff must still match when the host reads them. Changing context hides older messages until the relevant paint publishes a current record.

Each native layer clears its record on stop/null payload/destroy. Footprint clears when changing chart style. Fixed Range records use stable cell/market/drawing identities across native rehydration, and require a connected, visible drawing still present in the saved native document. Removing or hiding a drawing cannot leave a visible orphan notice. Host reference counts and owner-safe cleanup protect another mounted chart. The registry and drawing-owner cache each have a separate 256-entry guard.

Unchanged paints keep the same external-store snapshot; changed publications coalesce subscriber notifications. Canvas invalidation repaints host layers without reopening native settings or rebuilding the scene. Visibility-predicate replacement also invalidates when it changes the record's availability, including paused Replay without incoming ticks.

The Session Volume Profile adapter additionally rejects mismatched market/timeframe/generation payloads before painting. A missing Replay archive/cutoff produces a waiting notice rather than a stale profile. The Depth Heatmap channel now carries a market/timeframe/live/source identity checked by its renderer adapter before drawing or reporting.

## Verification

**1,657 tests across 145 files pass**, and the final production build includes successful TypeScript validation. Seven new registry tests cover standalone fallback, stable snapshots/identities/order, notification batching, context/source/Replay fences, multiple studies/cells, cleanup/reference counting, drawing visibility/replacement and the owner bound. Existing native/painter/profile/Replay tests continue to pass. The pinned caption script updated all five installed native variants and remained idempotent on subsequent pipeline runs.

Actual production-browser checks:

- All six contributions reported their full messages in the dialog, including native Fixed Range and collected live Hyperliquid depth/trades. Hiding VRVP removed only its notice; showing it restored it.
- At **414 × 720**, with the DOM panel open, the legend measured **24px** high while retaining its 156px scrollable content. The canvas used one short coverage line instead of overlapping source paragraphs. The document width remained 414px. The dialog displayed above the whole workspace; scrolling reached VRVP and the Fixed Range missing-history explanation without clipping.
- Replay with no selected archive showed current archive/clock explanations for all six contributions, including the unavailable depth message. In paused Replay, hiding the Fixed Range drawing changed the count **6 → 5**; restoring it changed **5 → 6**, without requiring a live trade. The drawing was restored and Replay exited afterward.
- A two-column layout mounted and returned to one chart without duplicate primary records. The unrelated secondary ETH chart had no orderflow study notices; this is not a test of two fully populated orderflow charts or all eight contexts.
- The final app-generated PNG was saved and visually inspected: the header, attribution, geometry and short **Data gaps / waiting** coverage line remained in the raster. The complete dialog stays an interactive app view.
- Browser warning/error inspection was empty. Temporary viewport overrides were reset, the one-chart live 5m Footprint restored, and the DOM panel closed after the compact-height check. No orders, alert transmissions or recording changes were made.

Artifacts: `artifacts/study-coverage-tests.log`, `study-coverage-build.log`, `study-coverage-patch.log`, `study-coverage-details.txt`, `study-coverage-replay.txt`, `study-coverage-mobile.jpg`, `study-coverage-mobile-dialog.jpg`, `study-coverage-desktop.jpg`, `study-coverage-desktop-dialog.jpg`, `study-coverage-snapshot.png`, `study-coverage-browser-errors.json`.

This resolves the overlapping source-notice path, not every possible price-label/legend collision. Native POC/VA labels, dense drawings, every screen size and populated eight-chart combinations need further visual validation. TPO's specialized session labels are unchanged. Complete data history, recorded depth, all-source coverage and overall TradingView/Vela parity remain open.
