# Replay dates, chart time zones and historical pages

Core-function checkpoint, 2026-10-27. Broker/social features remain deferred and complete 1:1 parity remains unproven.

## Corrected behavior

The Replay toolbar previously formatted and parsed its datetime-local field in the computer's zone, even when the chart used UTC or a named exchange zone. It also silently chose one occurrence of a repeated clock time and lost seconds. It now resolves the same chart zone as the time axis and Go-to dialog. The visible zone/offset reflects the selected historical instant rather than today's offset.

The shared wall-clock resolver accepts minute or second precision without changing existing minute navigation. It rejects invalid dates and skipped local times, returns both instants of repeated times and retains the current Replay cursor's occurrence when displaying it. The toolbar exposes First/Second choices with UTC offsets and UTC times. Loaded-history limits are validated as absolute instants; HTML local min/max strings cannot correctly order a repeated hour, so those misleading constraints were removed.

Editing pauses playback and retains the draft until submission/reset. Enter submits the form. A chart/symbol/interval/feed/zone context change resets the local draft to the current cursor in the new context; submission also checks the current context. An `input` handler supplements `change` so native date widgets cannot display a new value while submitting an old React value. Invalid input remains visible with a local error and never issues a seek. Seconds are accepted by the control; the actual target candle follows the selected interval and native Replay's snapping, rather than inventing intermediate bars.

The older fold target exposed another issue: native Vela backfilled historical pages, while the common candle cache retained only the recent head. Thus the chart could display an older Replay while its header/paper reference/Technicals lacked that candle. The MarketService feed's finite-end paging seam now retains returned pages in the same bounded series, while returning only the requested page to Vela. Current snapshots win overlaps, the cache stays capped at 20,000 bars, and stale feed generations, changed market-source epochs or source kinds cannot commit old pages. Cache extension does not emit tick/close events or live trade/volume signals. Existing candle-gap recovery remains a separate from-only range path.

## Verification

- **89 test files / 1,093 tests passed**; final production build and standalone TypeScript passed. Logs: `artifacts/replay-zone-tests.log`, `replay-zone-build.log`, `replay-zone-typecheck.log`.
- Sixteen new date tests cover UTC/named/exchange zones, exact seconds, European/American folds, the half-hour Lord Howe fold, skipped minutes/seconds/day, invalid values, pre-epoch bounds, exact epoch-zero boundaries and missing/invalid history. A folded wall time lexically before the first bound is accepted only when its chosen UTC occurrence is within that bound.
- Two actual service tests verify page retention, newer cumulative snapshot precedence, selected-store propagation, no tick/close signals and a stale page rejected after the feed generation changes. Full-suite tests include the existing native gap-recovery and 150,000-trade soak contracts. Capacity and source fencing are not a multi-client endurance guarantee.
- Final production browser on actual Hyperliquid BTC/5m history: Berlin `2026-10-25 02:30` First evaluated `00:30 UTC` (O 80,839 / H 80,891 / L 80,836 / C 80,891 / V 17.89). Second evaluated `01:30 UTC` (O 80,771 / H 80,772 / L 80,748 / C 80,757 / V 9.45). Both rendered historical OHLC and Technicals; Second remained selected after seeking.
- Berlin `2026-03-29 02:30` was visibly rejected as nonexistent. `2026-10-20 12:00` was rejected outside the loaded history. Editing while playback was active paused it and retained `02:35:17`, with candidates `00:35:17 UTC` and `01:35:17 UTC`. Switching to UTC discarded that unsaved draft and displayed the same existing cursor at `01:30 UTC`.
- At 375px, document width and scroll width were both 375px. The Replay strip was 282px wide with 677px scrollable contents; activating Go-to scrolled it to 358px, and Exit was reachable. Temporary viewport override was reset. At 1280px the folded toolbar fits one compact row; its remaining-bar count is hidden only while occurrence selection needs the space.
- Final state: native Replay exited; BTC/5m/Candles/UTC, EMA/Volume, original five-symbol watchlist visible and bottom panel collapsed. Captured warnings/errors empty. No order or alert command was created. A transient live-history recovery after the mobile/source-priority change completed before the final screenshot.

Evidence: `artifacts/replay-zone-browser.json`, `replay-zone-fold.png`, `replay-zone-gap.png`, `replay-zone-mobile.png`, `replay-zone-production.png`.

## Boundaries

These checks cover the actual named scenarios, not all markets, chart styles, devices or exchange session calendars. Historical pages remain subject to source retention, interval availability and the 20,000-bar cache cap. Source epochs and generation fences are local-client protections. Intrabar Replay, tick-bar clocks, every native carry-over transition and exact TradingView UI behavior still need broader verification.
