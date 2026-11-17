# Session Volume Profile trading hours

Reference checked 2026-11-04:
https://docs.luxalgo.com/platform/charts/order-flow/volume-profiles

Session VP now shares TPO's ten Day trading-hour choices: Full day, RTH, ETH,
Pre-market, Market, Post-market, London, New York, Asian and Custom UTC HHMM.
Named windows use fixed UTC approximations. Custom end at/before start wraps
overnight. Invalid HHMM minute digits do not roll into another hour. Week and
Month remain UTC calendar periods and ignore Day windows. Rolling profiles
keep their bar window and do not expose daily-session controls.

RTH/ETH use supplied source calendar windows when available. Full day inherits
the owning chart's regular/extended mode. The configured clock remains the
fallback on continuous/no-calendar venues; this does not create an equity
exchange calendar or a classified trade feed. Profiles still contain retained
classified observations only. A wider window cannot reconstruct missed trades
or executions that were never supplied by the source.

Both the synchronous model and the shipped background worker use the shared
calendar. Worker requests carry their own captured calendar snapshot. Their
cache keys include hour selection and source calendar identity. Source-window
revisions invalidate an existing profile and fence pending results, including
a revision occurring before the old worker callback arrives. Calendar payloads
are copied when queued, preventing later mutation from changing a queued job.
Window edits retain the study's collected tape and recompute eligible sessions.

New profiles use the documented 24 rows and 30% width. Explicit older saved
values such as 40 rows / 25% width remain unchanged. Settings hide Custom
fields outside Custom and hide all Day options for Week/Month. Legend and
Data Window identify the chosen hours; the readout reports their source basis.

Verification:

- Thirteen new tests cover all named boundary pairs, Custom overnight/invalid
  HHMM, RTH/ETH and per-chart Full-day modes, Week/Month exemptions, legacy
  overrides, conditional controls, worker parity, quiet-source revisions,
  stale worker results and immutable queued calendar snapshots.
- **2,055 tests across 190 files passed**, standalone TypeScript and production
  build passed. Logs: `artifacts/session-profile-hours-tests.log` and
  `artifacts/session-profile-hours-build.log`.
- `scripts/verify-session-profile-hours-live.ts` compared 1,000 recent actual
  Kraken executions with an independent raw-tuple oracle for nine full/named/
  custom UTC windows. Observed quantities and filtered-empty windows matched.
  Capture: `artifacts/session-profile-hours-live.json`. This capture does not
  verify a real equity RTH/ETH classified feed; source calendars use fixtures.
- Isolated production browser: a new 24-row/30%-width profile alongside an
  older 40-row profile, ten hour choices, conditional Custom and Week controls,
  New York on live Kraken, persisted hours after reload and 414×720 settings.
  Screenshots: `artifacts/session-profile-hours-native.png` and
  `artifacts/session-profile-hours-mobile-settings.png`.

Still open: developing POC/VA traces and naked-POC extension parity, direct Vela
bin/value-area/color/width comparison, populated multi-chart and combined
recording/reload/Replay acceptance, and complete market-data coverage.
