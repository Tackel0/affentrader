import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "../types/trading";
import { defaultFootprint } from "../lib/orderflow/footprint";
import { FOOTPRINT_STAT_TOGGLES, footprintStatistics, paintFootprintStatistics } from "../lib/orderflow/footprintStatistics";
const source = await readFile("artifacts/vela-footprint-reference/1-1mg-s23l974.js", "utf8"), sourceHash = createHash("sha256").update(source).digest("hex");
assert.equal(sourceHash, "b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b");
function block(name: string) { const start = source.indexOf(`function ${name}(`, 1090000); assert.ok(start >= 0); let end = source.indexOf("{", start) + 1, depth = 1; for (; depth && end < source.length; end++) { if (source[end] === "{") depth++; else if (source[end] === "}") depth--; } assert.equal(depth, 0); return source.slice(start, end); }
const labelsStart = source.indexOf("var iT={", 1120000), labelsEnd = source.indexOf(";function iN", labelsStart); assert.ok(labelsStart >= 0 && labelsEnd > labelsStart);
const reference = runInNewContext(`${source.slice(labelsStart, labelsEnd)};\n${["tw", "tS", "tA", "iN", "iI", "iP"].map(block).join("\n")}\niP`, Object.create(null), { timeout: 1000 });
type Draw = { kind: string; values: Array<number | string>; color: string; alpha: number; font?: string; align?: string };
function context(draws: Draw[]) {
  return { fillStyle: "", globalAlpha: 1, font: "", textAlign: "", textBaseline: "", save() {}, restore() {}, beginPath() {}, fill() {},
    roundRect(...values: number[]) { draws.push({ kind: "roundRect", values, color: this.fillStyle, alpha: this.globalAlpha }); },
    measureText(text: string) { return { width: [...text].reduce((n, c) => n + (c === '1' ? .35 : c === ' ' ? .3 : .6), 0) * parseFloat(this.font.replace(/^bold /, "")) }; },
    fillText(text: string, x: number, y: number) { draws.push({ kind: "text", values: [text, x, y], color: this.fillStyle, alpha: this.globalAlpha, font: this.font, align: this.textAlign }); } };
}
const items = ["totalVolume", "buy", "sell", "buyPct", "sellPct", "delta", "deltaPct", "tradeCount", "bidCount", "askCount"], theme = { background: "#000000", fontFamily: "Arial", upColor: "#112233", downColor: "#445566" };
let comparisons = 0;
for (let mask = 0; mask < 1024; mask++) for (const [buyVolume, sellVolume] of [[12345, 1234], [.123456, 12345], [0, 0]]) for (const width of [22, 40.5, 200, 400.25]) for (const position of ["above", "below"] as const) for (const size of [6, 8, 24]) for (const opacity of [.6, 1]) {
  const bar: FootprintBar = { time: 0, volume: buyVolume + sellVolume, delta: buyVolume - sellVolume, poc: 100, levels: [{ price: 100, upperPrice: 101, buyVolume, sellVolume, buyCount: 12345, sellCount: 1234, imbalance: null }] };
  const flags = Object.fromEntries(FOOTPRINT_STAT_TOGGLES.map((key, i) => [key, !!(mask & 1 << i)]));
  const style = { ...defaultFootprint(), ...flags, statisticsVisible: true, statisticsPosition: position, statisticsSize: size, statisticsColor: "#778899", statisticsBackground: "#12345680", buyColor: "#abcdef", sellColor: "#fedcba" };
  const stats = footprintStatistics(bar), actual: Draw[] = [], expected: Draw[] = [], center = 250.17;
  const args = { coords: { priceToY: (p: number) => (110 - p) * 20 }, bounds: { top: -1000, height: 3000 }, scale: {}, theme } as unknown as RendererLayerArgs;
  paintFootprintStatistics(context(actual) as unknown as CanvasRenderingContext2D, args, bar, 1, style, center, width, opacity);
  if ((center + width / 2) - (center - width / 2) >= 22) reference(context(expected), center - width / 2, center + width / 2, 180, 200, { buy: stats.buy, sell: stats.sell, delta: stats.delta, buyN: stats.buyCount, sellN: stats.sellCount },
    { stats: { show: true, items: items.filter((_, i) => mask & 1 << i), position, sizePx: size, color: style.statisticsColor, background: style.statisticsBackground } }, theme, opacity);
  assert.deepEqual(actual, expected); comparisons++;
}
const report = { checkedAt: new Date().toISOString(), sourceHash, comparisons, scope: "Actual reviewed statistics painter versus production painter: 1024 toggle combinations, large/fractional/zero volumes, known underlying counts, signed/zero delta, 4 lane widths, 3 font sizes, above/below placement, 2 reveal opacities, proportional glyph metrics and distinct theme-versus-candle palettes. Unknown combined counts deliberately remain unavailable in the app; no partial-known reference fallback or full browser pixel equivalence claim." };
await writeFile("artifacts/footprint-statistics-style-reference.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
