import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "@/types/trading";
import { defaultFootprint, footprintSettings, paintFootprintBar, resolveFootprint, resolveFootprintChart, resolveFootprintInstances, resolveVisibleFootprint, validFootprint } from "@/lib/orderflow/footprint";
import { footprintOverlayInputs } from "@/lib/orderflow/footprintOverlay";
import { FOOTPRINT_MODES } from "@/lib/orderflow/footprintModes";
const bar: FootprintBar = { time: 0, volume: 102, delta: 102, poc: 100, levels: [100, 101, 104].map(price => ({ price, upperPrice: price + 1, buyVolume: price === 100 ? 100 : 1, sellVolume: 0, imbalance: null })) };
const base = { ...defaultFootprint(), histogramVisible: false, candleVisible: false, valueAreaVisible: false, pocVisible: false };
function paint(patch: Partial<typeof base> = {}, source = bar, background = "#000000", yOf = (p: number) => (110 - p) * 20, opacity = 1) {
  const fills: Array<{ rect: number[]; color: string; alpha: number }> = [];
  const ctx = { fillStyle: "", globalAlpha: 1, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {}, fillText() {}, fillRect(...rect: number[]) { fills.push({ rect, color: this.fillStyle, alpha: this.globalAlpha }); } };
  const args = { coords: { width: 500, pxPerBar: () => 100, timeToX: () => 100, priceToY: yOf }, scale: {}, bounds: { top: 0, height: 1e20 }, theme: { background, textColor: "#112233", fontFamily: "Arial" } } as unknown as RendererLayerArgs;
  paintFootprintBar(ctx as unknown as CanvasRenderingContext2D, args, source, undefined, 1, { ...base, ...patch }, { width: 80, offset: 0, within: true, opacity }); return fills;
}
it("defaults off and needs observed price rows rather than a candle's OHLC range", () => {
  expect(paint()).toEqual([]);
  expect(paint({ areaBackground: true }, { ...bar, levels: [] })).toEqual([]);
  expect(paint({ areaBackground: true })).toEqual([{ rect: [60, 100, 80, 100], color: "rgba(178,181,190,0.06)", alpha: 1 }]);
});
it("keeps the complete observed span across gaps and hidden rows without mutating source data", () => {
  const source = { ...bar, levels: bar.levels.map(row => ({ ...row, filtered: true })) }, before = structuredClone(source);
  expect(paint({ areaBackground: true, areaBackgroundColor: "#11223380" }, source)).toEqual([{ rect: [60, 100, 80, 100], color: "#11223380", alpha: 1 }]); expect(source).toEqual(before);
});
it("paints before the independent VA fill with the appropriate per-profile reveal alpha", () => {
  const result = paint({ areaBackground: true, areaBackgroundColor: "#11223340", valueAreaVisible: true, valueAreaBackground: "#44556680" }, bar, "#000000", undefined, .4);
  expect(result).toEqual([{ rect: [60, 100, 80, 100], color: "#11223340", alpha: .4 }, { rect: [60, 180, 80, 20], color: "#44556680", alpha: .4 }]);
});
it("adapts the default to light themes and preserves explicit custom alpha/colors", () => {
  expect(paint({ areaBackground: true }, bar, "#ffffff")[0].color).toBe("rgba(19,23,34,0.06)");
  for (const background of ["#000000", "#ffffff"]) expect(paint({ areaBackground: true, areaBackgroundColor: "rgba(1,2,3,0.4)" }, bar, background, undefined, .6)[0]).toMatchObject({ color: "rgba(1,2,3,0.4)", alpha: .6 });
});
it("uses projected span geometry in every mode on ordinary, inverted and logarithmic axes", () => {
  for (const volumeMode of FOOTPRINT_MODES) for (const yOf of [(p: number) => (110 - p) * 20, (p: number) => (p - 95) * 20, (p: number) => Math.log(p) * 100]) {
    const a = yOf(100), b = yOf(105); expect(paint({ areaBackground: true, volumeMode }, bar, "#000000", yOf)[0].rect).toEqual([60, Math.min(a, b), 80, Math.abs(a - b)]);
  }
});
it("uses canonical upper boundaries without recomputing a drifting decimal sum", () => {
  const source = { ...bar, levels: [{ ...bar.levels[0], price: .2, upperPrice: .3 }] };
  expect(paint({ areaBackground: true }, source, "#000000", p => p * 1e16)[0].rect).toEqual([60, 2e15, 80, 1e15]);
});
it("strictly retains independent active/disabled/range backgrounds and preserves old VA preferences", () => {
  const legacy = { ...base, valueAreaBackground: "#abcdef80" }; expect(resolveFootprint(legacy).areaBackground).toBe(false);
  const settings = { ...legacy, areaBackground: true, areaBackgroundColor: "#11223380", fp2Enabled: true, fp2AreaBackground: true, fp2AreaBackgroundColor: "#33445580", fp5Enabled: false, fp5AreaBackground: true, fp5AreaBackgroundColor: "#55667780", vrEnabled: true, vrAreaBackground: true, vrAreaBackgroundColor: "#77889980" };
  expect(validFootprint(settings)).toBe(true); const saved = resolveFootprintChart(settings); expect(resolveFootprintChart(saved)).toEqual(saved);
  expect(resolveFootprintInstances({ ...saved, fp5Enabled: true }).map(v => v.style.areaBackgroundColor)).toEqual(["#11223380", "#33445580", "#55667780"]); expect(resolveVisibleFootprint(saved).style.areaBackgroundColor).toBe("#77889980");
  for (const [key, value] of [["areaBackground", 1], ["fp2AreaBackgroundColor", "url(x)"], ["fp5AreaBackground", "true"], ["vrAreaBackgroundColor", null]] as const) expect(validFootprint({ ...saved, [key]: value })).toBe(false);
});
it("exposes the switch and color for all chart instances, the range and both native studies", () => {
  const settings = footprintSettings(); expect(settings.instances![4].rows.find(r => "key" in r && r.key === "fp5AreaBackground")).toMatchObject({ kind: "toggle", defval: false, colors: [{ key: "fp5AreaBackgroundColor" }] });
  expect(settings.subsections![0].rows.find(r => "key" in r && r.key === "vrAreaBackground")).toMatchObject({ kind: "toggle", colors: [{ key: "vrAreaBackgroundColor" }] });
  for (const kind of ["bar", "visible"] as const) { const inputs = footprintOverlayInputs(kind); expect(inputs.find(i => i.key === "areaBackground")).toMatchObject({ type: "bool", defval: false }); expect(inputs.find(i => i.key === "areaBackgroundColor")).toMatchObject({ type: "color" }); }
});
