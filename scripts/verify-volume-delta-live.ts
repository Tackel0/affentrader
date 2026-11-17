import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { Tick } from "../types/trading";
import { parseKrakenTrade } from "../lib/market/kraken";
import { aggregateTradeCount } from "../lib/market/tradeCounts";
import { CvdAccumulator } from "../lib/orderflow/cvdModel";
import { resolveCvd } from "../lib/orderflow/cvdSettings";

type Observation = { id: string; time: number; seq: number; quantity: number; buy: boolean; count: number };
const sources = new Map<string, { ticks: Tick[]; raw: unknown[]; observations: Observation[]; errors: string[] }>();
const sockets: WebSocket[] = [];
for (const [symbol, url] of [["BTCUSDT", "wss://data-stream.binance.vision/ws/btcusdt@aggTrade"], ["KRK:BTC/USD", "wss://ws.kraken.com/v2"]]) {
  const source = { ticks: [] as Tick[], raw: [] as unknown[], observations: [] as Observation[], errors: [] as string[] };
  sources.set(symbol, source); const ids = new Set<string>(), socket = new WebSocket(url); sockets.push(socket);
  socket.addEventListener("open", () => {
    if (symbol.startsWith("KRK:")) socket.send(JSON.stringify({ method: "subscribe", params: { channel: "trade", symbol: ["BTC/USD"], snapshot: false } }));
  });
  socket.addEventListener("error", () => source.errors.push("Public websocket error"));
  socket.addEventListener("message", event => {
    try {
      const message = JSON.parse(String(event.data)), binance = symbol === "BTCUSDT";
      const records = binance ? message.e === "aggTrade" ? [message] : [] : message.channel === "trade" && message.type === "update" ? message.data : [];
      for (const raw of records) {
        const id = binance ? `${symbol}-${raw.a}` : `${symbol}:${raw.trade_id}`;
        if (ids.has(id)) continue; ids.add(id); source.raw.push(raw);
        // Oracle reads venue fields directly, independent of the application decoders.
        const time = binance ? raw.T : Math.floor(Date.parse(raw.timestamp)), seq = binance ? raw.a : raw.trade_id;
        const quantity = Number(binance ? raw.q : raw.qty), count = binance ? raw.l - raw.f + 1 : 1;
        const buy = binance ? !raw.m : raw.side === "buy";
        assert.ok(Number.isSafeInteger(count) && count > 0 && Number.isFinite(quantity) && quantity > 0);
        source.observations.push({ id, time, seq, quantity, count, buy });
        const parsed = binance ? { id, symbol, time, side: raw.m ? "sell" : "buy", quantity, price: Number(raw.p), seq,
          tradeCount: aggregateTradeCount(raw.f, raw.l), simulated: false } : parseKrakenTrade(raw);
        assert.ok(parsed); source.ticks.push(parsed as Tick);
      }
    } catch (error) { source.errors.push(error instanceof Error ? error.message : "Invalid execution"); }
  });
}
await new Promise(resolve => setTimeout(resolve, 15000));
for (const socket of sockets) socket.close();
const report = [];
for (const [symbol, source] of sources) {
  assert.ok(source.ticks.length > 0, `${symbol}: no public observations`); assert.deepEqual(source.errors, []);
  const checks = [];
  for (const [timeframe, duration] of [["1s", 1000], ["1m", 60000]] as const) {
    const groups = new Map<number, Observation[]>();
    for (const observation of source.observations) {
      const time = Math.floor(observation.time / duration) * duration;
      const group = groups.get(time) ?? []; group.push(observation); groups.set(time, group);
    }
    const model = new CvdAccumulator(timeframe, resolveCvd({ anchor: "All data" }), symbol);
    model.add([...source.ticks].reverse());
    for (const mode of ["Total", "Average"] as const) for (const calculation of ["Bar delta", "Cumulative delta"] as const) {
      let cumulative = 0;
      const expected = [...groups].sort((a, b) => a[0] - b[0]).map(([time, group]) => {
        let buy = 0, sell = 0, buys = 0, sells = 0, high = 0, low = 0, delta = 0;
        for (const observation of [...group].sort((a, b) => a.time - b.time || a.seq - b.seq || a.id.localeCompare(b.id))) {
          if (observation.buy) { buy += observation.quantity; buys += observation.count; }
          else { sell += observation.quantity; sells += observation.count; }
          delta = mode === "Total" ? buy - sell : (buys ? buy / buys : 0) - (sells ? sell / sells : 0);
          high = Math.max(high, delta); low = Math.min(low, delta);
        }
        const open = calculation === "Bar delta" ? 0 : cumulative;
        const candle = { time, open, high: open + high, low: open + low, close: open + delta, volume: buy + sell };
        if (calculation === "Cumulative delta") cumulative += delta;
        return candle;
      });
      const actual = model.candles(expected, calculation, mode);
      assert.equal(actual.length, expected.length);
      for (let i = 0; i < actual.length; i++) for (const field of ["open", "high", "low", "close", "volume"] as const)
        assert.ok(Math.abs(actual[i][field] - expected[i][field]) <= 1e-10 * Math.max(1, Math.abs(expected[i][field])), `${symbol}/${timeframe}/${mode}/${calculation}/${i}/${field}`);
      checks.push({ timeframe, mode, calculation, bars: actual.length, expected, actual });
    }
  }
  report.push({ symbol, observations: source.ticks.length, prints: source.observations.reduce((n, t) => n + t.count, 0), verified: true, checks });
}
await writeFile("artifacts/volume-delta-live.json", JSON.stringify({ checkedAt: new Date().toISOString(), report,
  captures: Object.fromEntries([...sources].map(([symbol, source]) => [symbol, source.raw])) }, null, 2));
console.log(JSON.stringify(report.map(({ checks, ...rest }) => ({ ...rest, comparisons: checks.length, barCounts: [...new Set(checks.map(check => check.bars))] }))));
