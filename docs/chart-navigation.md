# Workspace chrome and date navigation

Follow-up: [Replay dates in the selected chart zone](replay-timezones.md) adds second precision, explicit repeated-hour occurrences, absolute loaded bounds, pause-on-edit and retained native historical pages. The 1,093-test continuation includes actual fold/gap and 375px Replay checks. The original navigation checkpoint below remains separate evidence.

This checkpoint compares the public TradingView chart on 2026-10-26 with the local workspace. It improves measured chrome and date navigation; it does not prove pixel-exact or complete Premium parity.

## Observed layout and appearance

The public desktop chart placed symbol comparison before the interval. It used a compact symbol field, a 52-pixel drawing gutter, 38-pixel top chrome and a calendar action after the bottom range presets. Its dark header background measured RGB 0/0/0; button text was RGB 184/184/184 and the symbol field RGB 43/43/43. The observed font stack was `-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif`.

The local header, theme tokens and native chart theme now follow these measurements. Comparison is a compact plus action before the interval. Pattern analysis remains accessible through its labeled icon and original menu; no detector was removed. The drawing gutter is 52 pixels, with larger desktop tool targets and compact mobile targets. Light styling uses neutral grays over white. The old bottom Auto button opened settings instead of toggling autoscale; it was removed from that row. Vela's actual price-axis controls remain available.

At narrow widths the interval remains legible and additional actions move into **More chart controls**. This contains the existing template/pattern/layout/save menus, drawing undo/redo, sidebar toggle, settings, search, screenshot and full screen. The actual mobile layout menu was opened without changing the user's layout. Range presets scroll within their row. A 375-pixel document had no horizontal page overflow; all visible header buttons ended within the 375-pixel width. The initial viewport override only took effect after a different navigation; a temporary local frame check was removed after direct 375-pixel verification. The override was reset and only the original two workspace tabs were retained.

The local brand, available data and feature set remain distinct. The public reference required no account for these observations; a later signup prompt was not bypassed. The temporary reference tab was closed. Reference screenshot: `artifacts/tradingview-dark-reference-2026-10-26.png`.

## Preset ranges

| Preset | Standard interval |
| --- | --- |
| 1D | 1 minute |
| 5D | 5 minutes |
| 1M | 30 minutes |
| 3M | 1 hour |
| 6M | 2 hours |
| YTD | 1 day |
| 1Y | 1 day |
| 5Y | 1 week |
| All | 1 month |

These interval choices were read from the public reference's accessible controls. `lib/chart/ranges.ts` plans UTC calendar windows: calendar months/years clamp to month-end, and YTD starts January 1. History requests include warm-up depth and stay bounded by 20,000 bars and the provider's own smaller limits. They are elapsed UTC windows, not a reconstruction of each exchange's trading-day/session calendar.

A range waits for Vela's full requested history, then frames the available interval. Earlier range commands cannot commit after a newer selection or a market/feed change. A committed interval is not reloaded as a 600-bar default immediately afterward. The footprint's initial readability zoom does not override an explicit range. TPO retains intraday brackets (at most 15-minute input) with the same bar cap, so long TPO windows can be partial. Available-history limits are reported rather than filled with invented market bars. All means all history served within these bounds, not a licensed unlimited archive.

## Native dense viewport adapter

The first 3M browser check found a separate Vela 0.9 constraint: native `setVisibleRange` clamped spacing to 0.5 pixel per bar. A narrow chart could therefore have the requested history loaded while displaying only its later part. `scripts/patch-vela-viewport.mjs` lowers that floor to 0.001 for the pinned 0.9.0 bundles consumed by the app, retaining the original data-dependent zoom/pan clamps. This permits the bounded 20,000-bar window in small chart cells.

The adapter runs before dev/build/test/typecheck, validates the package version and exactly five unique anchors, and is idempotent. Unexpected package versions/shapes fail visibly for review. Replacing a temporary file avoids modifying a potentially shared package hardlink in place. Upstream package notices remain intact. The separately minified UMD file is not used by this Next.js application and is not modified.

Tests exercise actual installed `NativeRenderer.setVisibleRange` and its viewport clamp at widths from 80 to 1,300 pixels, using deterministic coordinate hosts. They verify dense framing and retained bounds, not an entire GPU/DOM session. The production screenshot separately verifies the rendered full three-month view.

## Go to date and custom ranges

The calendar action and Alt+G open Date / Custom range tabs in the selected chart time zone, including local and exchange-zone choices. Daily/weekly/monthly inputs use local midnight. The dialog captures the symbol, interval and resolved zone when opened; a changed context requires reopening before submission. Calendar input and change events both synchronize the submitted values. Inputs reject invalid, reversed or future ranges. The navigation first uses already loaded history, then requests deeper history only if needed and allowed by the 20,000-bar bound at the current interval. A provider that cannot serve the date yields a visible error; an out-of-window date asks for a larger interval.

Runtime IANA rules resolve each local minute to UTC. Skipped clock times are rejected. Repeated times show separate first/second occurrence controls with their UTC offsets and UTC times for each endpoint. Thus Berlin 2026-10-25 02:30 at UTC+2 to 02:30 at UTC+1 selects a real one-hour interval; reversing the occurrences is rejected. Editing a field clears a stale validation message. Tests cover Berlin, New York, Lord Howe's half-hour transition, Samoa's skipped day, fractional offsets and pre-1970 dates. Allowing an older date in the planner does not establish that a provider can serve it. The production browser verifies the Berlin gap, reversed fold and rendered one-hour range; this checkpoint does not add a separate mobile check.

Replay navigation cannot reveal dates after its cursor or before its revealed bounds. Tick-bar axes have synthetic timestamps, so date navigation asks for a time-based interval. Point navigation retains nearby context; custom navigation uses its exact requested endpoints over available bars. Local midnight conversion does not reconstruct exchange sessions or guarantee identical daily-bar alignment across venues. Exact TradingView ambiguous-time dialog behavior has not been established.

**Reset to recent candles** is a separate `recent` command. It retains the symbol, interval and Replay cursor instead of invoking the 1D preset. Footprints select a readable recent bar count; other styles use up to 150 bars. A pending range operation cannot override a newer recent-view reset. In Replay, both recent-view helpers exclude unrevealed dates. Fit still frames the already loaded native series without fetching another range.

Replay start/seek waits for native history completion and validates the chart/market/feed identity before proceeding. New replay commands and chart destruction revoke older queued starts. This avoids the observed empty-series start when Replay is pressed during a recent-view reload. The final browser test started Replay immediately after range/reset actions and retained its historical cursor through another recent-view reset.

Verification results and restored user state are recorded in `artifacts/verification.md`. Full layout fidelity, exchange calendars, provider archive depth, historical order-flow completeness and all non-time chart navigation semantics remain separate parity work.
