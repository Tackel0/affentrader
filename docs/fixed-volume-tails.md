# Fixed Range Volume Tails

Fixed Range Volume Tails now starts an interactive native drawing from Indicators
→ Order flow. Two clicks define an inclusive candle range. Enter after the first
click commits an open range; the Open end setting also makes a saved two-anchor
range follow the newest bar. Both vertical anchor lines are draggable along time,
including away from their center handles. The filled zones can select the drawing.
Native drawing settings, serialization, groups, visibility and locking are reused.

The model uses the same classified bins and tail arithmetic as the other three
variants. It never estimates aggressor volume from candle direction. No archive
means only observed trades; an archive can supply an explicitly selected historical
range. The last selected candle is included and its exact exclusive ending is
respected. An open end in Replay follows only completed revealed candles. Source
loss or backward seeks clear future/stale tails instead of retaining a former
result. The open-end range's data extent is not culled at its original last anchor.

Drawing-owned execution collections survive native rehydration when anchors or
settings change. Source/archive/Replay changes create a fresh collection. Current
live executions are observed before the range's throttled repaint, retaining
contributions beyond the service's short display tape. Retention is bounded at
100,000 per collection and a shared 250,000 / 64-drawing LRU across retained
collections; shared-cache eviction restarts with currently available observations.
No cache or live observation establishes complete exchange history. Capacity
failures and insufficient side volume are explicit.

The SDK registry accepts custom drawing factories, but the pinned renderer dispatches
only built-in classes. `scripts/patch-vela-drawing-paint.mjs` supplies a generic
`afPaint` hook before that dispatch, with a Vela 0.9.0 version gate and exactly five
validated bundle anchors. It is idempotent, replaces package directory entries to
avoid mutating shared hardlinks and runs through the existing dev/build/test patch
entry point. Ordinary drawings retain their existing painter path. No credentials
or provider behavior are patched.

Twelve focused regressions cover inclusive/reversed/open endpoints, exact range
ends, completed Replay cutoffs, cache/source changes, native round trips and
settings, axis-only handles, retained live quantities through rehydration, stale
watch callbacks, missing Replay, backward seeks, market isolation and execution
of the extension hook in all five actual pinned painters.
Three document-binding regressions additionally cover the SDK's undo/redo selection
events, no-op selections, duplicate mutation notifications and restore-time fencing.
The full suite passes **1,840 tests across 168 files**, production build and TypeScript. Artifacts use
`artifacts/fixed-tails-{tests,build}.log`.

Undo/redo originally repainted the native chart without updating the saved document
or React object tree. `bindDrawingDocuments` now also compares documents on
`drawing:selected`, the event emitted by the pinned SDK's snapshot restoration.
Ordinary selection changes do not rewrite storage or advance document versions.

The isolated production browser exercised two-click placement on actual Binance
data, shortened the right anchor while the left remained fixed, enabled an open
end and weighted supply line, committed a second one-anchor drawing with Enter,
and restored drawings/options after reload. Native controls also open at 414px.
The coverage badge is hidden while native drawing chrome is active; the React
heading and Fit controls are hidden while the full drawing dialog is open, avoiding
observed mobile overlays across the editor's controls. Screenshots use the
`artifacts/fixed-tails-` prefix. Desktop Undo reduced six drawings to five, Redo
restored six, and a subsequent Undo followed by reload restored five. All native
object-tree counts matched; captured browser warnings/errors were empty.

Remaining evidence: exact Vela visual/default/formula comparison, original-arrival
data completeness, real-provider outage restoration of execution archives, populated
multi-chart/native z-order behavior, full-capacity performance, browser recorded
Replay and complete touch dragging. Undo-history continuity across a chart renderer
reinitialization is not established; the saved document state survives reload.
The existing 18 independent retained
Binance/Kraken capture comparisons establish shared bin/mean arithmetic, not direct
Vela equivalence or every fixed-range interaction.
