# Integer count readouts

Vela 0.9.0 formats native generic-series readouts using the price pane precision.
That made execution counts display a decimal suffix depending on zoom, price
tick and pane size. The public native descriptor has no value-format option.

`scripts/patch-vela-count-readout.mjs` adapts the five pinned renderer bundles,
with version, anchor-count and idempotency checks. It uses the configured Vela
price formatter with zero decimals for safe integer values belonging to exactly
`af-trade-count`, `af-trade-count-delta` and `af-ctcd`. Recognition is per model,
not per pane, so another study sharing the pane retains its own formatting.
Legend and Data window use the same integer policy. Missing/non-finite values
remain absent; unexpected fractional/unsafe values retain the old formatter.
No numerical series data, colors, Replay boundary or alert path is changed.

Two renderer-level regressions exercise the actual shipped `NativeRenderer`
method, including all three types, both value surfaces, line/candle series,
offsets, zero/negative/maximum safe integer, locale formatter, hidden plots,
missing values and unrelated studies.

`scripts/verify-trade-count-format-browser.mjs` serves a separate native chart
using the existing 75-record public Kraken archive. Actual browser legend and
Data window values for the latest 1m candle are total `17`, delta `-1`, CTCD
`8 / 11 / 5 / 7`, even with symbol price tick 0.1. Evidence:
`artifacts/count-format-native-readout.json`, `count-format-browser.png` and
`count-format-browser-errors.json` (empty warning/error list).
The fixture uses real recorded executions, with no claim of complete history or
production-account acceptance. It requires the local capture artifact, excluded
from the upload ZIP.

Full gate: 2,399 tests in 226 files, standalone TypeScript and production build
pass (`artifacts/count-format-{tests,typecheck,build}.log`).
## Native count axes

The subsequent axis increment adds `scripts/patch-vela-count-axis.mjs` to the
same pinned build chain. A study master axis uses count units only when every
visible master model is one of the three count families. Price panes and mixed
master units retain their original formatter. The policy is refreshed before
the manual-scale early return, and stale count mode is cleared after membership
changes. Merged count models use integer labels on their own scale column.

Tick positions are unique in-range safe integers, including narrow, negative
and logarithmic scales. A range containing no integer gets no invented integer
tick. Count crosshair labels round to the nearest integer using the configured
formatter, without negative zero. Explicit percent/index modes retain the SDK's
transformation. Last-value chips receive model identity through the native
snapshot/axis-label seam, so count chips remain integer even in an own-scale
column while unrelated price/volume chips retain their formatting.

Three additional tests execute the actual private SDK tick/format functions
from the shipped bundle. Existing axis-label tests now verify that the formatter
receives the model identity as well as the pane/scale arguments. The normal
build chain has been rerun repeatedly without duplicate patches.

Actual native-browser acceptance with the same recorded sample shows integer
ticks and value chips for all three studies, a CTCD crosshair label `5`, manual
axis dragging, and CTCD merged into the price pane with a separate integer
column beside unchanged one-decimal price labels. Screenshots:
`artifacts/count-axis-{crosshair,manual,merged}.png`. The merged Data window is
saved as `count-axis-native-readout.json`; `count-axis-browser-errors.json` is
empty. This remains an isolated fixture, not authenticated hosted acceptance.

Latest gate superseding the readout-only count above: 2,402 tests in 227 files,
standalone TypeScript and production build pass
(`artifacts/count-axis-{tests,typecheck,build}.log`). Direct Vela pixel comparison,
every layout/anchor and complete market-history parity remain open.
