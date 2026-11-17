import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "../types/trading";
import { defaultFootprint } from "../lib/orderflow/footprint";
import { footprintDisplayBar } from "../lib/orderflow/footprintCells";
import { footprintRows } from "../lib/orderflow/math";
import { createFootprintStackedZoneCache, paintFootprintStackedZones } from "../lib/orderflow/footprintStackedZones";
const source = await readFile("artifacts/vela-footprint-reference/1-1mg-s23l974.js", "utf8"), sourceHash = createHash("sha256").update(source).digest("hex");
assert.equal(sourceHash, "b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b");
function block(start: number) { assert.ok(start >= 0); let end = source.indexOf("{", start) + 1, depth = 1; for (; depth && end < source.length; end++) { if (source[end] === "{") depth++; else if (source[end] === "}") depth--; } assert.equal(depth, 0); return source.slice(start, end); }
const prepare = block(source.indexOf("function tz(", 1097000)), filter = block(source.indexOf("function tV(", 1097000));
const runs = block(source.indexOf('function(e,t,i){let r=[],n=Math.max(2,Math.round(i));for(let i of["ask","bid"])', 1138000));
const overlap = block(source.indexOf("function(e,t,i,r){for(let n=t+1;n<e.length;n+=1)", 1138000));
const painter = block(source.indexOf("(t,r,n,o)=>{if(!r.imbalance.stacked||n.x1>=h)return;", 1138000));
const reference = runInNewContext(`(()=>{${filter};${prepare};return {zones:(bar,tick,style,candles)=>(${runs})(tz(bar.levels,tick,style).rows,tick,style.imbalance.stackCount).map(z=>{let index=(${overlap})(candles,0,z.priceLow,z.priceHigh);return [z.side==='ask'?'buy':'sell',z.priceLow,z.priceHigh,(z.priceHigh-z.priceLow)/tick,index<0?null:candles[index].time]}),paint:({ctx:e,bar,style,slot,candles:u,yOf:a,tick,plotWidth:h,bounds,opacity,timeToX})=>{let i={coords:{timeToX}},s=new Map([[style,tick]]),g=bounds.top,y=g+bounds.height,v=e=>e.levels;e.globalAlpha=opacity;(${painter})(bar,style,slot,0)}}})()`, Object.create(null), { timeout: 1000 });
type Draw = { rect: number[]; color: string; alpha: number };
function context(draws: Draw[]) { return { fillStyle: "", globalAlpha: 1, save() {}, restore() {}, fillRect(...rect: number[]) { draws.push({ rect, color: this.fillStyle, alpha: this.globalAlpha }); } }; }
let seed = 0x51ac7ed; const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296), pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];
const patterns = ["buy", "sell", "both", "gaps", "alternating", "zero-opposite"] as const;
let zoneCases = 0, zoneDifferences = 0, drawingCases = 0, drawingDifferences = 0, positiveZoneCases = 0, positiveDrawingCases = 0, boundaryTouches = 0, interiorTouches = 0;
const firstDifferences: unknown[] = [];
for (let caseIndex = 0; caseIndex < 12000; caseIndex++) {
  const pattern = pick(patterns), count = pick([3, 4, 6, 12, 41]), step = pick([1, 2, 10]), ratio = pick([1, 3, 10]), minimum = pick([2, 3, 4, 10, 40]), average = pick([false, true]), filterKind = pick([0, 1, 2, 3, 4]);
  const levels = Array.from({ length: count }, (_, index) => {
    const price = (100 + index + (pattern === "gaps" && index >= count / 2 ? 2 : 0)) * step;
    const buyVolume = pattern === "sell" ? 1 : pattern === "alternating" ? index % 2 ? 100 : 1 : pattern === "zero-opposite" ? index ? 10 : 0 : pattern === "both" ? 10 : index ? 100 : 1;
    const sellVolume = pattern === "sell" ? index === count - 1 ? 1 : 100 : pattern === "alternating" ? index % 2 ? 1 : 100 : pattern === "zero-opposite" ? 0 : pattern === "both" ? 10 : 1;
    return { price, upperPrice: price + step, rowIndex: price / step, buyVolume, sellVolume, buyCount: buyVolume > 0 ? pick([1, 2, 100]) : 0, sellCount: sellVolume > 0 ? pick([1, 2, 100]) : 0, imbalance: null };
  });
  const bar: FootprintBar = { time: 0, levels, poc: levels[0].price, volume: levels.reduce((s, r) => s + r.buyVolume + r.sellVolume, 0), delta: 0 };
  const filters = filterKind === 1 ? { maxVolume: 12 } : filterKind === 2 ? { minVolume: 10 } : filterKind === 3 ? { maxBidVolume: 1 } : filterKind === 4 ? { minAskVolume: 2 } : {};
  const style = { ...defaultFootprint(), stackedVisible: true, stackedRows: minimum, stackedBuyColor: "#11223366", stackedSellColor: "rgba(22,44,66,0.4)", averageTradeSize: average, imbalanceRatio: ratio, ...filters };
  const refStyle = { avgTradeSize: average, filter: { minVolume: filters.minVolume ?? null, maxVolume: filters.maxVolume ?? null, minBidVolume: null, maxBidVolume: filters.maxBidVolume ?? null, minAskVolume: filters.minAskVolume ?? null, maxAskVolume: null }, valueArea: { show: false }, poc: { show: false }, imbalance: { stacked: true, ratio: ratio * 100, stackCount: minimum, stackAskColor: style.stackedBuyColor, stackBidColor: style.stackedSellColor } };
  const candidates = reference.zones(bar, step, refStyle, [{ time: 0, low: 0, high: 2000 }]);
  const focus = candidates[0], touchKind = pick(["none", "boundary", "interior"]), low = focus ? focus[1] : 100 * step, high = focus ? focus[2] : 103 * step;
  const contact = touchKind === "boundary" ? { low: high, high: high + step } : touchKind === "interior" ? { low: low + step / 2, high: high - step / 2 } : { low: high + step, high: high + 2 * step };
  const candles = [{ time: 0, low: 0, high: 2000 }, { time: 60000, low: high + step, high: high + step * 2 }, { time: 120000, ...contact }];
  // Production history already supplies raw diagonal flags. The display pass
  // deliberately reuses them when neither means nor filters change the rows.
  const classified = footprintRows(bar.time, new Map(bar.levels.map(row => [row.price / step, row])), ratio);
  const displayed = footprintDisplayBar(classified, step, style), actualZones = createFootprintStackedZoneCache().read([displayed], candles, "1m", step, minimum), expectedZones = reference.zones(bar, step, refStyle, candles);
  const actualValues = actualZones.map(z => [z.side, z.lower, z.upper, z.rows, z.touched]); zoneCases++;
  if (actualZones.length) { positiveZoneCases++; if (touchKind === "boundary") boundaryTouches++; if (touchKind === "interior") interiorTouches++; }
  if (JSON.stringify(actualValues) !== JSON.stringify(expectedZones)) { zoneDifferences++; if (firstDifferences.length < 3) firstDifferences.push({ kind: "zones", caseIndex, pattern, count, step, ratio, minimum, average, filterKind, expected: expectedZones, actual: actualValues }); }
  const width = pick([.5, 10, 40, 200]), x = pick([-200, -10, 100, 490, 700]), paneTop = pick([0, 80.5]), opacity = pick([.02, .4, 1]), inverted = pick([false, true]), slope = pick([.5, 2, 10, 40]), top = pick([-100, 0, 80, 160, 300]);
  const yOf = (p: number) => paneTop + top + (inverted ? p - low : high - p) * slope / step, timeToX = (t: number) => t === 0 ? x : 150 + t / 60000 * 100;
  const args = { bars: candles, coords: { width: 600, pxPerBar: () => 100, timeToX, priceToY: yOf }, scale: {}, bounds: { top: paneTop, height: 160 } } as unknown as RendererLayerArgs;
  const actual: Draw[] = [], expected: Draw[] = [];
  paintFootprintStackedZones(context(actual) as unknown as CanvasRenderingContext2D, args, actualZones, style, { width, offset: 0, within: true, opacity });
  reference.paint({ ctx: context(expected), bar, style: refStyle, slot: { x0: x - width / 2, x1: x + width / 2 }, candles, yOf, tick: step, plotWidth: 600, bounds: args.bounds, opacity, timeToX });
  drawingCases++; if (actual.length) positiveDrawingCases++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) { drawingDifferences++; if (firstDifferences.length < 6) firstDifferences.push({ kind: "drawing", caseIndex, width, x, paneTop, opacity, inverted, slope, top, expected, actual }); }
}
assert.ok(positiveZoneCases > 1000 && positiveDrawingCases > 300 && boundaryTouches > 100 && interiorTouches > 100);
const report = { checkedAt: new Date().toISOString(), sourceHash, seed: "0x51ac7ed", zoneCases, zoneDifferences, drawingCases, drawingDifferences, positiveZoneCases, positiveDrawingCases, boundaryTouches, interiorTouches, firstDifferences,
  scope: "12000 reproducible complete cases: actual reviewed reference raw/mean/filter/diagonal preparation, run extraction, inclusive later-overlap helper and complete stacked-zone painter versus production display/cache/index/painter. Explicit counts, contiguous/gapped/zero-opposite data, ratios1/3/10, minimum2/3/4/10/40, canonical integer grids, boundary/interior/no touches, thin/wide/offscreen lanes, both axes, clipping, alpha and fractional pane offsets. Same actual slot supplied; no slot-packing, missing-count fallback, decimal binary artifacts, complete-app pixel, browser-capacity, multi-chart or recorded Replay claim." };
const baseline = process.argv.includes("--baseline"); await writeFile(`artifacts/footprint-stacked-zones-reference${baseline ? "-baseline" : ""}.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
if (!baseline) { assert.equal(zoneDifferences, 0); assert.equal(drawingDifferences, 0); }
