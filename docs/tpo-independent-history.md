# Independent history for explicit TPO sessions

The [Vela TPO specification](https://docs.luxalgo.com/platform/charts/order-flow/tpo)
distinguishes inherited Full day profiles from explicit trading windows. Explicit
Yahoo Day windows now load their own OHLCV snapshots: RTH requests regular bars;
ETH, named windows and Custom request extended bars, then the selected calendar
filters the result. Full day, Week/Month, continuous venues and Simulation retain
their existing chart source.

Each native TPO/overlay layer owns its source lifecycle. An immutable bounded pool
coalesces matching requests, but the source candles and calendar stay separate
from the chart history, global session registry and other instances. Model,
volume ladder, IB, structure and extensions use this independent source. Optional
native price candles continue to paint the actual host bars. Loading/failure
states withhold obsolete values; 15-second refresh/retry also works in a quiet
market, and expired live snapshots are withheld after a suspended tab wakes.
Market, parameter, epoch, Replay and disposal fences reject late responses.

Replay may cache a source day's full response, but only candles closed through
the revealed boundary reach the model. A partially revealed bucket uses only
the chart's actual partial OHLC, never the final REST wick/volume. Backward seeks
reapply the same filter. Yahoo requests now accept an explicit lower bound and
anchor retention to the present, avoiding an older Replay end shifting the
request outside the provider's allowed history.

Browser and server following-TPO rules prepare explicit session dependencies
independently of ordinary indicator history. Identical tape dependencies are
shared, unavailable/stale sources withhold signals, and source arrival/recovery
establishes a baseline before subsequent observations can cross. Source loading
does not publish global close, trade, quote or recording events. Existing normal
observation/close cadence remains in force; this does not create unseen ticks or
synthetic after-hours close events.

The public Vela control bundle also shows a compressed-session rail below 14
pixels. Range, VA and POC now remain visible at that scale, including windows
inside compressed chart gaps. Native session menus can target the rail, while
the block tooltip does not invent an individual letter under that coarse mark.

## Evidence

- Full suite: **1,985 tests across 183 files passed**, standalone TypeScript
  and production build passed, including eleven source
  lifecycle/Replay cases, four alert-source cases, a persisted server-source
  regression, three rail/host-candle cases and three Yahoo-window regressions.
  Existing following-TPO, calendar, renderer and source tests remain included.
- `scripts/verify-tpo-independent-source-live.ts` runs the real Yahoo loader,
  source pool/controller, model and ladder against public AAPL responses. The
  retained run has 426 host candles, 452 independent RTH candles and 1,078 ETH
  candles over 18 source sessions. Pre-market contains 324 candles; all 18
  pre-market ladders correctly remain unavailable because Yahoo reported zero
  volume there. Source boundaries/counts and positive-volume totals agree,
  and the original host candles/calendar stay unchanged.
- The same probe loads an actual historical source window through
  `2026-11-02T17:45:00Z`: 961 independent candles, 16 profiles, and no source
  candle extending beyond that revealed boundary. Capture/report:
  `artifacts/tpo-source-live.json`.
- Isolated browser initially showed native inherited RTH beginning 14:30 UTC
  with nine candles alongside an ETH overlay beginning 09:00 UTC with 31
  candles. Both report zero missing revealed slots. Native explicit ETH also
  uses the independently fetched source. Readout evidence:
  `artifacts/tpo-source-paired-readouts.txt`, `tpo-source-eth-readout.txt`;
  screenshots: `tpo-source-eth-overlay.png`, `tpo-source-native-eth.png`.
- Final build browser: a saved ETH workspace starts cleanly; Oct 29 Replay
  advances from 17:00/37 source candles to 17:15/38, then a backward seek to
  16:30 retains 35. Exiting restores Nov 4 live source data with 32 revealed
  candles and no view-reset toast. The initial/restore viewport uses normal
  host-bar framing while an independent calendar is unavailable, without
  fabricating calculation windows. Native ETH settings fit 414px. Captured
  warnings/errors in the final fresh tab are empty. Screenshots:
  `tpo-source-replay.png`, `tpo-source-mobile-settings.png`,
  `tpo-source-final.png`; readout: `tpo-source-replay-readout.txt`.

## Remaining parity

Other providers still use their available chart candles. Independent-session
axis/autoscale behavior, direct Vela visual/default/metric comparison, archived
calendar persistence for recorded Replay, calendar-aware Week/Month completion,
complete after-hours observation cadence, populated multi-chart, real touch and
full-capacity performance remain open. Historical Yahoo candles are delayed and
retention-limited; no full execution/depth archive or Nasdaq entitlement is
implied. This is a bounded checkpoint, not full Vela Orderflow parity.
