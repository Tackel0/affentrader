# Footprint presentation and settings — 2026-10-27

Reference: the public [Vela Pro page](https://velacharts.dev/pro/) and its [footprint image](https://velacharts.dev/images/vela/pro-footprint-interface.jpg), inspected in the browser on2026-10-27. The reference shows two independent red Bid / green Ask histograms, volume text near the center, a POC outline and a narrow candle alongside. This is the host's public-SDK renderer; no closed Pro package or private source was copied. Complete visual/algorithm equivalence is not established.

## Changes

- Replaced a single full-width cell wash over wide base candles with per-side histograms normalized to the largest side volume in each bar, neutral theme-aware volume labels, independent diagonal imbalance colors/opacity and one per-bar POC outline. Side candles retain actual OHLC even before trade collection and in Replay; the Replay surface explicitly identifies the lack of recorded bid/ask history. No order flow is manufactured from those candles.
- The active native Footprint settings page controls manual price row size (0 selects auto), auto row height, diagonal imbalance ratio, histogram/candle/POC/imbalance visibility, Bid/Ask/POC/text colors and automatic theme text. Bounded explicit preferences persist through owning-cell series binding, saved layouts and backups. Older preferences missing the optional footprint bag restore defaults; unrelated SDK type bags are retained.
- Default framing allocates100px per bar, keeps two bars on narrow panes and adds0.55/0.65 interval padding on the left/right. The first/last footprint halves therefore fit without the last Ask column disappearing under the price scale. Initial focus, switching into Footprint and Reset to recent candles use this helper. User date/range commands remain separate.
- Footprint trade buckets now use the same week/month calendar as candles. Both diagonal sides may be imbalanced at once. Invalid/nonpositive executions are excluded. Tick-count intervals are explicitly unavailable for Footprint rather than assigning real execution times to the synthetic tick-bar axis. CVD also no longer receives those fabricated timestamp buckets.

## Verification

1,235 tests across105 files pass. Eleven new tests cover side geometry/volume scaling/POC, visibility, inverted projection, theme/custom inks, narrow bars, settings validation, SDK registration, simultaneous imbalances, calendar alignment, malformed executions, independent cells/layouts/backup rejection, legacy restoration and footprint edge/Replay framing. An earlier concurrent build/test run exceeded the unchanged30s market-soak limit and interrupted a wall-clock-bounded Pine test (retained in artifacts/footprint-tests-contended.log). Repeating the complete suite after the build with --maxWorkers=4 passed all1,235 tests in25.18s. Full production build and standalone typecheck pass; see artifacts/footprint-{tests,build,typecheck}.log.

Actual production browser: BTC/5m Hyperliquid classified live executions draw distinct Bid/Ask cells, POC and side candle. Native edits rowSize20/rowHeight24/ratio4/POCfalse survive reload. Turning histogram and candle off retains text and POC. Mobile375x812 edit rowHeight26 and both visibility flags remains after reload; document scrollWidth stays375. Actual mobile Replay/Reset shows two real OHLC side candles and the explicit absence-of-history notice, with no footprint cells. Actual first image exposed last-column clipping; the framed image after Reset shows both sides inside the price pane. Screenshots were visually inspected. Default0/18/3 and all visibility/theme switches restored, original BTC/5m/Candles/UTC/Dark, EMA20/Volume and collapsed bottom retained, viewport override cleared, no studies/orders/alerts created. Captured warnings/errors empty.

Artifacts: footprint-before.png, footprint-after.png, footprint-settings.png, footprint-text-only.png, footprint-mobile-settings.png, footprint-mobile.png, footprint-replay.png, footprint-reload.json. The displayed quantities cover collected executions (latest5,000 retained), not full historical candle volume. Data before collection, actual tick-axis support, precise exchange ticks, stacked imbalance zones, unfinished auctions, complete bar statistics, advanced native session/TPO/volume-profile controls and pixel-exact parity remain open. Independent-cell/layout/backup behavior is unit-tested; this continuation's browser checks used the primary chart only.



Open transition observation: an immediate Reset directly after exiting Replay left the previous price framing until Reset was repeated after live candle recovery. The settled Reset succeeded; immediate exit/reset ordering is not fixed or fully verified by this continuation.


Follow-up2026-10-28: the observed immediate Replay exit/reset race is addressed by chart-local feed settlement and automatic stopped/finished return; see [Replay return](replay-return.md) for evidence and remaining coverage limits.

