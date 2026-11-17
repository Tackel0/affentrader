import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { FootprintHistory } from "../lib/orderflow/footprintHistory";
import { footprintDisplayBar } from "../lib/orderflow/footprintCells";
import { defaultFootprint } from "../lib/orderflow/footprint";
import type { Tick } from "../types/trading";
const capture = JSON.parse(await readFile("artifacts/bubble-price-grid-live.json", "utf8"));
type Observation = { time: number; price: number; quantity: number; buy: boolean; count: number };
const sources: { symbol: string; rows: Observation[] }[] = [
  { symbol: "BTCUSDT", rows: capture.raw.binanceTrades.map((r: { T: number; p: string; q: string; m: boolean; f: number; l: number }) => ({ time: r.T, price: Number(r.p), quantity: Number(r.q), buy: !r.m, count: r.l - r.f + 1 })) },
  { symbol: "KRK:BTC/USD", rows: capture.raw.krakenTrades.result["BTC/USD"].map((r: unknown[]) => ({ time: Math.floor(Number(r[2]) * 1000), price: Number(r[0]), quantity: Number(r[1]), buy: r[3] === "b", count: 1 })) },
  { symbol: "HL:BTC", rows: capture.raw.hlTrades.map((r: { time: number; px: string; sz: string; side: string }) => ({ time: r.time, price: Number(r.px), quantity: Number(r.sz), buy: r.side === "B", count: 1 })) },
];
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) <= Math.max(1e-10, Math.abs(b) * 1e-10), `${a} != ${b}`);
const results = [];
for (const source of sources) {
  const history = new FootprintHistory("1m");
  const ticks: Tick[] = source.rows.map((row, i) => ({ id: String(i), symbol: source.symbol, time: row.time, price: row.price, quantity: row.quantity, side: row.buy ? "buy" : "sell", tradeCount: row.count, simulated: false }));
  history.add(ticks); history.add(ticks); // Archive/live overlap.
  const times = [...new Set(source.rows.map(row => Math.floor(row.time / 60000) * 60000))].sort((a, b) => a - b);
  const selections = [times, times.slice(0, Math.ceil(times.length / 2)), times.slice(Math.floor(times.length / 2)), times.filter((_, i) => i % 2 === 0), [], times.slice(-1)];
  let rowComparisons = 0, displayComparisons = 0;
  for (const step of [1, 5, 10, 20]) for (const selected of selections) {
    const set = new Set(selected), expected = new Map<number, { buy: number; sell: number; buys: number; sells: number }>();
    for (const row of source.rows) {
      if (!set.has(Math.floor(row.time / 60000) * 60000)) continue;
      const price = Math.floor(row.price / step) * step, value = expected.get(price) ?? { buy: 0, sell: 0, buys: 0, sells: 0 };
      value[row.buy ? "buy" : "sell"] += row.quantity; value[row.buy ? "buys" : "sells"] += row.count; expected.set(price, value);
    }
    const raw = history.readVisible({ step, ratio: 3 }, selected);
    if (!expected.size) { assert.equal(raw, null); continue; }
    assert.ok(raw); assert.equal(raw.levels.length, expected.size);
    for (const row of raw.levels) { const value = expected.get(row.price)!; assert.ok(value); close(row.buyVolume, value.buy); close(row.sellVolume, value.sell); assert.equal(row.buyCount ?? 0, value.buys); assert.equal(row.sellCount ?? 0, value.sells); rowComparisons++; }
    for (const average of [false, true]) for (const maximum of [0, .05]) {
      const plotted = footprintDisplayBar(raw, step, { ...defaultFootprint(), averageTradeSize: average, maxVolume: maximum });
      let max = -1, poc = NaN;
      for (const row of plotted.levels) {
        const value = expected.get(row.price)!, buy = average ? value.buys ? value.buy / value.buys : 0 : value.buy, sell = average ? value.sells ? value.sell / value.sells : 0 : value.sell;
        const hidden = maximum !== 0 && buy + sell > maximum;
        assert.equal(row.filtered === true, hidden);
        if (!hidden && buy + sell > max) { max = buy + sell; poc = row.price; }
        displayComparisons++;
      }
      if (Number.isNaN(poc)) assert.ok(Number.isNaN(plotted.poc)); else close(plotted.poc, poc);
    }
  }
  results.push({ symbol: source.symbol, executions: ticks.length, selections: selections.length, grids: 4, rowComparisons, displayComparisons });
}
const large = new FootprintHistory("1m"), count = 100000;
large.add(Array.from({ length: count }, (_, i): Tick => ({ id: String(i), symbol: "TIMING", time: i * 1000, price: 100 + i % 11, quantity: 1, side: i % 2 ? "buy" : "sell", simulated: true, tradeCount: 1 })));
for (let i = 0; i < 5; i++) large.read({ step: i + 1, ratio: 3 }, `fp${i + 1}`);
const selected = Array.from({ length: 1667 }, (_, i) => i * 60000), start = performance.now();
large.readVisible({ step: 1, ratio: 3 }, selected); const coldMs = performance.now() - start, warm = performance.now();
for (let i = 0; i < 100; i++) large.readVisible({ step: 1, ratio: 3 }, selected);
const report = { checkedAt: new Date().toISOString(), sourceCapture: capture.checkedAt, results, timing: { executions: count, fivePerBarGrids: true, coldAggregateMs: coldMs, cached100ReadsMs: performance.now() - warm }, scope: "Independent retained raw-tuple volume/count and aggregate-mean/filter/POC checks across visible subsets. Configuration-weighted comparisons, not fresh public-network data, complete history, Vela visual equality or full browser performance." };
await writeFile("artifacts/visible-footprint-source.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
