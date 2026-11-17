import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import type { Tick } from "../types/trading";
import { footprints } from "../lib/orderflow/math";
import { defaultFootprint } from "../lib/orderflow/footprint";
import { footprintSizes } from "../lib/orderflow/footprintCells";
import { footprintModeRects, FOOTPRINT_MODES } from "../lib/orderflow/footprintModes";
const capture = JSON.parse(await readFile("artifacts/bubble-price-grid-live.json", "utf8"));
type Observation = { time: number; price: number; quantity: number; buy: boolean; count: number };
const sources: { symbol: string; rows: Observation[] }[] = [
  { symbol: "BTCUSDT", rows: capture.raw.binanceTrades.map((r: { T: number; p: string; q: string; m: boolean; f: number; l: number }) => ({ time: r.T, price: Number(r.p), quantity: Number(r.q), buy: !r.m, count: r.l - r.f + 1 })) },
  { symbol: "KRK:BTC/USD", rows: capture.raw.krakenTrades.result["BTC/USD"].map((r: unknown[]) => ({ time: Math.floor(Number(r[2]) * 1000), price: Number(r[0]), quantity: Number(r[1]), buy: r[3] === "b", count: 1 })) },
  { symbol: "HL:BTC", rows: capture.raw.hlTrades.map((r: { time: number; px: string; sz: string; side: string }) => ({ time: r.time, price: Number(r.px), quantity: Number(r.sz), buy: r.side === "B", count: 1 })) },
];
const results = [];
for (const source of sources) {
  const ticks: Tick[] = source.rows.map((r, i) => ({ id: String(i), symbol: source.symbol, time: r.time, price: r.price, quantity: r.quantity, side: r.buy ? "buy" : "sell", tradeCount: r.count, simulated: false }));
  const expected = new Map<string, { buy: number; sell: number; buys: number; sells: number }>();
  for (const r of source.rows) {
    const key = `${Math.floor(r.time / 60000) * 60000}:${Math.floor(r.price / 10) * 10}`;
    const row = expected.get(key) ?? { buy: 0, sell: 0, buys: 0, sells: 0 };
    row[r.buy ? "buy" : "sell"] += r.quantity; row[r.buy ? "buys" : "sells"] += r.count; expected.set(key, row);
  }
  let comparedRectSets = 0;
  for (const averageTradeSize of [false, true]) for (const bar of footprints(ticks, "1m", 10)) {
    const independent = bar.levels.map(r => {
      const row = expected.get(`${bar.time}:${r.price}`)!;
      return { buy: averageTradeSize ? row.buys ? row.buy / row.buys : 0 : row.buy, sell: averageTradeSize ? row.sells ? row.sell / row.sells : 0 : row.sell };
    });
    for (const mode of FOOTPRINT_MODES) for (const split of mode === "total" ? [false, true] : [true]) {
      const maximum = Math.max(...independent.map(r => mode === "total" ? r.buy + r.sell : mode === "delta" || mode === "absolute-delta" ? Math.abs(r.buy - r.sell) : Math.max(r.buy, r.sell)));
      bar.levels.forEach((row, i) => {
        const shape = footprintSizes(row, averageTradeSize), e = independent[i], expectedRects: number[][] = [];
        const emit = (x: number, width: number) => { if (width > 0) expectedRects.push([x, width]); };
        if (maximum > 0) {
          if (mode === "bid-ask-ladder") { if (e.sell > 0) emit(0, 50); if (e.buy > 0) emit(50, 50); }
          else if (mode === "bid-ask") { if (e.sell > 0) emit(50 - 50 * e.sell / maximum, 50 * e.sell / maximum); if (e.buy > 0) emit(50, 50 * e.buy / maximum); }
          else if (mode === "delta" || mode === "absolute-delta") {
            const delta = e.buy - e.sell, size = Math.abs(delta) / maximum * (mode === "delta" ? 50 : 100);
            emit(mode === "absolute-delta" ? 0 : delta < 0 ? 50 - size : 50, size);
          } else {
            const total = e.buy + e.sell, width = total / maximum * 100;
            if (total > 0 && split) { const sell = width * e.sell / total; emit(0, sell); emit(sell, width - sell); }
            else emit(0, width);
          }
        }
        const actual = footprintModeRects(mode, shape.buy ?? 0, shape.sell ?? 0, maximum, 50, 50, { ...defaultFootprint(), volumeSplit: split }, "#131722");
        assert.equal(actual.length, expectedRects.length);
        actual.forEach((rect, index) => { assert.ok(Math.abs(rect.x - expectedRects[index][0]) < 1e-9); assert.ok(Math.abs(rect.width - expectedRects[index][1]) < 1e-9); });
        comparedRectSets++;
      });
    }
  }
  results.push({ symbol: source.symbol, observations: source.rows.length, priceRows: expected.size, comparedRectSets });
}
const report = { checkedAt: new Date().toISOString(), sourceCapture: capture.checkedAt, results,
  scope: "Independent raw-tuple width/anchor oracle for all five modes, raw/average sizes and volume mono/split. Retained public capture, not a fresh network collection or direct Vela pixel comparison." };
await writeFile("artifacts/footprint-modes-source.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
