# Browser alert ownership

One current-build main tab per browser storage origin owns price alerts, technical/drawing/watchlist evaluation, saved Pine execution, expiration, watchlist reconciliation, server-event polling and browser notifications. Other tabs remain interactive and show **Browser alerts on standby** in the alert manager. Leaving the owning page releases its exclusive browser lock; a waiting main tab refreshes saved state before becoming the evaluator. Popouts continue to display shared alerts without competing to evaluate them.

`BrowserAlertLease` holds a native Web Lock for its entire execution lifetime. There is no timer-based lock expiry or forced stealing that could leave an older worker running concurrently. Revocation immediately invalidates its generation and synchronously terminates the Pine worker before releasing the lock. Pending history, interpreter, event and server responses check the generation again before committing. Late messages or secondary-series replies from terminated workers cannot affect a newly created worker.

The [W3C Web Locks specification](https://www.w3.org/TR/web-locks/) defines cooperative exclusive locks and automatic release on callback completion or document termination. HTTPS or localhost and Web Locks support are required. Unsupported browsers show an explicit unavailable state instead of independently evaluating in every tab. A frozen but still-open owner may delay observation; it is not forcibly stolen. This is local browser coordination, not hosted failover or observation of ticks that were never delivered.

## Shared edits and durable writes

Every alert-manager edit, creation, deletion, pause/restart, runtime firing, server mirror update and workspace restore uses the same origin-wide write lock. Once acquired, the command reloads a newer saved alert snapshot before applying its change. Commands in standby tabs therefore preserve updates made by the owner. The alert persistence adapter buffers the command's mutations and publishes one complete snapshot. A failed storage write restores its pre-command in-memory state and leaves the preceding durable snapshot intact. Invalid external storage is retained and reported instead of silently overwritten.

Notifications follow accepted, persisted events. Browser process termination between recording and external notification can still lose the notification; exactly-once external audio/webhook/push delivery is not claimed. Saved script journals retain their existing delivery cursor and recovery checks across ownership transfer. Price/technical evaluators establish a fresh observation baseline while retaining saved frequency and rate gates; the handoff does not invent a crossing across an unobserved interval.

All tabs must run the current build. Older application code that does not participate in these locks is outside this coordination protocol. Browser profiles, devices and separate deployments do not share the same lock manager. [Shared paper-trading execution](paper-trading.md) uses its own independent matcher lease and account-write lock; it does not compete for the alert lease.

## Drawing publishers

A drawing edit can originate in either the active or a standby main tab. Only actual local archive/owning-axis changes publish an intent. Merely opening an older chart, loading another tab's alert, polling server state or acquiring the evaluator lease never adopts that chart's geometry.

Each intent identifies its previous source revision and proposed geometry. The write transaction compares it with the alert's latest revision; a stale source is rejected visibly. Reopen the alert and explicitly save to choose the current chart as the binding. This preserves a newer drawing and its trigger gates when another tab still displays an older same-numbered object. Pending local edits are coalesced only when their revisions form one continuous sequence.

Unavailable states also have source revisions. Deleting a drawing records `missing`; disabling a selected level records that disabled geometry's revision while retaining the last usable geometry for inspection. Later edits and repair must follow that revision. Restoring availability leaves the alert stopped until explicit restart. Server geometry-only updates apply the same revision check under the existing authenticated JSON-store transaction. Device-wide conflict-free drawing ownership is still outstanding.

## Evidence

- `browser-alert-ownership.test.ts` runs exclusive queued acquisition, revocation before takeover, waiting cancellation, delayed/failed preparation, unsupported API handling, generation invalidation, serialized writes, lost-owner queued commits and actual price-condition cadence across handoff.
- `browser-alert-transactions.test.ts` uses two actual independently loaded Zustand modules over one backing store and lock manager. It verifies preserved edits, one-snapshot commands, quota rollback before/after an initial save, and retention of invalid storage.
- `drawing-edit-revisions.test.ts` checks stale-chart rejection, sequential/duplicate revisions, preserved pause/gates, unavailable/deleted/repair revisions, market/chart identity and legacy geometry normalization. Actual server/API tests also reject an obsolete pre-deletion revision.

Production UI evidence and final counts are recorded in `artifacts/verification.md`.
