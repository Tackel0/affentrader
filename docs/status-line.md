# Chart status line — 2026-10-27

Chart settings now contains a native Vela **Status line** tab alongside Symbol, Trading, Scales and lines, and Canvas. Five independent preferences control OHLC, header volume, indicator titles, indicator arguments and indicator values. Hiding titles folds the study rows, retaining a counted arrow that restores them. Hiding values does not remove studies, stop calculations or remove their native Data window values.

Arguments display the stored scalar inputs in their stored order, preserving zero/false and omitting renderer color/line-width fields. This extends the prior length-only heading to studies such as MACD12/26/9 and Pine input names that do not use `length`. It is not a reconstruction of every TradingView script's preferred title/parameter formatting.

Preferences persist independently in chart storage, each workspace cell, saved layouts and validated backups. Legacy backups/cells without this optional field receive the visible defaults. Invalid or extra imported fields are rejected. The settings binding resolves its owner at action time: an inactive cell can be edited without changing the active chart, missing owners and intermediate cell application reject writes, and existing Trading controls remain in the same native dialog.

Reference: TradingView documents [global status-line visibility and individual indicator overrides](https://www.tradingview.com/support/solutions/43000659666-i-want-to-hide-the-values-of-individual-indicators/). This checkpoint implements the host-wide display preferences per cell; individual plot overrides, all status-line segments and complete native settings/reset equivalence remain separate work.

## Evidence

- **93 files / 1,140 tests passed**, production build and standalone TypeScript passed. Logs: `artifacts/status-line-tests.log`, `status-line-build.log`, `status-line-typecheck.log`.
- Six additional contracts exercise schema rejection/legacy defaults, multi-input scalar arguments, actual settings contribution callbacks, stale-dialog cell ownership, writes during application/removal, and saved-layout/validated-backup round trips. Existing native readout and recovery cases remain in the full suite.
- Actual production browser: disabling OHLC leaves volume; disabling arguments changes EMA20 to EMA; disabling values removes both value groups. Disabling volume too removes the strip completely. Hiding titles retains the counted restore arrow. Reload keeps the hidden state.
- Data window still exposes actual native OHLC/EMA/Volume while these header values are hidden. Cell2 after loading has O/H/L/C/Vol and its Volume values; returning cell1 retains the hidden strip, bare titles and no value groups.
- At375px, all five controls are reachable in the real native dialog, changing values works, and document scrollWidth375. Temporary native MACD shows `MACD 12 26 9`; it was removed through the real mobile actions flow. No alert/order commands created; captured warning/error logs empty.
- Restored BTC/5m/Candles/UTC, single chart, EMA20/Volume, all five preferences enabled, original watchlist and collapsed bottom panel. Desktop scrollWidth1280 equals viewport1280. Temporary viewport override reset and preview retained; production server runs the checked build.

Artifacts: `artifacts/status-line-browser.json`, `status-line-settings.png`, `status-line-mobile.png`, `status-line-macd-mobile.png`, `status-line-production.png`.

The compact inactive-cell heading retains its existing display policy; these checks prove persistence and behavior when that cell is activated, not equivalent full readouts in every inactive pane. Full TradingView layout, every script/input/style/device and native settings behavior remain unproven; the broader goal stays active.
