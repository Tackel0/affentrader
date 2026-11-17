import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "@/types/trading";
import { defaultFootprint, footprintSettings, paintFootprintBar, resolveFootprint, resolveFootprintChart, resolveFootprintInstances, validFootprint } from "@/lib/orderflow/footprint";
import { FOOTPRINT_MODES } from "@/lib/orderflow/footprintModes";

const bar: FootprintBar = { time: 0, volume: 20, delta: 0, poc: 100, levels: [
  { price: 100, upperPrice: 101, sellVolume: 9, buyVolume: 1, sellCount: 3, buyCount: 1, sellImbalance: true, buyImbalance: false, imbalance: "sell" },
  { price: 101, upperPrice: 102, sellVolume: 1, buyVolume: 9, sellCount: 1, buyCount: 3, sellImbalance: false, buyImbalance: true, imbalance: "buy" },
] };
function draw(highlight: boolean, recolor: boolean, cellValues: "bid-ask" | "bid-ask-trades" | "delta" = "bid-ask", mode: typeof FOOTPRINT_MODES[number] = "bid-ask-ladder", inverted = false, source = bar) {
  const text: Array<[string, string]> = [], strokes: string[] = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, fillRect() {}, stroke(this: { strokeStyle: string }) { strokes.push(this.strokeStyle); }, strokeRect(this: { strokeStyle: string }) { strokes.push(this.strokeStyle); }, fillStyle: "", strokeStyle: "", fillText(this: { fillStyle: string }, value: string) { text.push([value, this.fillStyle]); } } as unknown as CanvasRenderingContext2D;
  const args = { coords: { width: 500, timeToX: () => 100, pxPerBar: () => 100, priceToY: (price: number) => inverted ? (price - 95) * 20 : (110 - price) * 20 }, scale: {}, bounds: { top: 0, height: 300 }, theme: { textColor: "#112233", background: "#ffffff" } } as unknown as RendererLayerArgs;
  paintFootprintBar(ctx, args, source, undefined, 1, { ...defaultFootprint(), textColorAuto: true, histogramVisible: false, candleVisible: false, pocVisible: false, valueAreaVisible: false, imbalanceVisible: highlight, imbalanceRecolor: recolor, cellValues, volumeMode: mode });
  return { text, strokes };
}
it.each([false, true])("keeps outline and side-value tint independent for all four combinations, inverted=%s", inverted => {
  for (const highlight of [false, true]) for (const recolor of [false, true]) {
    const result = draw(highlight, recolor, "bid-ask", "bid-ask-ladder", inverted);
    expect(result.strokes).toEqual(highlight ? ["#f23645", "#089981"] : []);
    expect(result.text).toEqual([["9", recolor ? "#f23645" : "#112233"], ["1", "#112233"], ["1", "#112233"], ["9", recolor ? "#089981" : "#112233"]]);
  }
});
it("uses displayed side flags in every profile mode and in side trade-count labels", () => {
  for (const mode of FOOTPRINT_MODES) {
    expect(draw(false, true, "bid-ask-trades", mode).text).toEqual([["3", "#f23645"], ["1", "#112233"], ["1", "#112233"], ["3", "#089981"]]);
    expect(draw(false, false, "bid-ask-trades", mode).text.every(([, color]) => color === "#112233")).toBe(true);
  }
});
it("uses independent imbalance recoloring for centered delta values, rather than delta sign", () => {
  for (const highlight of [false, true]) for (const recolor of [false, true])
    expect(draw(highlight, recolor, "delta").text).toEqual([["-8", recolor ? "#f23645" : "#112233"], ["+8", recolor ? "#089981" : "#112233"]]);
});
it("honors dual flags, explicit false flags, legacy flags and filtered row slots without mutating data", () => {
  const source: FootprintBar = { ...bar, levels: [
    { ...bar.levels[0], sellImbalance: true, buyImbalance: true },
    { ...bar.levels[1], buyImbalance: false },
    { ...bar.levels[0], price: 102, upperPrice: 103, sellImbalance: undefined, buyImbalance: undefined },
    { ...bar.levels[1], price: 103, upperPrice: 104, filtered: true },
  ] };
  const before = JSON.stringify(source);
  expect(draw(false, true, "bid-ask", "bid-ask-ladder", false, source).text).toEqual([["9", "#f23645"], ["1", "#089981"], ["1", "#112233"], ["9", "#112233"], ["9", "#f23645"], ["1", "#112233"]]);
  expect(JSON.stringify(source)).toBe(before);
});
it("migrates legacy coupled switches independently in active and disabled instances", () => {
  const { imbalanceRecolor: _removed, ...legacy } = { ...defaultFootprint(), imbalanceVisible: false };
  expect(validFootprint(legacy)).toBe(true);
  expect(resolveFootprint(legacy).imbalanceRecolor).toBe(false);
  expect(resolveFootprint({ ...legacy, imbalanceVisible: true }).imbalanceRecolor).toBe(true);
  const chart = { ...legacy, fp2Enabled: true, fp2ImbalanceVisible: false, fp5Enabled: false, fp5ImbalanceVisible: false };
  expect(resolveFootprintInstances(chart).map(instance => instance.style.imbalanceRecolor)).toEqual([false, false]);
  // Resolving a backup must also retain the legacy behavior of disabled slots.
  const saved = resolveFootprintChart(chart);
  expect(resolveFootprintInstances({ ...saved, fp5Enabled: true }).map(instance => instance.style.imbalanceRecolor)).toEqual([false, false, false]);
});
it("strictly stores explicit recolor preferences per instance and exposes native controls", () => {
  const chart = { ...defaultFootprint(), imbalanceRecolor: false, fp2Enabled: true, fp2ImbalanceRecolor: true, fp5Enabled: false, fp5ImbalanceRecolor: false };
  expect(validFootprint(chart)).toBe(true);
  const saved = resolveFootprintChart(chart);
  expect(saved).toMatchObject({ imbalanceRecolor: false, fp2ImbalanceRecolor: true, fp5ImbalanceRecolor: false });
  for (const key of ["imbalanceRecolor", "fp2ImbalanceRecolor", "fp5ImbalanceRecolor"]) for (const value of [undefined, null, "true", 1]) expect(validFootprint({ ...chart, [key]: value })).toBe(false);
  const rows = footprintSettings().rows!;
  expect(rows.find(row => row.kind === "toggle" && row.key === "imbalanceRecolor")).toMatchObject({ label: "Recolor imbalance values", defval: false });
  expect(footprintSettings().instances![1].rows.find(row => row.kind === "toggle" && row.key === "fp2ImbalanceRecolor")).toMatchObject({ label: "Recolor imbalance values", defval: false });
});
