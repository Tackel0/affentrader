import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { defaultFootprint } from "@/lib/orderflow/footprint";
import { footprintRowAtPoint, type FootprintRowHit } from "@/lib/orderflow/footprintHover";
import { footprintPriceDigits, paintFootprintTooltip } from "@/lib/orderflow/footprintTooltip";
const source = { time: 0, volume: 15000, delta: 10000, poc: 100, levels: [{ price: 100, upperPrice: 101, buyVolume: 12500, sellVolume: 2500, imbalance: null }] };
const view = { id: "fp1", label: "Footprint 1", bars: [source], style: defaultFootprint(), step: 1, placement: { width: 80, offset: 0, within: true } };
const hit: FootprintRowHit = { view, bar: source, row: 0, lower: 100, upper: 101, rect: { x: 60, y: 100, width: 80, height: 20 } };
function paint(background = "#ffffff", current = hit, plotWidth = 600, paneTop = 0, hint = true) {
  const texts: Array<{ text: string; color: string }> = [], fills: Array<{ rect: number[]; color: string }> = [];
  const ctx = { font: "", fillStyle: "", strokeStyle: "", save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {}, fillRect(...rect: number[]) { fills.push({ rect, color: this.fillStyle }); }, measureText(text: string) { return { width: text.length * parseFloat(this.font.replace(/^600 /, "")) * .6 }; }, fillText(text: string) { texts.push({ text, color: this.fillStyle }); } };
  const args = { coords: { width: plotWidth }, bounds: { top: paneTop, height: 400 }, theme: { background, textColor: "#112233", upColor: "#00aa00", downColor: "#aa0000", fontFamily: "Arial" } } as unknown as RendererLayerArgs;
  const geometry = paintFootprintTooltip(ctx as unknown as CanvasRenderingContext2D, args, current, hint); return { texts, fills, geometry };
}
it("formats row prices at tick precision up to eight decimals", () => {
  expect([1, .25, .0001, 1e-8, 1e-9, 0].map(footprintPriceDigits)).toEqual([0, 2, 4, 8, 0, 2]);
  expect(paint().texts.map(t => t.text)).toEqual(["100 – 101", "Bid × Ask", "13k", " × ", "2.5k", "Volume", "15k", "Delta", "+10k", "⇧ Shift to magnify"]);
});
it("keeps raw volumes under mean sizing and uses theme direction colors", () => {
  const result = paint("#ffffff", { ...hit, view: { ...view, style: { ...view.style, averageTradeSize: true } } });
  expect(result.texts.find(t => t.text === "13k")?.color).toBe("#00aa00"); expect(result.texts.find(t => t.text === "2.5k")?.color).toBe("#aa0000");
  expect(result.texts.find(t => t.text === "+10k")?.color).toBe("#00aa00");
});
it("measures a rounded native-style panel beside the slot, flips left and respects pane offsets", () => {
  const right = paint(), left = paint("#ffffff", { ...hit, rect: { ...hit.rect, x: 450 } });
  expect(right.geometry.x).toBe(150); expect(left.geometry.x + left.geometry.width).toBe(440); expect(right.geometry.height).toBe(112);
  const shifted = paint("#ffffff", { ...hit, rect: { ...hit.rect, y: 200 } }, 600, 100); expect(shifted.geometry.y).toBe(right.geometry.y + 100);
  expect(paint("#ffffff", hit, 600, 0, false).geometry.height).toBe(98);
});
it("uses the full row highlight and independent light/dark popup palettes", () => {
  expect(paint().fills[0]).toEqual({ rect: [60, 100, 80, 20], color: "rgba(41, 45, 53, 0.08)" });
  expect(paint("#000000").fills[0].color).toBe("rgba(180, 185, 197, 0.13)");
  expect(paint().fills[1].color).toBe("rgba(255, 255, 255, 0.95)"); expect(paint("#000000").fills[1].color).toBe("rgba(18, 20, 25, 0.92)");
});
it("keeps tall rows, filtered observations and dense histogram-off rows inspectable", () => {
  const args = { priceStyle: "footprint", bars: [{ time: 0 }], coords: { width: 600, pxPerBar: () => 100, timeToX: () => 100, priceToY: (price: number) => (102 - price) * 100 }, bounds: { top: 0, height: 400 } } as unknown as RendererLayerArgs;
  const hidden = { ...view, bars: [{ ...source, levels: source.levels.map(r => ({ ...r, filtered: true })) }] };
  expect(footprintRowAtPoint(args, [hidden], 100, 101)?.rect).toMatchObject({ y: 100, height: 100 });
  expect(footprintRowAtPoint(args, [view], 100, 199)?.lower).toBe(100);
  const dense = { ...args, coords: { ...args.coords, priceToY: (p: number) => (102 - p) * 2 } } as unknown as RendererLayerArgs;
  expect(footprintRowAtPoint(dense, [{ ...view, style: { ...view.style, histogramVisible: false } }], 100, 3)?.lower).toBe(100);
});
