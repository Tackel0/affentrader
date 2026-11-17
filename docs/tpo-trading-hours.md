# TPO trading-hour windows

Both the chart type and overlay now expose the ten trading-hours choices in the
[Vela TPO reference](https://docs.luxalgo.com/platform/charts/order-flow/tpo).
Day-only filtering supports Full day, Regular hours (RTH), Extended hours (ETH),
Pre-market, Market, Post-market, London, New York, Asian and Custom. Week/Month
remain UTC periods and ignore daily window settings.

The fixed UTC windows were checked against the public Vela control bundle on
2026-11-04 (`/_next/static/chunks/1-1mg-s23l974.js`):

| Window | UTC start | UTC end, exclusive |
| --- | --- | --- |
| Pre-market | 09:00 | 13:30 |
| Market | 13:30 | 20:00 |
| Post-market | 20:00 | 00:00 |
| London | 08:00 | 16:30 |
| New York | 13:00 | 22:00 |
| Asian | 00:00 | 09:00 |

Custom uses valid numeric UTC HHMM endpoints, including 2400. An end at or before
the start wraps overnight; equal endpoints mean a full day. Invalid minute
digits produce a calendar error rather than silently selecting midnight.
The existing zoned clock controls remain a fallback for no-calendar venues.

Yahoo's actual `tradingPeriods` pass through metadata and the browser history
loader into a bounded per-symbol registry. RTH uses those regular windows; ETH
requires matching source pre/regular/post windows. Full day inherits the loaded
source tape. Holiday gaps, DST offsets and early closes are never recomputed or
extrapolated. Source-covered dates replace previous windows, including removed
windows or changed openings; older pages outside the covered dates remain.
Corrections invalidate model caches, and missing ETH metadata produces an
explicit unavailable message. The Data window reports the chosen basis.

Following TPO rules now retain period/window/HHMM settings. Copying an inherited
chart profile pins its actual RTH/ETH choice, while legacy rules keep their
original clock semantics. Calendar revisions establish a fresh observation
baseline; incomplete calendar/history coverage withholds signals. Calendar
availability does not manufacture candle close/trade events. Period-aware
history sizing and validation prevent silently undersized Week/Month rules.

## Evidence

- Eighteen trading-hours regressions cover fixed boundaries, overnight Custom,
  invalid HHMM, source tape inheritance, holiday/DST/early-close fixtures,
  removed/moved source windows, cache/scope changes, legacy settings, conditional
  controls, saved alert parameters, legacy alert clocks, unavailable ETH and
  observation rebaselining. Existing TPO/model/alert tests remain in the suite.
- Full suite: **1,963 tests across 179 files passed**, standalone TypeScript
  and production build passed. Logs use `artifacts/tpo-hours-`.
- `scripts/verify-tpo-trading-hours-live.ts` compares a fresh public AAPL 15m
  extended-hours response against independently extracted raw calendar windows.
  Six tape/window combinations each produced 23 profiles: regular groups contain
  579 candles, extended groups 1,347. Boundaries, candle counts and ladder volume
  totals agree. Raw response and report: `artifacts/tpo-hours-live.json`.
- Isolated browser: inherited AAPL RTH is 14:30–21:00 UTC, 26 expected 15m
  slots, zero missing revealed slots and a complete 60-minute IB. London is
  08:00–16:30 UTC, and Custom 2230–1630 starts on the previous date. Missing
  out-of-session history remains explicit. Readout evidence:
  `artifacts/tpo-hours-rth-readout.txt`; screenshot:
  `artifacts/tpo-hours-london.png`.
- Final production-build browser: invalid Custom 1260 shows an unavailable
  message, correction restores the profile, and alarm drafts preserve Custom
  2230/1630 or pin an inherited profile to RTH. Drafts were cancelled. The
  overlay retains Custom endpoints after reload and its inputs fit 414px.
  Screenshots: `artifacts/tpo-hours-rth.png` and
  `artifacts/tpo-hours-mobile-settings.png`. The deliberate invalid-HHMM case
  emits renderer error logs; the current valid profile renders again afterward.

## Remaining work

The subsequent [independent-history checkpoint](tpo-independent-history.md)
adds explicit-window history overrides for Yahoo, including separate layer and
alert sources and bounded Replay data. Other providers still use chart candles.
Source calendar metadata is wired
for Yahoo; other venue calendars, persisted calendar snapshots for recorded
Replay, weekly/monthly completion over exchange-session gaps, direct Vela
rendering/default comparison and full-capacity/multi-chart/touch checks remain
open. These controls do not establish full Orderflow parity.
