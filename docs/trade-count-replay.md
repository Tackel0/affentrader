# Trade Count: recorded native Replay acceptance

The 2026-11-06 local acceptance used the actual indicator catalog, archive dialog
and shared Replay controls in two native Vela cells (Kraken BTC/USD, 1m and 5m).
All three Trade Count studies were added to both cells. The archive contains 75
unique, non-simulated Kraken records with explicit `tradeCount: 1`, previously
recorded and reopened in the isolated browser origin. CTCD used UTC Day/Candles.

`scripts/verify-trade-count-replay.ps1` independently reads the raw archive and
the saved native Data window text. It imports no application count model. It
sorts executions by time, sequence and ID, sums signed print counts, and walks
the count path to reconstruct current-bar open/high/low/close. Quantity is never
used as a substitute for print count.

| Native candle | Exclusive shared boundary | Prefix | Candle total / delta | CTCD O/H/L/C |
| --- | --- | --- | --- | --- |
| 1m 10:55 | 10:56 UTC | 58 | 58 / +8 | 0 / 8 / -4 / 8 |
| 1m 10:56 | 10:57 UTC | 75 | 17 / -1 | 8 / 11 / 5 / 7 |
| 5m 10:55 | 11:00 UTC | 75 | 75 / +7 | 0 / 11 / -4 / 7 |

The earlier 5m candle remains empty while only the 1m cell advances. Seeking back
to 10:55 reconstructs the 58-record prefix. Removing the archive selection clears
all count readouts; reloading it restores that same prefix without another step.
Four additional saved checkpoints cover the empty initial prefix, inactive 5m
candle, missing next minute and removed archive. They contain no stale count or
CTCD values. The verifier passes five populated and four empty checkpoints.

Local evidence (excluded from the website ZIP):

- `artifacts/kraken-recorded-replay-live.json`: original public execution sample.
- `artifacts/trade-count-replay-*.txt`: actual native Data window observations.
- `artifacts/trade-count-replay-verification.json`: independent computed results.
- `artifacts/trade-count-replay-shared.png`: populated native two-cell screenshot.

This is a short, partial venue sample, not complete historical market data or an
arrival-order/intrabar playback claim. It does not establish every layout,
anchor, capacity limit or direct visual parity. The pinned native renderer still
shows a decimal suffix on integer counts. The browser tab had already closed on
continuation, so no final console-log artifact or extra reload is claimed here.
No application production code changed in this acceptance increment; the prior
2,397-test/225-file, TypeScript and production-build result remains the most
recent full gate. The focused rerun passes 59 count/archive/Replay tests in four
files (`artifacts/trade-count-replay-targeted.log`).
