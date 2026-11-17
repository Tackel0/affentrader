# Per-study legend values and settings tabs — 2026-10-27

Follow-up: [per-study price-axis values](study-axis-labels.md) adds native/Pine numeric scale chips and an independent persisted checkbox. The price-axis gap noted in this historical checkpoint is now addressed for eligible numeric plots; complete per-plot settings equivalence remains open.

Indicator settings now separates **Inputs** and **Style** into keyboard-accessible tabs. Inputs retains native/Pine parameter schemas and the native price source. Style retains color/width, visibility and Pine style guidance, and adds **Values in the status line** for that individual study. Omitted legacy flags mean enabled. Global chart status-line visibility takes precedence; the dialog explains that override when it is disabled.

This preference filters only the host legend. Native plots, native legend/data-window display masks and Data window values remain intact. It is excluded from the signature used by the actual chart synchronization loop, so applying only this display flag does not call `setInputs` or restart native/Pine calculations. Execution-relevant inputs/source/style/visibility still invalidate that signature.

The flag travels with the indicator instance through chart persistence, independent cells, named layouts, indicator templates and backups. Validation rejects non-boolean flags recursively in chart, cell and template studies. Existing backups without this optional property remain accepted.

Reference behavior: TradingView documents [individual status-line values and global precedence](https://www.tradingview.com/support/solutions/43000659666-i-want-to-hide-the-values-of-individual-indicators/). Per-study price-scale labels and complete per-plot styles remain separate work; this checkpoint does not claim those controls.

## Verification

- **94 files / 1,145 tests passed**; final production build and standalone TypeScript passed. Logs: `artifacts/study-display-tests.log`, `study-display-build.log`, `study-display-typecheck.log`.
- Five new tests cover global/local/error/visibility combinations, execution signatures, duplicate-instance/readout isolation, persistence/cell/layout/template export, and malformed/legacy imports at all three study locations.
- Actual production browser: End selects/focuses Style from Inputs. Applying an unchecked value flag hides only EMA20 values while Volume remains. Reload retains it, and the native Data window continues to expose EMA20. A temporary EMA50 instance retains its own displayed values; it was removed afterward.
- Applying Length0 while Style is selected returns to Inputs, shows the native validation error and focuses Length. Line width7 remains on Style, shows its maximum6 error and focuses that field. Both invalid drafts were canceled; original Length20/width2 remain.
- With global values disabled, the individual enabled checkbox remains checked, all host value groups stay absent, and the explanatory message appears. At375px, tabs/style controls fit and document scrollWidth375. Global display was then restored.
- Actual bundled PineTS Ichimoku produced four values before its override. After disabling its host values, the title/plots remain and Data window still exposes Conversion/Base/SpanA/SpanB. The temporary study was removed.
- Original BTC/5m/Candles/UTC single chart, EMA20/Volume with numeric values, original watchlist and collapsed bottom panel restored. No alert/order commands created. Captured warning/error logs empty. Desktop scrollWidth1280 equals viewport1280; viewport override reset and checked production preview retained.

Evidence: `artifacts/study-display-browser.json`, `study-display-{data-window,duplicate,mobile,pine,production}.png`.

This verifies the tested native/Pine host-display flows and existing execution-signature boundary. Every script, derived-study dialog, input schema, scale label, plot style, device and exact TradingView behavior remains unproven. The broader chart/layout goal remains active.
