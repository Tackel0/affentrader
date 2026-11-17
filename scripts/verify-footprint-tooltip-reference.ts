import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { defaultFootprint } from "../lib/orderflow/footprint";
import { paintFootprintTooltip } from "../lib/orderflow/footprintTooltip";
const source = await readFile("artifacts/vela-footprint-reference/1-1mg-s23l974.js", "utf8"), sourceHash = createHash("sha256").update(source).digest("hex");
assert.equal(sourceHash, "b4866bcd182bbc8905db915f05be299e7a9c50b6b05003cc25e96f579414b49b");
function block(name: string) { const start = source.indexOf(`function ${name}(`, 1097000); assert.ok(start >= 0, name); let end = source.indexOf("{", start) + 1, depth = 1; for (; depth && end < source.length; end++) { if (source[end] === "{") depth++; else if (source[end] === "}") depth--; } assert.equal(depth, 0); return source.slice(start, end); }
const regexStart = source.indexOf("var tI=", 1097000), regexEnd = source.indexOf(";function tR", regexStart), paletteStart = source.indexOf("var iD=", 1120000), paletteEnd = source.indexOf(";function iF", paletteStart);
assert.ok(regexStart > 0 && regexEnd > regexStart && paletteStart > 0 && paletteEnd > paletteStart);
const reference = runInNewContext(`${source.slice(regexStart, regexEnd)};${source.slice(paletteStart, paletteEnd)};const tO=new Map();${["tR", "tB", "tS", "tA", "tw", "iO", "iF"].map(block).join("\n")}\n({paint:iF,digits:iO})`, Object.create(null), { timeout: 1000 });
type Draw = { kind: string; values: Array<number | string>; color: string; alpha: number; font?: string; align?: string; width?: number };
function context(draws: Draw[], offset = 0) { let path: number[] = []; return { fillStyle: "", strokeStyle: "", globalAlpha: 1, font: "", textAlign: "", lineWidth: 1, save() {}, restore() {}, beginPath() { path = []; }, moveTo(x: number, y: number) { path.push(x, y + offset); }, lineTo(x: number, y: number) { path.push(x, y + offset); }, stroke() { draws.push({ kind: "stroke", values: path, color: this.strokeStyle, alpha: this.globalAlpha, width: this.lineWidth }); }, fill() { draws.push({ kind: "fill", values: [], color: this.fillStyle, alpha: this.globalAlpha }); }, roundRect(x: number, y: number, w: number, h: number, radius: number) { draws.push({ kind: "roundRect", values: [x, y + offset, w, h, radius], color: this.fillStyle, alpha: this.globalAlpha }); }, fillRect(x: number, y: number, w: number, h: number) { draws.push({ kind: "fillRect", values: [x, y + offset, w, h], color: this.fillStyle, alpha: this.globalAlpha }); }, fillText(text: string, x: number, y: number) { draws.push({ kind: "text", values: [text, x, y + offset], color: this.fillStyle, alpha: this.globalAlpha, font: this.font, align: this.textAlign }); }, measureText(text: string) { return { width: [...text].reduce((sum, c) => sum + (c === '1' ? .35 : c === ' ' ? .3 : .6), 0) * parseFloat(this.font.replace(/^600 /, "")) }; } }; }
let comparisons = 0;
for (const background of ["#000000", "#ffffff"]) for (const width of [180, 500, 1200]) for (const x of [20, width / 2, width - 50]) for (const paneHeight of [100, 400]) for (const y of [-20, paneHeight / 2, paneHeight - 20]) for (const rowHeight of [2, 20, 200]) for (const [buyVolume, sellVolume] of [[0, 0], [8, 2], [1.25, 10000], [1000000, .01]]) for (const step of [1, .25, 1e-8, 1e-9]) for (const hint of [false, true]) for (const highlight of [false, true]) for (const paneTop of [0, 80, 80.5]) {
  const actual: Draw[] = [], expected: Draw[] = [], lower = step >= 1 ? 100 : .2, upper = lower + step;
  const bar = { time: 0, volume: buyVolume + sellVolume, delta: buyVolume - sellVolume, poc: lower, levels: [{ price: lower, upperPrice: upper, buyVolume, sellVolume, imbalance: null }] };
  const hit = { view: { id: "fp1", label: "Footprint 1", bars: [bar], style: defaultFootprint(), step }, bar, row: 0, lower, upper, rect: { x, y: y + paneTop, width: 80, height: rowHeight } };
  const theme = { background, textColor: "#112233", upColor: "#089981", downColor: "#f23645", fontFamily: "Arial" };
  const args = { coords: { width }, bounds: { top: paneTop, height: paneHeight }, theme } as unknown as RendererLayerArgs;
  paintFootprintTooltip(context(actual) as unknown as CanvasRenderingContext2D, args, hit, hint, highlight);
  reference.paint(context(expected, paneTop), { bottomPrice: lower, topPrice: upper, bid: sellVolume, ask: buyVolume, volume: bar.volume, delta: bar.delta, xLeft: x, xRight: x + 80, yTop: y, yBot: y + rowHeight }, { theme, formatPrice: (p: number) => p.toFixed(reference.digits(step)), plotW: width, plotH: paneHeight, hint, rowHighlight: highlight });
  assert.deepEqual(actual, expected); comparisons++;
}
const report = { checkedAt: new Date().toISOString(), sourceHash, comparisons, scope: "Actual reviewed iF popup painter and tick precision versus production helper: light/dark, three plot widths/slot positions/row positions/heights, small/large panes, raw zero/positive/negative/large volumes, four tick sizes including reference tiny-tick threshold, hint/highlight switches and secondary-pane offsets with deterministic glyph metrics. Not full hover hit-priority, magnifier, browser raster or source-history equivalence." };
await writeFile("artifacts/footprint-tooltip-reference.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
