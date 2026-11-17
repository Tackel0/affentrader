# Saved DOM view preferences

DOM column order/visibility, follow mode, Timed delay and execution-size units
now live in the workspace store. Grouping is remembered independently for each
fully qualified market. Returning to another chart/provider therefore does not
reuse its grouping. Default grouping entries are omitted; the map retains at
most 128 non-default markets and evicts older entries when full.

The existing debounced, window-scoped workspace persistence writes these fields
and flushes on page hide. Panel close/reopen and browser reload restore them.
The column controller and follow hook now consume the same stored preferences,
including changes restored through workspace import. Workspace export includes
`premium.state.domPreferences`; the strict importer validates it. Older exports
without the field remain accepted and hydrate defaults.

Validation requires an exact settings schema, ten unique known column IDs,
boolean visibility with Bid/Price/Ask enabled, one of the three follow modes,
5/10/30/60-second delays, base/quote units, and bounded known-symbol group values
from the current menu. Malformed local DOM data falls back to default DOM settings
while leaving other workspace fields intact. Invalid imported DOM data rejects
the import. Runtime/action fields are not accepted.

The unlock state, Ask-before toggle, pending order review, in-flight submission,
current navigation center/hover/timers, collected executions and venue request
state are deliberately absent from this view-settings schema. In particular,
reload still starts locked with Ask before placing on and a fresh collection.
No position, account, broker login or browser cookie is added to these settings.

Five regressions exercise strict validation, market separation and capacity,
real workspace-store/storage rehydration, damaged/old local state, and the real
workspace export/import path including rejection of injected `unlocked` fields.
Actual-component browser acceptance now uses the actual persisted workspace
store (market delivery/paper execution remain controlled fixtures). An immediate
reload restores reordered/hidden columns, Volume, Timed 30s, quote units and BTC
group 5 while restoring lock/Ask defaults. ETH initially uses group 1, can retain
10 independently, and returning to BTC restores 5. Panel reopen also retains view.
Its warning/error log is empty. This does not prove production cloud sync or
cross-tab concurrent editing, nor named-layout-template capture of panel options.

Evidence: `artifacts/dom-preferences-browser-checks.json`,
`dom-preferences-browser-errors.json`, `dom-preferences-browser.png` and
`dom-preferences-{targeted,tests,typecheck,build}.log`.
Full gate: 2,433 tests in 233 files, standalone TypeScript and production build
passed. All new files are included in the local upload ZIP.

Complete Order book/Vela parity remains open: other Book/Trades preferences and
controls, absolute grouping defaults/menu equivalence, large-order styles,
combined venues, complete paper-order workflow and direct live/hosted/reference
acceptance. Only the implemented DOM view fields above are persisted here.
