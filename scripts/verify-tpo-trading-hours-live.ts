import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { parseChart } from "../lib/market/yahoo";
import { clearMarketSessions, registerMarketSessions } from "../lib/market/sessionWindows";
import { buildTpoSessions } from "../lib/orderflow/tpoModel";
import { defaultTpo } from "../lib/orderflow/tpoSettings";
import { TpoVolumeLadderCache } from "../lib/orderflow/tpoVolumeLadder";
const response = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=15m&range=1mo&includePrePost=true");
assert.ok(response.ok);
const raw = await response.json(), parsed = parseChart(raw), meta = raw.chart.result[0].meta;
assert.ok(parsed.meta.sessions);
const flatten = (rows: { start: number; end: number }[][]) => rows.flat().map(w => [w.start * 1000, w.end * 1000] as const);
const regular = flatten(meta.tradingPeriods.regular), pre = flatten(meta.tradingPeriods.pre), post = flatten(meta.tradingPeriods.post);
const extended = regular.map(w => [pre.find(p => p[1] === w[0])![0], post.find(p => p[0] === w[1])![1]] as const);
assert.deepEqual(parsed.meta.sessions.regular, regular); assert.deepEqual(parsed.meta.sessions.extended, extended);
const checks = [];
for (const mode of ["regular", "extended"] as const) {
  clearMarketSessions(); registerMarketSessions("YF:AAPL", parsed.meta.sessions, mode);
  for (const tradingHours of ["Full day", "Regular hours (RTH)", "Extended hours (ETH)"] as const) {
    const style = { ...defaultTpo(), tradingHours, ladderVisible: true };
    const windows = tradingHours === "Regular hours (RTH)" || tradingHours === "Full day" && mode === "regular" ? regular : extended;
    const sessions = buildTpoSessions(parsed.bars, style, "15m", "YF:AAPL"), ladders = new TpoVolumeLadderCache().read(parsed.bars, sessions, style);
    for (const session of sessions) {
      const window = windows.find(w => w[0] === session.start)!; assert.ok(window); assert.equal(session.end, window[1]);
      const candles = parsed.bars.filter(b => b.time >= window[0] && b.time < window[1]);
      assert.equal(session.coverage.loadedBars, candles.length);
      const volume = candles.reduce((n, b) => n + b.volume, 0);
      assert.ok(Math.abs(ladders.get(session.start)!.profile!.total - volume) < Math.max(1e-9, volume * 1e-10));
    }
    checks.push({ mode, tradingHours, profiles: sessions.length, loadedCandles: sessions.reduce((n, s) => n + s.coverage.loadedBars, 0), verified: true });
  }
}
await writeFile("artifacts/tpo-hours-live.json", JSON.stringify({ capturedAt: new Date().toISOString(), raw, checks }, null, 2));
console.log(JSON.stringify(checks));
