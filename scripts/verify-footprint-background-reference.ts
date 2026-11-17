import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { defaultFootprint, paintFootprintBar } from "../lib/orderflow/footprint";
import { FOOTPRINT_MODES } from "../lib/orderflow/footprintModes";
const source = await readFile("artifacts/vela-footprint-reference/1-1mg-s23l974.js", "utf8");
const sourceHash = createHash("sha256").update(source).digest("hex");
assert.equal(sourceHash, "b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b");
const start = source.indexOf("function(e){let{ctx:t,slot:i,bar:r,style:n,geom:a,opacity:s}=e;if(!n.areaBackground.show)return;");
assert.ok(start >= 0, "Reviewed area background painter must exist");
let end = source.indexOf("{", start) + 1, depth = 1;
for (; depth && end < source.length; end++) { if (source[end] === "{") depth++; else if (source[end] === "}") depth--; }
assert.equal(depth, 0);
const reference = runInNewContext(`(${source.slice(start, end)})`, Object.create(null), { timeout: 1000 });
type Fill = { rect: number[]; color: string; alpha: number };
function context(fills: Fill[]) { return { fillStyle: "", globalAlpha: 1, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {}, fillText() {}, fillRect(...rect: number[]) { fills.push({ rect, color: this.fillStyle, alpha: this.globalAlpha }); } }; }
let comparisons = 0;
for (const volumeMode of FOOTPRINT_MODES) for (const prices of [[100], [100, 101, 104], [100, 104]]) for (const tick of [1, 2]) for (const width of [8, 40, 120]) for (const offset of [-20, 0, 30]) for (const opacity of [.02, .4, 1]) for (const show of [false, true]) for (const filtered of [false, true]) for (const yOf of [(p: number) => (120 - p) * 20, (p: number) => (p - 90) * 20, (p: number) => Math.log(p) * 100]) {
  const actual: Fill[] = [], expected: Fill[] = [], color = "rgba(20,60,120,0.35)";
  const rows = prices.map(price => ({ price, buyVolume: 100, sellVolume: 20, imbalance: null, filtered }));
  const ctx = context(actual), referenceCtx = context(expected), center = 200 + offset;
  reference({ ctx: referenceCtx, slot: { x0: center - width / 2, x1: center + width / 2 }, bar: { rows }, style: { areaBackground: { show, color } }, geom: { tick, yOf }, opacity });
  const args = { coords: { width: 600, pxPerBar: () => 100, timeToX: () => 200, priceToY: yOf }, scale: {}, bounds: { top: 0, height: 1e20 }, theme: { background: "#000000", textColor: "#ffffff", fontFamily: "Arial" } } as unknown as RendererLayerArgs;
  paintFootprintBar(ctx as unknown as CanvasRenderingContext2D, args, { time: 0, volume: 120 * rows.length, delta: 80 * rows.length, poc: 100, levels: rows }, undefined, tick,
    { ...defaultFootprint(), volumeMode, histogramVisible: false, candleVisible: false, pocVisible: false, valueAreaVisible: false, areaBackground: show, areaBackgroundColor: color }, { width, offset, within: true, opacity });
  assert.deepEqual(actual, expected); comparisons++;
}
const report = { checkedAt: new Date().toISOString(), sourceHash, comparisons, scope: "Reviewed actual reference whole-area painter versus production painter: five modes, observed gaps, hidden rows, integer tick boundaries, normal/inverted/log projection, slot width/offset, reveal alpha and disabled control. Canonical decimal upper boundaries are separately covered by regression tests. Not whole-renderer pixel parity." };
await writeFile("artifacts/footprint-background-reference.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
