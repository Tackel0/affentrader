# Alert scheduling and watchlist lifecycle

Implemented and verified on 2026-10-25. This extends the shared [observed alert runtime](alert-runtime.md); it does not establish complete TradingView alert parity.

## Trigger policies

| Explicit trigger | Evaluation and gate |
| --- | --- |
| Only once | Fires once for a symbol. Watchlist members finish independently; the rule becomes Triggered when all current members have fired. |
| Every time | Offered for ordinary price alerts. Evaluates each delivered observation; crossing and band conditions still require their actual event. |
| Once per bar | Evaluates after candle aggregation, with at most one firing per actual loaded candle identifier and symbol. An unknown tick-bar boundary cannot invent a firing. |
| Once per bar close | Uses confirmed candles and persists their evaluated boundary. A held true ordinary condition can fire at each new confirmed close. |
| Once per minute | At least 60,000 milliseconds between firings for each scope symbol. This is a rolling interval from the last firing, rather than a wall-clock minute bucket. |

Existing records without `trigger` preserve their previous transition/close and repeat settings. The editor retains an explicit legacy option until another trigger is selected. Cooldown also applies, so the stricter of cooldown and frequency wins. Restart/source changes establish a fresh observation baseline without dropping a recorded firing gate. Browser rules persist per-symbol `lastFired`; server rules additionally retain their observation and closed-candle state in the atomic JSON store. Workspace validation accepts and preserves the new fields.

## Expiration

`expiresAt` is UTC epoch milliseconds. The input is explicitly labelled UTC and parsed independently of the computer's local timezone, including daylight-saving transitions. Ordinary alerts can be open ended; new explicit watchlist alerts require a finite future expiration. The suggested date is two calendar months ahead, clamped to the destination month's last day. Legacy open-ended watchlist backups remain readable.

Active and paused browser alerts become Expired on a one-second lifecycle timer without waiting for market data. Server evaluation expires rules before requesting prices, and checks elapsed wall time again before committing results from a slow request. Exactly at the deadline, a firing is rejected. Expired cards cannot be activated until edited with a future date or an allowed open-ended setting.

A real browser check exposed a datetime input event defect: filling a short deadline initially retained the default date in React state. `AlertTimingFields` now reads both native input and change events, avoids resetting partially edited values, and synchronizes external open-ended changes. After rebuilding, the saved card displayed the exact entered UTC deadline and automatically changed to Expired. A subsequent reload retained that status and the disabled activation control.

## Watchlist changes

Rules follow the current named list. Sections are excluded, identifiers normalize without changing case-sensitive builder symbols, and duplicates are removed. Removed symbols lose their completion/frequency records; remaining members retain theirs. Adding a new pending member can reactivate a completed one-shot rule. A paused rule stays paused. Empty lists remain representable after removal, while the form rejects creation of an empty watchlist rule.

Browser rules update immediately from the persisted watchlist store. Server rules use an authenticated, members-only `PATCH /api/alerts` request, which prevents a stale browser definition from overwriting current server evaluation state. Failures surface in a toast and can retry on a later update. Server membership edits and firing commits are serialized through the existing JSON store. Credentials and webhook secrets are not exposed by the response.

## Evidence and boundaries

- Complete final suite: 45 files / 476 tests passed, including 21 scheduling tests and 27 server-alert tests. TypeScript and the production build passed. Output: `artifacts/alert-schedule-tests.log`.
- Production browser: `BRENTOIL RSI verification` saved as Once per minute, paused and reloaded; its exact `HL:xyz:BRENTOIL` identifier and open-ended state persisted. `Expiration verification` expired at the entered 2026-10-25 10:08:58 UTC and remained expired after reload.
- Production browser: `Watchlist timing verification` required a deadline and disabled Open-ended. Appending `HL:SUI` to Hyperliquid changed its scope from four to five symbols without editing the rule. Reload preserved five members and the paused status. Audio and browser notifications were disabled for these verification alerts.
- Screenshots: `artifacts/alert-frequency-dialog.png`, `artifacts/alert-expiration-production.png`, `artifacts/alert-schedule-production.png`. Server persistence, concurrency, delayed-request expiration and authenticated membership updates were checked with actual isolated JSON stores and controlled provider inputs; no live external webhook/push delivery or authenticated production membership request is claimed.

The browser still limits candle-dependent watchlist preparation to 40 symbols; the local server loads at most 60 series per pass. Server observation is polled, normally every 15 seconds, and provider/cache freshness may be coarser. Frequency gates do not recover unseen intraperiod crossings or establish continuous hosted operation. Subsequent work implemented [movement operators](alert-movement.md), with an explicit native-equivalence limit, [excessive-trigger stops](alert-rate-limits.md), with independent watchlist member recovery, and [inactivity expiration](alert-lifecycle.md), with durable activity tracking and a legacy grace period. Exact exchange-session boundaries and distributed delivery guarantees remain open work.

Primary reference behavior: [alert frequencies](https://www.tradingview.com/support/solutions/43000474415-differences-between-alert-frequencies/), [price-alert frequency choices](https://www.tradingview.com/support/solutions/43000690908-why-is-the-once-per-bar-option-missing/), [expiration configuration](https://www.tradingview.com/support/solutions/43000763312-learn-how-to-configure-alerts/), [independent dynamic watchlist alerts](https://www.tradingview.com/support/solutions/43000739708-watchlist-alerts-your-trading-edge/), [excessive-trigger stops](https://www.tradingview.com/support/solutions/43000690939-alert-was-triggered-too-often-and-stopped/).
