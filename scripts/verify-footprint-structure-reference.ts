import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { defaultFootprint } from "../lib/orderflow/footprint";
import { paintFootprintStructure } from "../lib/orderflow/footprintStructure";
const source = await readFile("artifacts/vela-footprint-reference/1-1mg-s23l974.js", "utf8"), sourceHash = createHash("sha256").update(source).digest("hex");
assert.equal(sourceHash, "b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b");
function block(start: number) { assert.ok(start >= 0); let end = source.indexOf("{", start) + 1, depth = 1; for (; depth && end < source.length; end++) { if (source[end] === "{") depth++; else if (source[end] === "}") depth--; } assert.equal(depth, 0); return source.slice(start, end); }
const painter = block(source.indexOf("function(e){let{ctx:t,slot:i,bar:r,style:n,geom:a,opacity:s}=e,o=t_(i);", 1114000));
const reference = runInNewContext(`${["t_", "tk", "i_"].map(name => block(source.indexOf(`function ${name}(`, 1097000))).join("\n")}\n(${painter})`, Object.create(null), { timeout: 1000 });
type Draw = { kind: string; values: number[]; color: string; width?: number; alpha: number };
function context(draws: Draw[]) { let path: number[] = []; return { fillStyle: "", strokeStyle: "", globalAlpha: 1, lineWidth: 1, beginPath() { path = []; }, moveTo(x: number, y: number) { path.push(x, y); }, lineTo(x: number, y: number) { path.push(x, y); }, stroke() { draws.push({ kind: "line", values: path, color: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha }); }, fillRect(...values: number[]) { draws.push({ kind: "fill", values, color: this.fillStyle, alpha: this.globalAlpha }); }, strokeRect(...values: number[]) { draws.push({ kind: "poc", values, color: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha }); } }; }
let comparisons = 0;
for (const prices of [[100], [100, 101, 104]]) for (const percent of [1, 70, 100]) for (const width of [8, 9.99, 10, 20, 80]) for (const slope of [.5, 1, 2, 20, 60]) for (const stroke of [1, 4, 10]) for (const opacity of [.02, .4, 1]) for (const va of [false, true]) for (const poc of [false, true]) {
  const levels = prices.map(price => ({ price, upperPrice: price + 1, buyVolume: price === 100 ? 100 : 1, sellVolume: 0, imbalance: null }));
  const bar = { time: 0, volume: 100 + prices.length - 1, delta: 100 + prices.length - 1, poc: 100, levels };
  const yOf = (p: number) => (120 - p) * slope, actual: Draw[] = [], expected: Draw[] = [], left = 100, right = left + width;
  const style = { ...defaultFootprint(), valueAreaVisible: va, valueAreaPercent: percent, valueAreaBackground: "#11223340", valueAreaColor: "#445566", valueAreaWidth: stroke, pocVisible: poc, pocColor: "#77889980", pocWidth: stroke };
  const args = { coords: { priceToY: yOf }, scale: {}, bounds: { top: 0, height: 1e5 }, theme: { background: "#000000" } } as unknown as RendererLayerArgs;
  paintFootprintStructure(context(actual) as unknown as CanvasRenderingContext2D, args, bar, 1, style, left, right, opacity);
  reference({ ctx: context(expected), slot: { x0: left, x1: right }, bar: { valPrice: 100, vahPrice: percent === 100 ? prices.at(-1)! + 1 : 101, pocPrice: 100 },
    style: { valueArea: { show: va, color: style.valueAreaColor, background: style.valueAreaBackground, width: stroke }, poc: { show: poc, color: style.pocColor, width: stroke } }, geom: { yOf, tick: 1 }, opacity });
  assert.deepEqual(actual, expected); comparisons++;
}
const report = { checkedAt: new Date().toISOString(), sourceHash, comparisons, scope: "Actual reviewed reference VA/POC painter versus production structure helper: known independent dominant-row/whole-range area bounds, observed gaps, VA/POC switches, five widths including the ten-pixel gate, five ordinary-axis row heights, three stroke widths, three opacities and custom alpha colors. Canonical decimal and inverted-axis safety are separately covered by regressions; this is not full pixel or new VA calculation parity proof." };
await writeFile("artifacts/footprint-structure-reference.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
