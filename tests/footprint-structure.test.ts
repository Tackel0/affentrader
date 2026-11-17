import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "@/types/trading";
import { defaultFootprint, paintFootprintBar } from "@/lib/orderflow/footprint";
import { paintFootprintStructure } from "@/lib/orderflow/footprintStructure";
import { paintFootprintPocExtensions } from "@/lib/orderflow/footprintPoc";
const bar: FootprintBar = { time: 0, volume: 110, delta: 90, poc: 100, levels: [{ price: 100, upperPrice: 101, buyVolume: 100, sellVolume: 10, imbalance: null }] };
function canvas() {
  const draws: Array<{ kind: string; color: string; alpha: number; values: Array<number | string> }> = [];
  const ctx = { fillStyle: "", strokeStyle: "", globalAlpha: 1, lineWidth: 1, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { draws.push({ kind: "line", color: this.strokeStyle, alpha: this.globalAlpha, values: [] }); }, fillRect(...values: number[]) { draws.push({ kind: "fill", color: this.fillStyle, alpha: this.globalAlpha, values }); }, strokeRect(...values: number[]) { draws.push({ kind: "poc", color: this.strokeStyle, alpha: this.globalAlpha, values }); }, fillText(text: string) { draws.push({ kind: "text", color: this.fillStyle, alpha: this.globalAlpha, values: [text] }); } };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, draws };
}
const args = (background = "#000000", inverted = false) => ({ bars: [{ time: 0 }, { time: 60000 }], coords: { width: 600, pxPerBar: () => 100, timeToX: () => 200, priceToY: (p: number) => inverted ? (p - 90) * 20 : (110 - p) * 20 }, scale: {}, bounds: { top: 0, height: 600 }, theme: { background, textColor: "#ffffff", fontFamily: "Arial" } }) as unknown as RendererLayerArgs;
const style = { ...defaultFootprint(), candleVisible: false, textAutoSize: false, valueAreaBackground: "#11223380" };
it("paints the independent whole background, cells/numbers, then VA fill/lines and POC", () => {
  const c = canvas(); paintFootprintBar(c.ctx, args(), bar, undefined, 1, { ...style, areaBackground: true, areaBackgroundColor: "#44556640" }, { width: 100, offset: 0, within: true });
  const kinds = c.draws.map(d => d.kind); expect(c.draws[0].color).toBe("#44556640");
  const va = c.draws.findIndex(d => d.color === "#11223380"); expect(va).toBeGreaterThan(kinds.lastIndexOf("text"));
  expect(kinds.slice(va)).toEqual(["fill", "line", "line", "poc"]);
});
it("keeps VA fill but suppresses structure lines and POC below the ten-pixel gate", () => {
  const c = canvas(); paintFootprintStructure(c.ctx, args(), bar, 1, style, 10, 19.99, 1); expect(c.draws.map(d => d.kind)).toEqual(["fill"]);
  const edge = canvas(); paintFootprintStructure(edge.ctx, args(), bar, 1, style, 10, 20, 1); expect(edge.draws.map(d => d.kind)).toEqual(["fill", "line", "line", "poc"]);
});
it("keeps the one-pixel row gap and configured inset in normal and inverted projections", () => {
  for (const inverted of [false, true]) { const c = canvas(); paintFootprintStructure(c.ctx, args("#000000", inverted), bar, 1, { ...style, pocWidth: 4 }, 100, 200, .4);
    expect(c.draws.at(-1)).toMatchObject({ kind: "poc", alpha: .248, values: [102, inverted ? 202 : 182, 96, 15] }); }
});
it("adapts default POC outline and extension colors to the same light theme", () => {
  for (const [background, expected] of [["#ffffff", "#131722"], ["#000000", "#ffffff"]]) {
    const view = args(background), c = canvas(); paintFootprintStructure(c.ctx, view, bar, 1, style, 100, 200, 1); expect(c.draws.at(-1)?.color).toBe(expected);
    const ray = canvas(); paintFootprintPocExtensions(ray.ctx, view, [{ time: 0, lower: 100, upper: 101, price: 100.5, from: 60000, touched: null }], { ...style, pocExtend: true }, { width: 100, offset: 0, within: true }); expect(ray.draws[0].color).toBe(expected);
    const custom = canvas(); paintFootprintStructure(custom.ctx, view, bar, 1, { ...style, pocColor: "#aabbcc80" }, 100, 200, 1); expect(custom.draws.at(-1)?.color).toBe("#aabbcc80");
  }
});
it("omits hidden POC rows and never invents a structure for an empty observed range", () => {
  for (const source of [{ ...bar, levels: [] }, { ...bar, levels: bar.levels.map(r => ({ ...r, filtered: true })) }]) { const c = canvas(); paintFootprintStructure(c.ctx, args(), source, 1, style, 100, 200, 1); expect(c.draws).toEqual([]); }
});
