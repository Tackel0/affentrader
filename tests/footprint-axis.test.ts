import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "@/types/trading";
import { defaultFootprint, paintFootprintBar, type FootprintPreferences } from "@/lib/orderflow/footprint";
import { FOOTPRINT_MODES } from "@/lib/orderflow/footprintModes";
const bar: FootprintBar = { time: 0, volume: 10, delta: 6, poc: 100, levels: [{ price: 100, upperPrice: 101, buyVolume: 8, sellVolume: 2, imbalance: null }, { price: 104, upperPrice: 105, buyVolume: 0, sellVolume: 0, imbalance: null, filtered: true }] };
function paint(patch: Partial<FootprintPreferences> = {}, width = 80, opacity = 1, source = bar, invert = false) {
  const order: string[] = [], lines: Array<{ points: number[][]; color: string; width: number; alpha: number }> = []; let points: number[][] = [];
  const ctx = { fillStyle: "", strokeStyle: "", lineWidth: 0, globalAlpha: 1, save() {}, restore() {}, beginPath() { points = []; }, moveTo(x: number, y: number) { points.push([x, y]); }, lineTo(x: number, y: number) { points.push([x, y]); }, stroke() { lines.push({ points, color: this.strokeStyle, width: this.lineWidth, alpha: this.globalAlpha }); order.push("axis"); }, strokeRect() {}, fillRect() { order.push("fill"); }, fillText() { order.push("text"); } };
  const args = { coords: { width: 600, pxPerBar: () => 100, timeToX: () => 200, priceToY: (p: number) => invert ? (p - 90) * 20 : (110 - p) * 20 }, bounds: { top: 0, height: 600 }, scale: {}, theme: { background: "#ffffff", textColor: "#112233", fontFamily: "Arial" } } as unknown as RendererLayerArgs;
  paintFootprintBar(ctx as unknown as CanvasRenderingContext2D, args, source, undefined, 1, { ...defaultFootprint(), candleVisible: false, valueAreaVisible: false, pocVisible: false, ...patch }, { width, offset: 7, within: true, opacity });
  return { lines, order };
}
it("paints a one-pixel chart-theme zero axis only in the two centered profile modes", () => {
  for (const volumeMode of FOOTPRINT_MODES) expect(paint({ volumeMode, textColor: "#abcdef" }).lines).toEqual(volumeMode === "bid-ask" || volumeMode === "delta" ? [{ points: [[207, 100], [207, 200]], color: "#112233", width: 1, alpha: .5 }] : []);
});
it("spans all observed rows including gaps and a hidden boundary on either axis direction", () => {
  for (const invert of [false, true]) expect(paint({}, 80, .4, bar, invert).lines[0]).toMatchObject({ points: invert ? [[207, 300], [207, 200]] : [[207, 100], [207, 200]], alpha: .2 });
});
it("appears after the whole background and before histogram cells and labels", () => {
  const result = paint({ areaBackground: true }); expect(result.order[0]).toBe("fill"); expect(result.order[1]).toBe("axis"); expect(result.order.slice(2)).toContain("fill"); expect(result.order.slice(2)).toContain("text");
});
it("honors the ten-pixel gate, hidden histogram, absent rows and zero mode maximum", () => {
  expect(paint({}, 9.99).lines).toEqual([]); expect(paint({}, 10).lines).toHaveLength(1); expect(paint({ histogramVisible: false }).lines).toEqual([]);
  expect(paint({}, 80, 1, { ...bar, levels: [] }).lines).toEqual([]);
  const balanced = { ...bar, levels: [{ ...bar.levels[0], buyVolume: 2, sellVolume: 2 }] };
  expect(paint({ volumeMode: "delta" }, 80, 1, balanced).lines).toEqual([]); expect(paint({ volumeMode: "bid-ask" }, 80, 1, balanced).lines).toHaveLength(1);
});
