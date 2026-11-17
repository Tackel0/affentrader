import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { FootprintHistory } from "../lib/orderflow/footprintHistory";
import type { Tick } from "../types/trading";
const capture = JSON.parse(await readFile("artifacts/bubble-price-grid-live.json", "utf8"));
type Observation = { time: number; price: number; quantity: number; buy: boolean; count: number };
const sources: { symbol: string; rows: Observation[] }[] = [
  { symbol: "BTCUSDT", rows: capture.raw.binanceTrades.map((r: { T: number; p: string; q: string; m: boolean; f: number; l: number }) => ({ time: r.T, price: Number(r.p), quantity: Number(r.q), buy: !r.m, count: r.l - r.f + 1 })) },
  { symbol: "KRK:BTC/USD", rows: capture.raw.krakenTrades.result["BTC/USD"].map((r: unknown[]) => ({ time: Math.floor(Number(r[2]) * 1000), price: Number(r[0]), quantity: Number(r[1]), buy: r[3] === "b", count: 1 })) },
  { symbol: "HL:BTC", rows: capture.raw.hlTrades.map((r: { time: number; px: string; sz: string; side: string }) => ({ time: r.time, price: Number(r.px), quantity: Number(r.sz), buy: r.side === "B", count: 1 })) },
];
const steps = [10, 20, 30, 50, 100], results = [];
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-10, Math.abs(expected) * 1e-10), `${actual} != ${expected}`);
for (const source of sources) {
  const ticks: Tick[] = source.rows.map((r, i) => ({ id: String(i), symbol: source.symbol, time: r.time, price: r.price, quantity: r.quantity, side: r.buy ? "buy" : "sell", tradeCount: r.count, simulated: false }));
  const history = new FootprintHistory("1m"), split = Math.floor(ticks.length * .7);
  history.add(ticks.slice(0, split));
  steps.forEach((step, i) => history.read({ step, ratio: 3 }, `fp${i + 1}`));
  for (const tick of ticks.slice(split)) history.add([tick]);
  history.add(ticks); // Archive/live overlap must not multiply any instance's volume.
  let comparedRows = 0;
  for (const [index, step] of steps.entries()) {
    const expected = new Map<number, Map<number, { buy: number; sell: number; buys: number; sells: number }>>();
    for (const raw of source.rows) {
      const time = Math.floor(raw.time / 60000) * 60000, price = Math.floor(raw.price / step) * step;
      const rows = expected.get(time) ?? new Map(), row = rows.get(price) ?? { buy: 0, sell: 0, buys: 0, sells: 0 };
      row[raw.buy ? "buy" : "sell"] += raw.quantity; row[raw.buy ? "buys" : "sells"] += raw.count;
      rows.set(price, row); expected.set(time, rows);
    }
    const bars = history.read({ step, ratio: 3 }, `fp${index + 1}`); assert.equal(bars.length, expected.size);
    for (const bar of bars) {
      const rows = expected.get(bar.time)!; assert.equal(bar.levels.length, rows.size);
      let volume = 0, delta = 0;
      for (const actual of bar.levels) {
        const row = rows.get(actual.price)!; assert.ok(row);
        close(actual.buyVolume, row.buy); close(actual.sellVolume, row.sell);
        assert.equal(actual.buyCount ?? 0, row.buys); assert.equal(actual.sellCount ?? 0, row.sells);
        volume += row.buy + row.sell; delta += row.buy - row.sell; comparedRows++;
      }
      close(bar.volume, volume); close(bar.delta, delta);
    }
  }
  assert.equal(history.coverage.trades, ticks.length);
  const unchanged = history.read({ step: 10, ratio: 3 }, "fp1");
  history.read({ step: 200, ratio: 5 }, "fp5"); assert.equal(history.read({ step: 10, ratio: 3 }, "fp1"), unchanged);
  results.push({ symbol: source.symbol, executions: ticks.length, independentGrids: 5, comparedRows });
}
const large = new FootprintHistory("1m"), count = 100000;
large.add(Array.from({ length: count }, (_, i): Tick => ({ id: String(i), symbol: "PERFORMANCE-FIXTURE", time: i * 1000, price: 100 + i % 11, quantity: 1, side: i % 2 ? "buy" : "sell", simulated: true, tradeCount: 1 })));
const began = performance.now(); steps.forEach((step, i) => large.read({ step: step / 10, ratio: 3 }, `fp${i + 1}`));
const coldMs = performance.now() - began, warmStart = performance.now();
for (let n = 0; n < 100; n++) steps.forEach((step, i) => large.read({ step: step / 10, ratio: 3 }, `fp${i + 1}`));
const report = { checkedAt: new Date().toISOString(), sourceCapture: capture.checkedAt, results,
  modelTiming: { syntheticExecutions: count, coldFiveGridsMs: coldMs, cachedFiveGrids100ReadsMs: performance.now() - warmStart },
  scope: "Independent raw-tuple volume/count oracle for five simultaneous grids, incremental delivery, duplicate overlap and isolated regrid caches. Retained public capture, not fresh network data or Vela pixel equality. Timing covers the model only, not full browser rendering." };
await writeFile("artifacts/footprint-instances-source.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
