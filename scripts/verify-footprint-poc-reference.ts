import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "../types/trading";
import { defaultFootprint } from "../lib/orderflow/footprint";
import { createFootprintPocCache, paintFootprintPocExtensions } from "../lib/orderflow/footprintPoc";
const source = await readFile("artifacts/vela-footprint-reference/1-1mg-s23l974.js", "utf8"), sourceHash = createHash("sha256").update(source).digest("hex");
assert.equal(sourceHash, "b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b");
function block(start: number) { assert.ok(start >= 0); let end = source.indexOf("{", start) + 1, depth = 1; for (; depth && end < source.length; end++) { if (source[end] === "{") depth++; else if (source[end] === "}") depth--; } assert.equal(depth, 0); return source.slice(start, end); }
const selection = block(source.indexOf("function(e,t,i=!1){let r=new Map;for(let i of e)", 1140000));
const painter = block(source.indexOf("(t,r,n,o)=>{if(!r.poc.show||!r.poc.extend||n.x1>=h)return;", 1140000));
const touch = block(source.indexOf("function iM(", 1097000));
const reference = runInNewContext(`(()=>{${touch};return {select:${selection},paint:({ctx:e,bar,style,slot,candles:u,origin,yOf:a,tick,plotWidth:h,bounds,opacity,timeToX})=>{if(u.length<2)return;let i={coords:{timeToX}},s=new Map([[style,tick]]),g=bounds.top,y=g+bounds.height;e.globalAlpha=.62*opacity;(${painter})(bar,style,slot,origin)}}})()`, Object.create(null), { timeout: 1000 });
type Draw = { path: number[]; color: string; width: number; alpha: number };
function context(draws: Draw[]) { let path: number[] = []; return { strokeStyle: "", lineWidth: 1, globalAlpha: 1, save() {}, restore() {}, beginPath() { path = []; }, moveTo(...v: number[]) { path.push(...v); }, lineTo(...v: number[]) { path.push(...v); }, stroke() { draws.push({ path: [...path], color: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha }); } }; }
const patterns = [[1, 4, 10, 4, 1], [5, 5], [0, 3, 2, 0], [100, 20], [2, 3, 9]];
function profile(pattern: number[], step: number, time = 0, filter = false): FootprintBar { return { time, volume: pattern.reduce((a, b) => a + b, 0), delta: 0, poc: 100, levels: pattern.map((weight, index) => ({ price: (100 + index * 2) * step, upperPrice: (101 + index * 2) * step, buyVolume: weight, sellVolume: index % 2 ? weight / 2 : 0, buyCount: index === 0 ? 100 : weight > 0 ? 1 : 0, sellCount: index % 2 && weight > 0 ? 2 : 0, imbalance: null, filtered: filter && index % 2 === 0 })) }; }
let selectionCases = 0, selectionDifferences = 0, drawingCases = 0, drawingDifferences = 0, revisitCases = 0, revisitDifferences = 0;
const firstDifferences: unknown[] = [];
for (const pattern of patterns) for (const step of [1, 2, 10]) for (const average of [false, true]) for (const filter of [false, true]) {
  const bar = profile(pattern, step, 0, filter), lower = reference.select(bar.levels, step, average), expected = lower + step / 2;
  const candles = [{ time: 0, low: 0, high: 2000 }, { time: 60000, low: expected + .1, high: expected + 1 }, { time: 120000, low: expected, high: expected }];
  const actual = createFootprintPocCache().read([bar], candles, "1m", step, average)[0]; selectionCases++;
  if (actual?.price !== expected) { selectionDifferences++; if (firstDifferences.length < 2) firstDifferences.push({ kind: "selection", pattern, step, average, filter, expected, actual }); }
  for (const count of [1, 2, 3]) { const refs = createFootprintPocCache().read([bar], candles.slice(0, count), "1m", step, average), index = referenceTouch(candles.slice(0, count), expected); revisitCases++; if (refs[0]?.touched !== index) revisitDifferences++; }
}
function referenceTouch(candles: { time: number; low: number; high: number }[], price: number): number | null { const index = runInNewContext(`(${touch})(candles,0,price)`, { candles, price }, { timeout: 1000 }); return index < 0 ? null : candles[index].time; }
// The same prepared grid and actual slot are supplied to both painters. The
// cache still independently chooses the unfiltered raw/mean midpoint and touch.
for (const pattern of [patterns[0], patterns[3]]) for (const average of [false, true]) for (const count of [1, 2, 3]) for (const width of [.5, 10, 40, 200]) for (const x of [-200, 10, 250, 550]) for (const fraction of [-.1, 0, .5, 1, 1.1]) for (const stroke of [1, 4, 10]) for (const opacity of [.02, .4, 1]) for (const paneTop of [0, 80.5]) for (const extend of [false, true]) {
  const bar = profile(pattern, 1, 0, true), price = reference.select(bar.levels, 1, average) + .5;
  const candles = [{ time: 0, low: 99, high: 120 }, { time: 60000, low: price + .1, high: price + 1 }, { time: 120000, low: price, high: price }].slice(0, count);
  const yOf = (p: number) => paneTop + 160 * fraction + (price - p) * 10, timeToX = (t: number) => t === 0 ? x : 150 + t / 60000 * 100;
  const args = { bars: candles, coords: { width: 500, pxPerBar: () => 100, timeToX, priceToY: yOf }, bounds: { top: paneTop, height: 160 }, scale: {}, theme: { background: "#ffffff" } } as unknown as RendererLayerArgs;
  const style = { ...defaultFootprint(), averageTradeSize: average, pocVisible: true, pocExtend: extend, pocWidth: stroke, pocColor: "#334455cc" }, actual: Draw[] = [], expected: Draw[] = [];
  paintFootprintPocExtensions(context(actual) as unknown as CanvasRenderingContext2D, args, createFootprintPocCache().read([bar], candles, "1m", 1, average), style, { width, offset: 0, within: true, opacity });
  reference.paint({ ctx: context(expected), bar, style: { poc: { show: true, extend, width: stroke, color: style.pocColor }, avgTradeSize: average }, slot: { x0: x - width / 2, x1: x + width / 2 }, candles, origin: 0, yOf, tick: 1, plotWidth: 500, bounds: args.bounds, opacity, timeToX });
  drawingCases++; if (JSON.stringify(actual) !== JSON.stringify(expected)) { drawingDifferences++; if (firstDifferences.length < 5) firstDifferences.push({ kind: "drawing", pattern, average, count, width, x, fraction, stroke, opacity, paneTop, extend, expected, actual }); }
}
const report = { checkedAt: new Date().toISOString(), sourceHash, selectionCases, selectionDifferences, revisitCases, revisitDifferences, drawingCases, drawingDifferences, firstDifferences,
  scope: "Reviewed actual reference POC selector, later-inclusive touch helper and complete projection branch versus production cache/painter. Canonical merged integer grids, positive total and explicit underlying counts, ties/gaps/zero outer rows, raw/mean, display-filtered extrema, one/two/three loaded candles, thin/wide/offscreen slots, pane boundaries, stroke widths, fractional pane offsets, opacity and extension switch. Custom alpha color avoids conflating previously separate settings-parser/theme checks. No claim for missing-count/zero-weight source fallback, malformed/unmerged grids, decimal binary artifacts, slot packing, full-app pixels, cross-fade or populated multi-chart/recorded Replay." };
const baseline = process.argv.includes("--baseline"); await writeFile(`artifacts/footprint-poc-reference${baseline ? "-baseline" : ""}.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
if (!baseline) { assert.equal(selectionDifferences, 0); assert.equal(revisitDifferences, 0); assert.equal(drawingDifferences, 0); }
