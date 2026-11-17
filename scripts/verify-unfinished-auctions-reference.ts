import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "../types/trading";
import { defaultFootprint } from "../lib/orderflow/footprint";
import { createUnfinishedAuctionCache, paintUnfinishedAuctions, unfinishedAuctionRows } from "../lib/orderflow/unfinishedAuctions";
const source = await readFile("artifacts/vela-footprint-reference/1-1mg-s23l974.js", "utf8"), sourceHash = createHash("sha256").update(source).digest("hex");
assert.equal(sourceHash, "b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b");
function block(start: number) { assert.ok(start >= 0); let end = source.indexOf("{", start) + 1, depth = 1; for (; depth && end < source.length; end++) { if (source[end] === "{") depth++; else if (source[end] === "}") depth--; } assert.equal(depth, 0); return source.slice(start, end); }
const helpers = ["tS", "tk", "iM"].map(name => block(source.indexOf(`function ${name}(`, 1097000))).join("\n");
const classify = block(source.indexOf("function(e,t,i){if(0===e.length)return null;", 1139000));
const painter = block(source.indexOf("(t,r,n,o)=>{if(!r.unfinished.show)return;", 1139000));
const reference = runInNewContext(`(()=>{${helpers};return {classify:${classify},paint:({ctx:e,bar,style,slot,candles:u,origin,yOf:a,tick,plotWidth:h,bounds,opacity})=>{let i={coords:{timeToX:t=>50+t/60000*100}},s=new Map([[style,tick]]),g=bounds.top,y=g+bounds.height,v=e=>e.levels;e.globalAlpha=opacity;(${painter})(bar,style,slot,origin)}}})()`, Object.create(null), { timeout: 1000 });
type Draw = { kind: string; values: number[]; color: string; width: number; alpha: number };
function context(draws: Draw[]) { let path: number[] = []; return { strokeStyle: "", globalAlpha: 1, lineWidth: 1, save() {}, restore() {}, beginPath() { path = []; }, moveTo(...v: number[]) { path.push(...v); }, lineTo(...v: number[]) { path.push(...v); }, stroke() { draws.push({ kind: "line", values: [...path], color: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha }); }, strokeRect(...values: number[]) { draws.push({ kind: "box", values, color: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha }); } }; }
let classificationCases = 0, classificationDifferences = 0, drawingCases = 0, drawingDifferences = 0;
const firstDifferences: unknown[] = [];
const row = (price: number, buyVolume: number, sellVolume: number) => ({ price, upperPrice: price + 1, buyVolume, sellVolume, imbalance: null });
for (const buy of [0, .0001, .0049, .005, .01, .1, 1, 2, 1000]) for (const sell of [0, .0001, .0049, .005, .01, .1, 1, 2, 1000]) for (const minimum of [0, .001, .005, .01, 1, 2]) for (const shape of [0, 1, 2, 3]) {
  const levels = shape === 0 ? [] : shape === 1 ? [row(100, buy, sell)] : shape === 2 ? [row(100, buy, sell), row(102, sell, buy)] : [row(102, sell, buy), row(101, 100, 100), row(100, buy, sell)];
  const bar: FootprintBar = { time: 0, levels, volume: 0, delta: 0, poc: 100 }, actual = unfinishedAuctionRows(bar, 1, minimum);
  const flags = reference.classify(levels, 1, minimum), expected = flags ? [flags.high ? ["high", flags.highPrice] : null, flags.low ? ["low", flags.lowPrice] : null].filter(Boolean) : [];
  const result = actual.map(r => [r.side, r.price]); classificationCases++;
  if (JSON.stringify(result) !== JSON.stringify(expected)) { classificationDifferences++; if (firstDifferences.length < 2) firstDifferences.push({ kind: "flags", buy, sell, minimum, shape, expected, actual: result }); }
}
for (const prices of [[100], [100, 102]]) for (const width of [.5, 1, 4, 10, 40, 100]) for (const height of [.5, 1, 2, 5, 20]) for (const stroke of [1, 2, 4, 10]) for (const opacity of [.02, .4, 1]) for (const x of [-30, 50, 490, 550]) for (const extend of [false, true]) for (const revisit of [false, true]) for (const paneTop of [0, 80.5]) {
  const levels = prices.map(p => row(p, 2, 3)), bar: FootprintBar = { time: 0, levels, volume: 5 * prices.length, delta: -prices.length, poc: 100 };
  const candles = [{ time: 0, low: 100, high: 103 }, { time: 60000, low: 104, high: 105 }, { time: 120000, low: revisit ? 100 : 104, high: 105 }];
  const yOf = (price: number) => paneTop + 100 + (101 - price) * height;
  const args = { coords: { width: 500, pxPerBar: () => 100, timeToX: (time: number) => time === 0 ? x : 50 + time / 60000 * 100, priceToY: yOf }, bounds: { top: paneTop, height: 160 }, scale: {} } as unknown as RendererLayerArgs;
  const style = { ...defaultFootprint(), unfinishedVisible: true, unfinishedWidth: stroke, unfinishedExtend: extend, unfinishedHighColor: "#ff112280", unfinishedLowColor: "#22ccdd" }, actual: Draw[] = [], expected: Draw[] = [];
  paintUnfinishedAuctions(context(actual) as unknown as CanvasRenderingContext2D, args, createUnfinishedAuctionCache().read([bar], candles, "1m", 1, 0), style, { width, offset: 0, within: true, opacity });
  // The outer reference loop omits origins whose complete slot starts past the plot.
  if (x - width / 2 <= 500) reference.paint({ ctx: context(expected), bar, style: { unfinished: { show: true, width: stroke, extend, minVolume: 0, highColor: style.unfinishedHighColor, lowColor: style.unfinishedLowColor } }, slot: { x0: x - width / 2, x1: x + width / 2 }, candles, origin: 0, yOf, tick: 1, plotWidth: 500, bounds: args.bounds, opacity });
  drawingCases++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) { drawingDifferences++; if (firstDifferences.length < 5) firstDifferences.push({ kind: "drawing", prices, width, height, stroke, opacity, x, extend, revisit, paneTop, expected, actual }); }
}
const report = { checkedAt: new Date().toISOString(), sourceHash, classificationCases, classificationDifferences, drawingCases, drawingDifferences, firstDifferences,
  scope: "Reviewed actual reference classifier and complete unfinished-auction overlay branch against production classification/cache/painter. Raw merged rows, dust/thresholds, sorted/unsorted extrema, single-row dual marks; ordinary axes, thin/tall cells, line widths, opacity, offscreen origins, ray switch, inclusive revisit and fractional pane offsets. No full app pixel, inverted-axis reference or complete source/history equivalence claim." };
const baseline = process.argv.includes("--baseline"); await writeFile(`artifacts/unfinished-auctions-reference${baseline ? "-baseline" : ""}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report)); if (!baseline) { assert.equal(classificationDifferences, 0); assert.equal(drawingDifferences, 0); }
