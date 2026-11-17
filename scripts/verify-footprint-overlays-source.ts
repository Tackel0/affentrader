import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { FootprintHistory } from "../lib/orderflow/footprintHistory";
import { resolveFootprintOverlay, type FootprintOverlayChannel } from "../lib/orderflow/footprintOverlay";
import { createFootprintOverlayCache, paintFootprintOverlay } from "../lib/orderflow/footprintOverlayRenderer";
import { FOOTPRINT_MODES } from "../lib/orderflow/footprintModes";
import type { Tick } from "../types/trading";
import type { RendererLayerArgs } from "@luxalgo/vela";
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
  const history = new FootprintHistory("1m"), ticks: Tick[] = source.rows.map((row, i) => ({ id: String(i), symbol: source.symbol, time: row.time, price: row.price, quantity: row.quantity, side: row.buy ? "buy" : "sell", tradeCount: row.count, simulated: false }));
  history.add(ticks); history.add(ticks);
  const times = [...new Set(source.rows.map(row => Math.floor(row.time / 60000) * 60000))].sort((a, b) => a - b), low = Math.min(...source.rows.map(row => row.price));
  let rowComparisons = 0, configurations = 0;
  for (const kind of ["bar", "visible"] as const) for (const step of [10, 20, 50]) for (const mode of FOOTPRINT_MODES) for (const average of [false, true]) {
    const expected = new Map<number, Map<number, { buy: number; sell: number; buys: number; sells: number }>>();
    for (const row of source.rows) {
      const time = kind === "visible" ? times[0] : Math.floor(row.time / 60000) * 60000, price = Math.floor(row.price / step) * step;
      const rows = expected.get(time) ?? new Map(), value = rows.get(price) ?? { buy: 0, sell: 0, buys: 0, sells: 0 };
      value[row.buy ? "buy" : "sell"] += row.quantity; value[row.buy ? "buys" : "sells"] += row.count; rows.set(price, value); expected.set(time, rows);
    }
    const channel: FootprintOverlayChannel = { kind, id: "oracle", history, ...resolveFootprintOverlay(kind, { rowSize: step, volumeMode: mode, averageTradeSize: average }), message: "Partial retained observations", identity: { symbol: source.symbol, timeframe: "1m", live: true, through: null, revision: 0 } };
    const args = { priceStyle: "candles", bars: times.map(time => ({ time, open: low, high: low + 100, low, close: low, volume: 0 })), cursor: null, coords: { width: 1000, timeToX: (time: number) => 100 + times.indexOf(time) * 200, pxPerBar: () => 200, visibleLogicalRange: () => ({ from: 0, to: times.length - 1 }), priceToY: (price: number) => 300 - (price - low) / step * 20 }, bounds: { top: 0, height: 500 }, scale: { min: low - 100, max: low + 100 }, theme: { textColor: "#111", background: "#fff" } } as unknown as RendererLayerArgs;
    const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {}, fillRect() {}, fillText() {} } as unknown as CanvasRenderingContext2D;
    const result = paintFootprintOverlay(ctx, args, channel, createFootprintOverlayCache())!;
    assert.equal(result.bars.length, expected.size); assert.equal(args.priceStyle, "candles");
    for (const bar of result.bars) {
      const rows = expected.get(bar.time)!; assert.equal(bar.levels.length, rows.size);
      let best = -1, poc = NaN, total = 0, delta = 0;
      for (const level of bar.levels) {
        const value = rows.get(level.price)!; assert.ok(value); close(level.buyVolume, value.buy); close(level.sellVolume, value.sell); assert.equal(level.buyCount ?? 0, value.buys); assert.equal(level.sellCount ?? 0, value.sells);
        const size = average ? (value.buys ? value.buy / value.buys : 0) + (value.sells ? value.sell / value.sells : 0) : value.buy + value.sell;
        if (size > best) { best = size; poc = level.price; } total += value.buy + value.sell; delta += value.buy - value.sell; rowComparisons++;
      }
      close(bar.volume, total); close(bar.delta, delta); close(bar.poc, poc);
    }
    configurations++;
  }
  results.push({ symbol: source.symbol, executions: ticks.length, configurations, rowComparisons });
}
const report = { checkedAt: new Date().toISOString(), sourceCapture: capture.checkedAt, results, scope: "Independent retained raw-tuple volumes, underlying counts, raw/aggregate mean POC and totals through both overlay render paths over all five modes and three grids. Configuration-weighted comparisons. Synthetic observed-time candle slots; not full provider OHLCV, fresh network data, Vela pixel equality or complete history." };
await writeFile("artifacts/footprint-overlays-source.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
