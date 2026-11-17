# Following completed TPO reference alerts

An alert condition can now follow the **latest fully covered completed TPO POC, VAH or VAL**. Choose **Completed TPO reference** in an Indicator/Combined/Watchlist rule, or open **Follow latest completed TPO…** from the live TPO Data window. The latter copies the current native chart's mathematical profile parameters and selected symbol/interval into a reviewable draft. It does not save an alert automatically and is unavailable from Replay or interrupted/stale chart history.

This complements [fixed reference snapshots](tpo-alert-snapshots.md). A following rule adopts subsequent completed reference sessions. It uses the parameters saved in the rule, so later chart-style changes and switching charts do not alter its definition. Session zone, start, length, weekdays, block length, row size/automatic row target and value-area percentage are editable in the rule.

## Observation contract

- Crossing, Crossing Up and Crossing Down compare successive observed prices with the exact canonical completed-profile level. POC is the row center; VAH/VAL are the value-area boundaries.
- Forming and future OHLC cannot contribute to the reference. The evaluator filters to candles closed by the observation clock. A fully covered final source candle proves completion at its confirmed close, even before a subsequent forming candle exists.
- The latest **fully covered** completed profile is selected. An incomplete newer session cannot manufacture a new reference. If no qualifying session is loaded, the condition is unavailable.
- Creation, resume, a new reference session, a source/generation change, recovery after unavailability and repairs that change the reference price establish a fresh baseline. A price jump across a changed reference does not become a historical crossing. Subsequent observed crossings can fire normally.
- The observation stores reference identity, observed price and time. Browser and server share this evaluation/runtime contract; the server persists observations with its alert state. Tick and confirmed-close scheduling, one-shot/cooldown/rate limits, notifications and event journaling use the existing rule infrastructure.
- Multiple conditions, market contexts and watchlist members keep independent observations. TPO conditions require candle subscriptions rather than quote-only routing. Histories are planned deeply enough for several daily session windows, within the existing 20,000-bar ceiling; incompatible block/interval combinations and sessions exceeding the history limit are rejected. Provider gaps/retention can still leave a rule unavailable.

This is OHLC-derived TPO, not historical execution volume. Server conditions observe the runner's polling cadence; they cannot establish every intervening trade crossing. Browser conditions run while their owning tab is open. An already-created following rule uses the live service, not the chart's historical Replay prefix. Snapshot alerts and touch-limited visual extensions retain their separate semantics.

## Implementation

`types/tpoAlerts.ts` defines the saved mathematical parameters and per-condition observation. `lib/alerts/tpo.ts` provides strict validation, bounded reusable profile caching, reference selection and crossing evaluation. `rules.ts`, `runtime.ts` and `browserEngine.ts` connect the condition to shared history planning, context/source fencing, state persistence and scheduling. The browser supplies source generation/recovery information from the actual market store. `TpoAlertConditionEditor.tsx` and the existing RuleForm provide complete input controls; Data-window creation revalidates the current native chart before copying its settings.

Long rule dialogs also now keep their tab bar and action footer visible while scrolling only the rule content. This fixes clipped Cancel/Create controls exposed during the native browser verification.

## Verification

- **1,534 tests across 135 files passed.** Eleven new condition/runtime tests cover canonical levels/directions, saved observations, profile handover, source/recovery/repair baselines, missing and future/forming candles, close scheduling, browser routing/history planning, multiple market contexts, malformed settings and workspace round trips.
- An additional real server-service test writes an isolated temporary store, establishes a TPO observation, resets the service modules, then verifies a persisted crossing event. It verifies a new reference's adoption without firing from threshold motion and a later crossing against the new POC. It does not modify the user's server database or send external notifications.
- After the final malformed interval-type guard, the affected TPO/server tests passed again: **48 tests across two files**. Final production build including TypeScript passed. Logs: `artifacts/tpo-following-{tests,final-focused,build}.txt`.
- Actual production browser: Hyperliquid BTC/5m with native TPO settings **96 auto rows / 68% VA** opened the new dialog with those exact values, UTC, daily session, 30-minute blocks and BTC scope. VAH and Crossing Up selections updated successfully. This copy persisted across a chart reload. Replay removed the direct creation button, and leaving Replay restored it.
- Final desktop layout measured the dialog at y=36–684; both Cancel/Create buttons were fully inside it at y=634–668. Screenshots: `artifacts/tpo-following-dialog.jpg`, `tpo-following-settings.jpg`. Dialog text: `tpo-following-dialog.txt`.
- Browser drafts were cancelled; no live browser alert was created or triggered in this verification. Production crossings/server persistence were verified with controlled candles in automated tests. Browser console errors were empty (`tpo-following-browser-errors.json`).
- Workspace restored to BTC/5m Candles, EMA/Volume, Watchlists, UTC, Replay off, 80 auto rows / 70% VA, with reference/touch switches off. Server remains available on port 3000. Screenshot: `tpo-following-restored.jpg`.

## Remaining scope

This closes the previously identified missing following-TPO price-reference condition. It does not establish complete TradingView/Vela feature parity, full execution archives, exchange entitlements or tick-exact historical alert reconstruction. The [corrected presentation evidence](tpo-presented-evidence.md) remains the current account of the unconfirmed TPO raster concern. Independent per-rule availability reporting and every mobile/provider combination are not established by this checkpoint.
