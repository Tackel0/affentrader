import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { Tick } from "../types/trading";
import { parseKrakenTrade } from "../lib/market/kraken";
import { aggregateTradeCount } from "../lib/market/tradeCounts";
import { BarStatsAccumulator } from "../lib/orderflow/barStats";

// Independent fixed-scale oracle for the captured BTC quantities (<=18 decimals).
const scale = 10n ** 18n;
function units(raw: unknown): bigint {
  const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(raw)); assert.ok(match);
  const decimals = match[2] ?? "", exponent = 18 + Number(match[3] ?? 0) - decimals.length;
  assert.ok(exponent >= 0); return BigInt(match[1] + decimals) * 10n ** BigInt(exponent);
}
function decimal(value: bigint): string {
  const negative = value < 0n, n = negative ? -value : value, fraction = String(n % scale).padStart(18, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${n / scale}${fraction ? `.${fraction}` : ""}`;
}
const sources = new Map<string, { ticks: Tick[]; raw: unknown[]; oracle: Map<number, { buy: bigint; sell: bigint; buyTrades: number; sellTrades: number }>; errors: string[] }>();
const sockets: WebSocket[] = [];
for (const [symbol, url] of [["BTCUSDT", "wss://data-stream.binance.vision/ws/btcusdt@aggTrade"], ["KRK:BTC/USD", "wss://ws.kraken.com/v2"]]) {
  const source = { ticks: [] as Tick[], raw: [] as unknown[], oracle: new Map<number, { buy: bigint; sell: bigint; buyTrades: number; sellTrades: number }>(), errors: [] as string[] };
  sources.set(symbol, source); const ids = new Set<string>(), socket = new WebSocket(url); sockets.push(socket);
  socket.addEventListener("open", () => { if (symbol.startsWith("KRK:")) socket.send(JSON.stringify({ method: "subscribe", params: { channel: "trade", symbol: ["BTC/USD"], snapshot: false } })); });
  socket.addEventListener("error", () => source.errors.push("Public websocket error"));
  socket.addEventListener("message", event => {
    try {
      const message = JSON.parse(String(event.data));
      const records = symbol === "BTCUSDT" ? message.e === "aggTrade" ? [message] : [] : message.channel === "trade" && message.type === "update" ? message.data : [];
      for (const raw of records) {
        const binance = symbol === "BTCUSDT";
        const id = binance ? `${symbol}-${raw.a}` : `${symbol}:${raw.trade_id}`;
        if (ids.has(id)) continue; ids.add(id); source.raw.push(raw);
        const time = binance ? raw.T : Date.parse(raw.timestamp), side = binance ? raw.m ? "sell" : "buy" : raw.side;
        const count = binance ? raw.l - raw.f + 1 : 1;
        assert.ok(Number.isSafeInteger(count) && count > 0); assert.ok(side === "buy" || side === "sell");
        const quantity = units(binance ? raw.q : raw.qty), bucket = Math.floor(time / 60000) * 60000;
        const totals = source.oracle.get(bucket) ?? { buy: 0n, sell: 0n, buyTrades: 0, sellTrades: 0 };
        if (side === "buy") { totals.buy += quantity; totals.buyTrades += count; }
        else { totals.sell += quantity; totals.sellTrades += count; }
        source.oracle.set(bucket, totals);
        const tick = binance ? { id, symbol, time, side, price: Number(raw.p), quantity: Number(raw.q), simulated: false, seq: raw.a,
          tradeCount: aggregateTradeCount(raw.f, raw.l) } : parseKrakenTrade(raw);
        assert.ok(tick); source.ticks.push(tick as Tick);
      }
    } catch (error) { source.errors.push(error instanceof Error ? error.message : "Invalid public execution"); }
  });
}
await new Promise(resolve => setTimeout(resolve, 15000));
for (const socket of sockets) socket.close();
const report = [];
for (const [symbol, source] of sources) {
  const model = new BarStatsAccumulator(symbol, "1m"); model.add(source.ticks);
  const expected = [...source.oracle.entries()].sort((a, b) => a[0] - b[0]).map(([time, b]) => ({ time,
    volume: Number(decimal(b.buy + b.sell)), buy: Number(decimal(b.buy)), sell: Number(decimal(b.sell)), delta: Number(decimal(b.buy - b.sell)),
    buyTrades: b.buyTrades, sellTrades: b.sellTrades, trades: b.buyTrades + b.sellTrades,
    exact: { volume: decimal(b.buy + b.sell), buy: decimal(b.buy), sell: decimal(b.sell), delta: decimal(b.buy - b.sell) } }));
  assert.deepEqual(model.read(), expected);
  report.push({ symbol, observations: source.ticks.length, prints: expected.reduce((n, b) => n + b.trades, 0), bars: expected.length,
    verified: source.ticks.length > 0 && !source.errors.length, errors: source.errors, expected });
}
await writeFile("artifacts/bar-stats-live.json", JSON.stringify({ checkedAt: new Date().toISOString(), report,
  captures: Object.fromEntries([...sources].map(([symbol, source]) => [symbol, source.raw])) }, null, 2));
console.log(JSON.stringify(report.map(({ expected: _expected, ...summary }) => summary)));
if (report.some(source => !source.verified)) process.exitCode = 1;
