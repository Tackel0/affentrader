# Alert activity and expiration

Implemented and verified on 2026-10-26. This adds inactivity handling to the existing [scheduling lifecycle](alert-scheduling.md) and [exclusive browser ownership](browser-alert-ownership.md).

TradingView's [alert introduction](https://www.tradingview.com/support/solutions/43000520149-introduction-to-tradingview-alerts/) states that automatic inactivity deactivation requires all three conditions: creation, last trigger and last edit are more than a year old. Open-ended alerts are subject to this rule. TradingView does not specify the exact leap-day boundary or a portable metadata format; the choices below describe this implementation and do not prove exact native equivalence.

## Shared lifetime policy

`lib/alerts/lifecycle.ts` computes one policy for ordinary price alerts, technical/composite/watchlist rules, Pine subscriptions and drawing subscriptions. An explicit UTC deadline wins at equality. Inactivity applies strictly after the latest relevant activity's next UTC calendar anniversary; leap day is clamped to February's final day. A recent creation, saved edit or accepted trigger independently prevents inactivity expiration. Neither an absent explicit deadline nor a repeating trigger exempts an alert.

`activity.trackedAt` is the earliest trustworthy tracking point. `editedAt` records a saved user edit. `triggeredAt` records the wall-clock receipt/commit of an accepted firing, separately from the event's market/bar timestamp. Trigger history retained elsewhere is also considered conservatively. Last-trigger activity survives rearming even when the trigger engine clears its observation/frequency fields. A blocked, rate-limited, rejected or duplicate firing does not renew it.

Legacy records lack an edit history. Their first lifecycle sweep stores `trackedAt` without inventing `editedAt`, preserving the original `createdAt`; their inactivity grace lasts one full year from tracking. Already-known explicit deadlines still expire immediately. New saves carry activity through persistence, workspace exports/imports and server snapshots. Imported valid historical activity is retained. Schema validation rejects invalid activity and expiration metadata.

## Explicit edits and automatic updates

All four browser editors use `edit`/`editRule` inside the serialized alert-write queue. A save renews edit activity and clears the prior expiration reason. The server stamps edits with its own current clock and preserves the stored creation and trigger activity; it does not trust a client's replacement lifecycle history for an existing rule. An expired form can therefore renew an open-ended alert, or choose a new deadline.

Generic `update`/`updateRule` remain runtime mutations. Quote observations, condition evaluations, drawing geometry synchronization, watchlist membership changes, rate/member resets, pause/resume, Pine recovery cursors and background polling do not count as an edit. Membership-only comparison ignores this runtime metadata so another member's new trigger does not destroy preserved crossing baselines.

## Expiration, concurrency and notifications

The elected browser's one-second lifecycle sweep migrates and expires local records under the existing atomic write lock; server-owned snapshots are left to the server. A stale tab first hydrates a newly saved edit, preventing an obsolete expiry plan from stopping a renewed alert. Storage failure rolls back both status and activity migration. Active and paused records can become Expired; existing terminal records retain their status.

Server evaluation sweeps before loading any markets, then checks the elapsed wall clock again before committing a firing plan. A request that finishes after inactivity or a configured deadline produces no event or notification. The expiration status/reason persists atomically. Accepted server firings renew activity in the same event/status write. Persisted metadata survives a cold restart. This is still the local server's polling lifecycle, not redundant hosted execution.

Cards distinguish a scheduled deadline from **Stopped — inactive for over a year** and explain renewal through editing. Expiration does not add a trigger-log event or play a sound. The dialog documents inactivity even when Open-ended is selected.

## Verification

- Twelve calendar/browser-state tests cover strict anniversaries, leap days, each independent activity timestamp, legacy grace, scheduled deadlines, validation, active/paused versus terminal records, explicit edits, receipt time, rearming and stale event rejection.
- Five isolated actual-server tests cover no-market expiry, cold persistence, legacy migration, authoritative edit time, accepted triggers and inactivity expiry during an in-flight quote request.
- Two independent-store transaction cases cover a stale tab sweeping a concurrent renewal and rollback of both migration/expiry on quota failure. Existing rate-dispatch fixtures now use one consistent test wall clock for the engine and commit paths.
- Production UI imported a backed-up workspace plus one historical price-alert fixture. It became Expired with the inactivity reason without a price trigger. Edit → Save renewed it; a second tab and a reload retained Active. Export confirmed the original 2024 creation/tracking point, an actual 2026 edit time and cleared expiration metadata. The fixture was paused, exported for recovery and removed; the original 15 alerts/rules, zero active and 123 trigger-log entries remain. No existing alert was activated and no paper trade was submitted.
- Evidence: `artifacts/alert-inactivity-expired.png`, `alert-inactivity-renewed.png`, `alert-lifecycle-ui-proof.json`, plus the final test/build/typecheck logs and checkpoint in `artifacts/verification.md`.

Full TradingView alert parity remains open for exchange-session boundaries, complete Pine/input/request semantics, native timing details, full-universe capacity and distributed notification delivery. A local clock can be wrong or changed; browser timers require an open owner, and the server must be running. Tracking is not retroactive proof of older edits.
