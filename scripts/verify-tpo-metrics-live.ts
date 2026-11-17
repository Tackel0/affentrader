import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { loadKrakenClosedBars, loadKrakenRecentTrades } from "../lib/market/kraken";
import { aggregateTick } from "../lib/market/aggregation";
import { buildTpoSessions } from "../lib/orderflow/tpoModel";
import { defaultTpo } from "../lib/orderflow/tpoSettings";
import { TpoMetricCollection } from "../lib/orderflow/tpoMetrics";
const [raw, closed] = await Promise.all([
  fetch("https://api.kraken.com/0/public/Trades?pair=BTCUSD&assetVersion=1&count=1000", { signal: AbortSignal.timeout(15000) }).then(r => { assert.ok(r.ok); return r.json(); }),
  loadKrakenClosedBars("BTC/USD", "1m"),
]);
const trades = await loadKrakenRecentTrades("BTC/USD", 1000, async () => Response.json(raw));
assert.ok(trades.length > 0); assert.ok(closed.length > 0);
let bars = closed;
const cutoff = closed.at(-1)!.time + 60000;
for (const trade of [...trades].sort((a,b) => a.time-b.time)) if (trade.time >= cutoff) bars = aggregateTick(bars,trade,"1m").bars;
const style = {...defaultTpo(),rowSize:10,colorBy:"Volume" as const}, sessions = buildTpoSessions(bars,style,"1m","KRK:BTC/USD");
const collection = new TpoMetricCollection("KRK:BTC/USD"); collection.add(trades);
const metrics = collection.read(sessions,style,bars,"1m");
// Independent oracle from raw exchange tuple fields; no app price grid, metric
// aggregation or side/count parser is used to derive the expected quantities.
const expected = new Map<string,{buy:number;sell:number;count:number}>(), seen = new Set<number>();
for (const row of raw.result["BTC/USD"] as unknown[][]) {
  const seq = Number(row[6]); if (seen.has(seq)) continue; seen.add(seq);
  const time = Math.floor(Number(row[2])*1000), sessionStart = Math.floor(time/86400000)*86400000;
  if (!bars.some(b=>time>=b.time&&time<b.time+60000)) continue;
  const price = Math.floor(Number(row[0])/10)*10, period = Math.floor((time-sessionStart)/1800000);
  const key = `${sessionStart}:${price}:${period}`, value = expected.get(key) ?? {buy:0,sell:0,count:0};
  value[row[3]==="b"?"buy":"sell"] += Number(row[1]); value.count++; expected.set(key,value);
}
let checked = 0;
for (const session of sessions) {
  const own = metrics.sessions.get(session.start); if (!own) continue;
  for (let r=0;r<session.rows.length;r++) for (const [period,value] of own.cells[r]) {
    const key = `${session.start}:${session.rows[r].price}:${period}`, oracle = expected.get(key); assert.ok(oracle,key);
    assert.ok(Math.abs(value.buy-oracle.buy)<1e-10); assert.ok(Math.abs(value.sell-oracle.sell)<1e-10); assert.equal(value.count,oracle.count);
    expected.delete(key); checked++;
  }
}
assert.equal(expected.size,0); assert.ok(checked>0);
const report = {capturedAt:new Date().toISOString(),trades:trades.length,candles:bars.length,profiles:metrics.sessions.size,checkedCells:checked,message:metrics.message,scope:"Recent observed Kraken executions; candle-only history has no inferred aggressor metrics.",raw};
await writeFile("artifacts/tpo-metrics-live.json",JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,raw:undefined}));
