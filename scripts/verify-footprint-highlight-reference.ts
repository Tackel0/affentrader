import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { defaultFootprint, paintFootprintBar } from "../lib/orderflow/footprint";
import { FOOTPRINT_MODES } from "../lib/orderflow/footprintModes";

// Only four reviewed pure canvas helpers and the Ladder outline block are
// evaluated, never the application bundle. Pin the retained official source.
const code = await readFile("artifacts/vela-footprint-reference/1-1mg-s23l974.js", "utf8");
const hash = createHash("sha256").update(code).digest("hex");
assert.equal(hash, "b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b");
function block(start: number) {
  assert.ok(start >= 0); const open = code.indexOf("{", start); let depth = 1, end = open + 1;
  for (; depth && end < code.length; end++) { if (code[end] === "{") depth++; else if (code[end] === "}") depth--; }
  assert.equal(depth, 0); return code.slice(start, end);
}
const helpers = ["t_", "tk", "im", "id"].map(name => block(code.indexOf(`function ${name}(`, 1097000))).join("\n");
const ladder = block(code.indexOf("if(n.imbalance.show&&t_(i))", 1114000));
const functions = runInNewContext(`${helpers}\n({ generic:id, ladder:function(e){let{ctx:t,slot:i,bar:r,style:n,geom:a,opacity:o}=e,p=(i.x0+i.x1)/2;${ladder}} })`, Object.create(null), { timeout: 1000 });
type Stroke = { rect: number[]; color: string; width: number };
function canvas() {
  const strokes: Stroke[] = [];
  const ctx = { strokeStyle: "", lineWidth: 0, fillStyle: "", save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {}, fillText() {},
    strokeRect(...rect: number[]) { strokes.push({ rect, color: this.strokeStyle, width: this.lineWidth }); } };
  return { strokes, ctx };
}
let comparisons = 0;
for (const mode of FOOTPRINT_MODES) for (const stroke of [1, 2, 4, 10]) for (const width of [9, 10, 20, 80]) for (const height of [2, 10, 20, 60]) for (const buy of [false, true]) for (const sell of [false, true]) {
  const actual = canvas(), expected = canvas(), center = 100, left = center - width / 2, right = center + width / 2;
  const style = { ...defaultFootprint(), volumeMode: mode, imbalanceVisible: true, imbalanceWidth: stroke, imbalanceAskColor: "#12345680", imbalanceBidColor: "#abcdef", candleVisible: false, pocVisible: false, valueAreaVisible: false };
  const args = { bounds: { top: 0, height: 10000 }, scale: {}, theme: { textColor: "#112233", background: "white" }, coords: { width: 500, timeToX: () => center, pxPerBar: () => 100, priceToY: (p: number) => (110 - p) * height } } as unknown as RendererLayerArgs;
  paintFootprintBar(actual.ctx as unknown as CanvasRenderingContext2D, args, { time: 0, volume: 15, delta: -3, poc: 100, levels: [{ price: 100, upperPrice: 101, buyVolume: 6, sellVolume: 9, buyImbalance: buy, sellImbalance: sell, imbalance: null }] }, undefined, 1, style, { width, offset: 0, within: true });
  const reference = { ctx: expected.ctx, slot: { x0: left, x1: right, axisX: center }, bar: { rows: [{ price: 100, visible: true, askImb: buy, bidImb: sell }] },
    style: { imbalance: { show: true, width: stroke, askColor: style.imbalanceAskColor, bidColor: style.imbalanceBidColor } }, geom: { tick: 1, yOf: (p: number) => (110 - p) * height }, opacity: 1 };
  (mode === "bid-ask-ladder" ? functions.ladder : functions.generic)(reference);
  assert.deepEqual(actual.strokes, expected.strokes, `${mode}, width=${width}, row=${height}, stroke=${stroke}, buy=${buy}, sell=${sell}`); comparisons++;
}
const report = { checkedAt: new Date().toISOString(), sourceHash: hash, comparisons, scope: "Actual reviewed Vela pure outline helpers versus actual Affentrader painter on ordinary price coordinates; five modes, four widths, four slot widths, four row heights and all dual-flag combinations. Does not prove complete rendering, inverted-reference behavior or market coverage." };
await writeFile("artifacts/footprint-highlight-reference.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
