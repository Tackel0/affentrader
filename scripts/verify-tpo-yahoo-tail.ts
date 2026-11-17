import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { parseChart } from "../lib/market/yahoo";
import { buildTpoSessions } from "../lib/orderflow/tpoModel";
import { defaultTpo } from "../lib/orderflow/tpoSettings";
import { TpoVolumeLadderCache } from "../lib/orderflow/tpoVolumeLadder";

const response = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=15m&range=1mo");
assert.ok(response.ok);
const raw = await response.json(), result = parseChart(raw);
const prefs = { ...defaultTpo(), ladderVisible: true, ladderRows: 12, ladderValueAreaPercent: 80 };
const sessions = buildTpoSessions(result.bars, prefs, "15m", "AAPL");
const ladders = new TpoVolumeLadderCache().read(result.bars, sessions, prefs);
let total = 0;
for (const session of sessions) {
  const expected = result.bars.filter(b => b.time >= session.start && b.time < session.end).reduce((n, b) => n + b.volume, 0);
  const ladder = ladders.get(session.start)!;
  assert.ok(ladder.profile); assert.ok(Math.abs(ladder.profile.total - expected) <= Math.max(1e-9, expected * 1e-10));
  total += expected;
}
const timestamps = raw.chart.result[0].timestamp as number[];
const report = { capturedAt: new Date().toISOString(), raw, sourceRows: timestamps.length, candleRows: result.bars.length,
  excludedQuotePoints: timestamps.length - result.bars.length, profiles: sessions.length, observedVolume: total,
  basis: "Delayed Yahoo OHLCV estimate; no classified trade data", verified: true };
await writeFile("artifacts/tpo-ladder-yahoo-live.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, raw: undefined }));
