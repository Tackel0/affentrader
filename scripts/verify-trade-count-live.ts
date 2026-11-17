import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { Tick } from "../types/trading";
import { parseKrakenTrade } from "../lib/market/kraken";
import { aggregateTradeCount } from "../lib/market/tradeCounts";
import { TradeCountAccumulator } from "../lib/orderflow/tradeCount";

interface Print { id: string; time: number; seq: number; count: number; side: "buy" | "sell" }
const captures = new Map<string, { ticks: Tick[]; prints: Print[]; raw: unknown[]; errors: string[] }>();
const sockets: WebSocket[] = [];
for (const [symbol, url] of [["BTCUSDT", "wss://data-stream.binance.vision/ws/btcusdt@aggTrade"], ["KRK:BTC/USD", "wss://ws.kraken.com/v2"]]) {
  const capture = { ticks: [] as Tick[], prints: [] as Print[], raw: [] as unknown[], errors: [] as string[] }; captures.set(symbol, capture);
  const socket = new WebSocket(url); sockets.push(socket);
  socket.addEventListener("open", () => { if (symbol.startsWith("KRK:")) socket.send(JSON.stringify({ method: "subscribe", params: { channel: "trade", symbol: ["BTC/USD"], snapshot: false } })); });
  socket.addEventListener("error", () => capture.errors.push("Public websocket error"));
  socket.addEventListener("message", event => {
    try {
      const data = JSON.parse(String(event.data));
      if (symbol === "BTCUSDT" && data.e === "aggTrade") {
        capture.raw.push(data);
        const count = data.l - data.f + 1, side = data.m ? "sell" : "buy", id = `${symbol}-${data.a}`;
        assert.ok(Number.isSafeInteger(count) && count > 0);
        capture.prints.push({ id, time: data.T, seq: data.a, side, count });
        capture.ticks.push({ id, symbol, time: data.T, seq: data.a, side, price: Number(data.p), quantity: Number(data.q), simulated: false,
          tradeCount: aggregateTradeCount(data.f, data.l) });
      } else if (symbol.startsWith("KRK:") && data.channel === "trade" && data.type === "update") {
        for (const raw of data.data) {
          capture.raw.push(raw);
          const tick = parseKrakenTrade(raw); assert.ok(tick);
          capture.ticks.push(tick);
          capture.prints.push({ id: `${symbol}:${raw.trade_id}`, time: Date.parse(raw.timestamp), seq: raw.trade_id, side: raw.side, count: 1 });
        }
      }
    } catch (error) { capture.errors.push(error instanceof Error ? error.message : "Invalid public trade"); }
  });
}
await new Promise(resolve => setTimeout(resolve, 15000));
for (const socket of sockets) socket.close();
const report = [];
for (const [symbol, capture] of captures) {
  const unique = [...new Map(capture.prints.map(print => [print.id, print])).values()].sort((a, b) => a.time - b.time || a.seq - b.seq);
  const expected = new Map<number, { time: number; open: number; high: number; low: number; close: number; volume: number; delta: number }>();
  let cumulative = 0;
  for (const print of unique) {
    const time = Math.floor(print.time / 60000) * 60000;
    const bar = expected.get(time) ?? { time, open: cumulative, high: cumulative, low: cumulative, close: cumulative, volume: 0, delta: 0 };
    const signed = print.side === "buy" ? print.count : -print.count;
    cumulative += signed; bar.high = Math.max(bar.high, cumulative); bar.low = Math.min(bar.low, cumulative);
    bar.close = cumulative; bar.volume += print.count; bar.delta += signed; expected.set(time, bar);
  }
  const model = new TradeCountAccumulator(symbol, "1m", "All data"); model.add(capture.ticks);
  const bars = [...expected.values()], times = bars.map(bar => ({ time: bar.time }));
  assert.deepEqual(model.candles(times, "cumulative"), bars.map(({ delta: _delta, ...bar }) => bar));
  assert.deepEqual(model.candles(times, "total").map(bar => bar.close), bars.map(bar => bar.volume));
  assert.deepEqual(model.candles(times, "delta").map(bar => bar.close), bars.map(bar => bar.delta));
  report.push({ symbol, observations: unique.length, prints: bars.reduce((sum, bar) => sum + bar.volume, 0), bars: bars.length,
    countEvidence: symbol === "BTCUSDT" ? "inclusive first/last underlying IDs" : "one print per raw matched trade", errors: capture.errors,
    verified: unique.length > 0 && !capture.errors.length });
}
await writeFile("artifacts/trade-count-live.json", JSON.stringify({ checkedAt: new Date().toISOString(), report, captures: Object.fromEntries([...captures].map(([symbol, capture]) => [symbol, capture.raw])) }, null, 2));
console.log(JSON.stringify(report));
if (report.some(source => !source.verified)) process.exitCode = 1;
