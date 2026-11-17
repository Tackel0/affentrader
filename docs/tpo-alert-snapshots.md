# Completed TPO reference snapshot alerts

**Evidence correction:** prior histogram-disappearance claims in this checkpoint are superseded by the [presented screenshot re-audit](tpo-presented-evidence.md). The cited captures do not prove that failure. This does not affect the independently verified mathematical features.

The Data window can open a price-alert draft from the latest fully covered completed TPO POC, VAH or VAL reference. Each button is available only while its corresponding completed-profile extension is enabled. Developing and incomplete profiles do not supply candidates. Replay exposes historical reference values without offering live-alert creation.

These are fixed price snapshots. The stored threshold never moves with later sessions, profile settings or repaired history. They use the existing browser price-alert evaluator, notification flow, ownership transaction, lifecycle and alert-line display. They are not automatically refreshed TPO rules and are not historical TPO signals.

## Selection and saved origin

The click handler rechecks the primary native chart, actual revealed series range, source generation, symbol, interval, profile settings, recovery/error state and both Replay states. A stale selection cannot silently become another profile's threshold. POC uses the canonical row center; VAH and VAL use the canonical value-area boundaries, without display-price rounding.

The alert stores source symbol, source interval, completed session start/end, level, exact price and market/simulation origin. The dialog and saved card identify this fixed origin. Its evaluation interval can be changed independently. Changing the threshold, symbol, simulation origin or condition to a band removes the exact-level provenance. This is enforced in both the form and the store's add/edit/update paths. Workspace imports reject malformed, unknown or inconsistent provenance while preserving old price alerts without it.

Saved snapshots begin observing subsequent prices. They use the existing source-transition rebaseline, direction, tick/close, expiration and one-shot rules. Profile reconstruction and history repair do not synthesize trigger events. Browser alerts run while the tab remains open.

## Verification

- Full suite: **1,514 tests across 133 files passed**. The new 11-test integration file covers complete/incomplete/developing profiles, independent visibility, source/history/settings fences, immutable draft values, imported origin validation, actual Zustand persistence/rehydration and actual evaluator tick/close behavior.
- After the final strict level-type validation change, the affected snapshot/workspace tests passed again: **21 tests across two files**. Final production build, including TypeScript, passed.
- Production browser, Hyperliquid BTC 5m: the completed 2026-10-29 UTC profile supplied POC **80113.74**, VAH **81522.84** and VAL **79524.48**. All three dialogs received those exact values. The POC dialog displayed its session, source interval and fixed-price semantics.
- Manual price editing and switching VAH to an entering-band condition displayed the regular-price-alert notice. Turning POC extension off removed only its button; after reload and reopening the Data window, VAH/VAL remained available and POC remained absent. Replay offered zero snapshot buttons despite retaining historical reference values. Disabling all extensions also removed all buttons.
- All browser drafts were cancelled. No live browser alert was saved or triggered during this check; persistence and actual crossings were verified in isolated automated tests. No browser console errors were recorded.
- Workspace restored to BTC 5m Candles, EMA/Volume, Watchlists, UTC, Replay off and all completed-profile extension toggles off. Production server remains available on port 3000.

Evidence: `artifacts/tpo-alert-poc.jpg`, `tpo-alert-values.txt`, `tpo-alert-edited.txt`, `tpo-alert-replay.txt`, `tpo-alert-restored.jpg`, `tpo-alert-tests.txt`, `tpo-alert-final-focused.txt` and `tpo-alert-build.txt`.

## Remaining scope

[Following completed-profile rules](tpo-following-alerts.md) are now available as a separate condition; these snapshot alerts remain fixed prices. This checkpoint does not establish the separate native candle rendering concern, full historical order-flow archives, exchange licensing or complete TradingView/Vela parity. See [TPO reference extensions](tpo-reference-levels.md), [corrected raster evidence](tpo-presented-evidence.md) and the main parity tracker.
