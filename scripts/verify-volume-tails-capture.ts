import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import type { Tick } from "../types/trading";
import { parseKrakenTrade } from "../lib/market/kraken";
import { buildVolumeTails, resolveTails } from "../lib/orderflow/volumeTails";

// Reuse the retained public capture; do not claim these are newly captured ticks.
const capture = JSON.parse(await readFile("artifacts/volume-delta-live.json", "utf8"));
const report = [];
for (const [symbol, records] of Object.entries(capture.captures) as Array<[string, Array<Record<string, unknown>>]>) {
  const oracle = records.map(raw => ({ price: Number(raw.p ?? raw.price), quantity: Number(raw.q ?? raw.qty), buy: symbol === "BTCUSDT" ? !raw.m : raw.side === "buy" }));
  const ticks = records.map(raw => symbol === "BTCUSDT" ? { id: `${symbol}-${raw.a}`, symbol, time: raw.T, price: Number(raw.p), quantity: Number(raw.q),
    side: raw.m ? "sell" : "buy", simulated: false } as Tick : parseKrakenTrade(raw)!);
  const low = Math.min(...oracle.map(t => t.price)), high = Math.max(...oracle.map(t => t.price)); assert.ok(high > low);
  // Independent exact integer bin assignment for the captured BTC quote decimals.
  const scale = 100_000_000, lower = BigInt(Math.round(low * scale)), upper = BigInt(Math.round(high * scale));
  const results = [];
  for (const resolution of [2, 50, 137]) for (const threshold of [10, 50, 90]) {
    const bins = Array.from({ length: resolution }, () => ({ buy: 0, sell: 0 }));
    for (const trade of oracle) {
      const p = BigInt(Math.round(trade.price * scale)); assert.ok(Math.abs(Number(p) / scale - trade.price) < 1e-9);
      const index = Math.min(resolution - 1, Number((p - lower) * BigInt(resolution) / (upper - lower)));
      bins[index][trade.buy ? "buy" : "sell"] += trade.quantity;
    }
    const total = oracle.reduce((sum, t) => sum + t.quantity, 0), target = total * threshold / 100;
    const edge = (index: number) => low + (high - low) * index / resolution;
    const tail = (supply: boolean) => {
      const indices = Array.from({ length: resolution }, (_, i) => supply ? resolution - 1 - i : i);
      if (!bins.some(b => (supply ? b.sell : b.buy) > 0)) return null;
      let quantity = 0, numerator = 0, final = 0, count = 0;
      for (const i of indices) {
        const amount = supply ? bins[i].sell : bins[i].buy;
        quantity += amount; numerator += amount * (edge(i) + edge(i + 1)) / 2; final = i; count++;
        if (quantity >= target) break;
      }
      const min = supply ? edge(final) : low, max = supply ? high : edge(final + 1);
      return { low: min, high: max, average: (min + max) / 2, weighted: numerator / quantity, volume: quantity, reached: quantity >= target, bins: count };
    };
    const expected = { supply: tail(true), demand: tail(false), total, target }, actual = buildVolumeTails(ticks, resolveTails({ resolution, threshold }))!;
    const close = (a: number, b: number) => assert.ok(Math.abs(a - b) <= Math.max(1e-10, Math.abs(b) * 1e-12), `${symbol}: ${a} != ${b}`);
    close(actual.total, total); close(actual.target, target);
    for (const side of ["supply", "demand"] as const) {
      const e = expected[side], a = actual[side];
      if (!e) assert.equal(a, null);
      else {
        assert.ok(a); assert.equal(a.bins, e.bins); assert.equal(a.reached, e.reached);
        for (const field of ["low", "high", "average", "weighted", "volume"] as const) close(a[field], e[field]);
      }
    }
    results.push({ resolution, threshold, expected, actual });
  }
  report.push({ symbol, observations: records.length, distinctPrices: new Set(oracle.map(t => t.price)).size, verified: true, results });
}
await writeFile("artifacts/volume-tails-capture.json", JSON.stringify({ checkedAt: new Date().toISOString(), sourceCapturedAt: capture.checkedAt, report }, null, 2));
console.log(JSON.stringify(report.map(({ results, ...rest }) => ({ ...rest, comparisons: results.length }))));
