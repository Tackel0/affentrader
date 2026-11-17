import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { Tick } from "../types/trading";
import { parseKrakenTrade } from "../lib/market/kraken";
import { RollingProfileCache, resolveRollingProfile } from "../lib/orderflow/rollingProfile";

const captures = new Map<string, Array<Record<string, any>>>(), errors: string[] = [], sockets: WebSocket[] = [];
for (const [symbol, url] of [["BTCUSDT", "wss://data-stream.binance.vision/ws/btcusdt@aggTrade"], ["KRK:BTC/USD", "wss://ws.kraken.com/v2"]]) {
  const records: Array<Record<string, any>> = [], ids = new Set<number>(); captures.set(symbol, records);
  const ws = new WebSocket(url); sockets.push(ws);
  ws.addEventListener("open", () => { if (symbol.startsWith("KRK:")) ws.send(JSON.stringify({ method: "subscribe", params: { channel: "trade", symbol: ["BTC/USD"], snapshot: false } })); });
  ws.addEventListener("error", () => errors.push(`${symbol}: public WebSocket error`));
  ws.addEventListener("message", event => {
    try {
      const msg = JSON.parse(String(event.data));
      for (const raw of symbol === "BTCUSDT" ? msg.e === "aggTrade" ? [msg] : [] : msg.channel === "trade" && msg.type === "update" ? msg.data : []) {
        const id = raw.a ?? raw.trade_id; if (!ids.has(id)) { ids.add(id); records.push(raw); }
      }
    } catch { errors.push(`${symbol}: malformed public payload`); }
  });
}
await new Promise(resolve => setTimeout(resolve, 20000)); sockets.forEach(ws => ws.close());
assert.deepEqual(errors, []);
const scale = 10n ** 18n;
function units(raw: unknown): bigint {
  const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(raw)); assert.ok(match);
  const decimal = match[2] ?? "", exponent = 18 + Number(match[3] ?? 0) - decimal.length; assert.ok(exponent >= 0);
  return BigInt(match[1] + decimal) * 10n ** BigInt(exponent);
}
const decimal = (amount: bigint) => Number(amount) / Number(scale);
const report = [];
for (const [symbol, raw] of captures) {
  assert.ok(raw.length, `${symbol}: no captured executions`);
  const observations = raw.map(r => ({ time: symbol === "BTCUSDT" ? r.T : Date.parse(r.timestamp), price: Number(r.p ?? r.price), amount: units(r.q ?? r.qty), buy: symbol === "BTCUSDT" ? !r.m : r.side === "buy" }));
  const ticks = raw.map(r => symbol === "BTCUSDT" ? { id: `${symbol}-${r.a}`, symbol, time: r.T, price: Number(r.p), quantity: Number(r.q), side: r.m ? "sell" : "buy", simulated: false } as Tick : parseKrakenTrade(r)!);
  // These are partial candles derived from this capture's observed executions,
  // not fabricated exchange OHLC history or a claim of complete candles.
  const groups = new Map<number, typeof observations>();
  for (const o of observations) { const time = Math.floor(o.time / 1000) * 1000, group = groups.get(time) ?? []; group.push(o); groups.set(time, group); }
  const bars = [...groups].sort((a, b) => a[0] - b[0]).map(([time, g]) => ({ time, open: g[0].price, close: g.at(-1)!.price,
    high: Math.max(...g.map(o => o.price)), low: Math.min(...g.map(o => o.price)), volume: g.reduce((n, o) => n + decimal(o.amount), 0) }));
  const checks = [];
  for (const count of [1, 3, 100]) {
    const selected = bars.slice(-count), first = selected[0].time, end = selected.at(-1)!.time + 1000, sample = observations.filter(o => o.time >= first && o.time < end);
    const low = Math.min(...sample.map(o => o.price)), high = Math.max(...sample.map(o => o.price)), rows = low === high ? 1 : 24;
    const bins = Array.from({ length: rows }, () => ({ buy: 0n, sell: 0n }));
    const lower = BigInt(Math.round(low * 1e8)), upper = BigInt(Math.round(high * 1e8));
    for (const o of sample) {
      const index = rows === 1 ? 0 : Math.min(rows - 1, Number((BigInt(Math.round(o.price * 1e8)) - lower) * BigInt(rows) / (upper - lower)));
      bins[index][o.buy ? "buy" : "sell"] += o.amount;
    }
    const total = bins.reduce((n, b) => n + b.buy + b.sell, 0n), totals = bins.map(b => b.buy + b.sell), max = totals.reduce((a, b) => a > b ? a : b);
    const center = (rows - 1) / 2, candidates = totals.flatMap((n, i) => n === max ? [i] : []);
    candidates.sort((a, b) => Math.abs(a - center) - Math.abs(b - center)); const poc = candidates[0];
    let from = poc, to = poc, volume = totals[poc];
    // Independent adjacent-row walk matching the app's documented profile rule.
    while (volume * 100n < total * 70n && (from > 0 || to < rows - 1)) {
      const down = from > 0 ? totals[from - 1] : -1n, up = to < rows - 1 ? totals[to + 1] : -1n;
      const above = up > down || up === down && to + 1 - poc <= poc - (from - 1), amount = above ? up : down;
      if (amount * 100n > total * 70n - volume * 100n) break;
      if (above) to++; else from--; volume += amount;
    }
    const actual = new RollingProfileCache().read(bars, ticks, "1s", resolveRollingProfile({ bars: count }), symbol).model.sessions[0];
    assert.equal(actual.start, first); assert.equal(actual.end, end); assert.equal(actual.tradeCount, sample.length); assert.equal(actual.rows.length, rows);
    const close = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(b)), `${symbol}: ${a} != ${b}`);
    actual.rows.forEach((r, i) => { close(r.buy, decimal(bins[i].buy)); close(r.sell, decimal(bins[i].sell)); });
    assert.equal(actual.valueArea.poc, poc); assert.equal(actual.valueArea.low, from); assert.equal(actual.valueArea.high, to);
    close(actual.valueArea.total, decimal(total)); close(actual.valueArea.volume, decimal(volume));
    checks.push({ count, observedBars: selected.length, observations: sample.length, rows, total: decimal(total), poc, vaFrom: from, vaTo: to, valueAreaVolume: decimal(volume) });
  }
  report.push({ symbol, observations: raw.length, verified: true, checks });
}
await writeFile("artifacts/rolling-profile-live.json", JSON.stringify({ checkedAt: new Date().toISOString(), report, captures: Object.fromEntries(captures) }, null, 2));
console.log(JSON.stringify(report));
