# TPO reference extensions until observed touch

The native TPO settings now offer **Stop extensions at first observed touch**, off by default. When enabled, each completed POC, VAH and VAL extension ends independently at the center of the first revealed candle whose inclusive low/high range contains that exact canonical level. The source profile must still be fully covered and completed.

Only candles opening at or after the source session end qualify. Price gaps do not imply a touch. Missing candles may hide an earlier contact, so the interface says **first observed touch**, never an unqualified first touch or naked level. The Data window shows the observed candle's opening timestamp and explicitly distinguishes that label from the unknown intrabar contact time. If no loaded candle contains the price, it says **None in loaded candles; gaps are unknown**.

The existing continuous-extension mode is unchanged. Fixed snapshot price alerts remain fixed snapshots and can still be created from the latest completed profile. This feature does not introduce automatically refreshed TPO alerts or synthesize historical alert events.

## Implementation and verification

- `tpoReferenceTouches.ts` computes all first observed contacts in a reverse time sweep over compressed reference prices. Range assignment and point lookup avoid scanning the future history separately for each reference: O((bars + references) log references). The layer caches unchanged results and compares every contributing bar time/high/low to catch older in-place repairs.
- Renderer segments stop independently, preserve inverted scales, clip to the visible pane and omit zero-length segments when the first post-session bar already touches the level. Continuous mode still reaches the right edge.
- Replay passes only its revealed bars into the model and touch index. Backward seeks discard later contacts. Neither an unobserved future candle nor pre-completion OHLC can terminate a line.
- Saved native settings and workspace validation accept old preferences without the optional toggle, defaulting to false. Invalid toggle values are rejected.
- **1,522 tests across 134 files passed**, including eight new tests: exact inclusive edges, price/time gaps, incomplete/developing profiles, seeded comparison with an independent chronological oracle, 20,000-session indexing, cache repair/Replay invalidation, actual renderer geometry, Data-window labels and preference compatibility. Production build including TypeScript passed. Logs: `artifacts/tpo-touch-tests.txt` and `tpo-touch-build.txt`.

## Actual production browser

Hyperliquid BTC, 5m, UTC, five-day history, source profile 2026-10-28:

| Reference | Exact price | First observed touching candle |
| --- | ---: | --- |
| POC | 80891.595 | 2026-10-29 01:10 UTC |
| VAH | 81351.36 | 2026-10-29 14:35 UTC |
| VAL | 80612.13 | 2026-10-29 01:35 UTC |

At Replay 01:05 all three contacts were absent. One **Next replay bar** exposed only the POC contact at 01:10; that native candle had low 80829 and high 80962, enclosing 80891.595. At noon, POC/VAL were observed while VAH remained absent. At 16:00 all three contacts were available. Seeking backward to 01:05 removed the later timestamps again. Toggling the option off visually restored continuous reference lines; turning it on bounded them again. The checked setting survived reload.

Evidence: `artifacts/tpo-touch-{before-contact,at-contact,contact-data-window,replay-noon,later-contact,backward-seek}.txt`, `tpo-touch-three-levels.jpg`, `tpo-touch-replay-noon.jpg`, `tpo-touch-continuous.jpg`. Browser console errors: none. The workspace was restored to BTC 5m Candles, EMA/Volume, Watchlists, UTC and Replay off; extension/touch toggles returned off. Server remains on port 3000.

The broader goal remains active: complete historical executions, exchange entitlements and full TradingView/Vela parity are not established by this checkpoint. [Following TPO reference rules](tpo-following-alerts.md) were added in the subsequent checkpoint. The previously asserted histogram failure has been [re-audited and its evidence corrected](tpo-presented-evidence.md); this feature is not a raster workaround.
