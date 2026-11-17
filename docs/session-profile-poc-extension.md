# Observed session POC extensions

Reference inspected 2026-11-04:
https://docs.luxalgo.com/platform/charts/order-flow/volume-profiles

Session Volume Profile exposes Extend POC until reached in Style. It defaults
off, follows the Point of control switch, and is excluded from Rolling Volume
Profile. Older preferences without the field remain valid.

Once a revealed host candle opens at/after a session's actual end, its collected
profile POC becomes eligible for extension. Canonical row centers are retained.
The line starts at the session end and stops at the earliest later revealed
candle whose inclusive high/low contains that price. Price gaps do not count.
An unobserved contact extends to the plot edge, including references whose
original profile is off screen. Week/Month and overnight windows use their
actual ends. No wall-clock inference turns a Replay prefix into a closed
session, and a backward seek cannot retain a later touch.

The shared reverse-sweep contact index is also used by TPO references, retaining
TPO's stricter complete-reference eligibility gate. Work is bounded by
O((bars + references) log references). A cache compares candle time/high/low
snapshots and completed POC prices, so cursor-only frames reuse results and
in-place history repairs invalidate them. All contacts come from the owning
chart's revealed candle array. No market or historical alarm events are emitted.

The Data Window reports the extension start and first observed touch, with the
explicit candle-opening-time basis. A missing touch means none in revealed
candles; gaps and unrecorded executions remain unknown. A profile reconstructed
from retained executions is still partial, including after its session ends.

Verification:

- Nine new cases cover completion gating, inclusive edges, price gaps, repairs,
  Replay seeks, actual Week/Month ends, off-screen references, unreached levels,
  parent/rolling controls, a brute-force oracle and readout provenance. Existing
  TPO contact tests still pass, including the 20,000-session capacity case.
- Full suite: **2,064 tests across 191 files passed**; standalone TypeScript and
  production build passed. Logs: `artifacts/session-profile-poc-tests.log`,
  `artifacts/session-profile-poc-build.log`.
- `scripts/verify-session-profile-poc-live.ts` independently checked integer
  price-bin quantities from 1,000 retained public Kraken executions and freshly
  loaded 720 closed minute candles. POC 80350 and first observed contact in the
  18:00 UTC candle matched the raw-tuple oracle. The selected observed session
  ended at 18:00, so this case correctly has immediate contact and no positive
  extension span. Capture: `artifacts/session-profile-poc-live.json`.
- Real native Vela canvas browser fixture, clearly labeled SIMULATED: an
  unreached reference extends past 13:00 to the plot edge; introducing an
  inclusive contact at 13:05 shortens the line to that candle. Fixture source:
  `tests/browser/session-poc-extension.ts`; local runner:
  `scripts/verify-session-poc-browser.mjs`. Screenshots:
  `artifacts/session-profile-poc-unreached-fixture.png`,
  `artifacts/session-profile-poc-touched-fixture.png`.

Still open: direct current Vela visual acceptance across sources and modes,
developing POC/VA traces, populated multi-chart and combined recorded Replay,
and complete historical execution coverage. This increment does not establish
full profile or Orderflow parity.
