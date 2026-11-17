import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar, FootprintLevel } from "@/types/trading";
import { defaultFootprint, footprintSettings, footprintTextPlan, resolveFootprint, resolveFootprintChart, resolveFootprintInstances, resolveVisibleFootprint, validFootprint } from "@/lib/orderflow/footprint";
import { footprintNumber, paintFootprintText, planFootprintText } from "@/lib/orderflow/footprintText";
import { footprintOverlayInputVisible, footprintOverlayInputs } from "@/lib/orderflow/footprintOverlay";
const slot = { left: 60, right: 140, axis: 100 };
const row: FootprintLevel = { price: 100, upperPrice: 101, buyVolume: 1000, sellVolume: 1, buyCount: 1000, sellCount: 1, imbalance: null };
function canvas() {
  const calls: Array<{ args: unknown[]; font: string; align: string; color: string }> = [];
  const value = { font: "", textAlign: "left", fillStyle: "", measureText(text: string) { return { width: text.length * parseFloat(this.font) }; }, fillText(...args: unknown[]) { calls.push({ args, font: this.font, align: this.textAlign, color: this.fillStyle }); } };
  return { calls, ctx: value as unknown as CanvasRenderingContext2D };
}
it("formats signed/compact/rounded values without changing source counts", () => {
  expect([0, .001, .01, .1, 1, 1.25, 99.99, 100, 999, 1000, 9999, 10000, -1250000].map(footprintNumber)).toEqual(["0", "0.0", "0.01", "0.1", "1", "1.3", "100.0", "100", "999", "1.0k", "10.0k", "10k", "-1250k"]);
  expect(footprintNumber(NaN)).toBe("—"); expect(footprintNumber(Infinity)).toBe("—");
});
it("chooses one Auto size across all visible rows and ignores filtered outliers", () => {
  const c = canvas(), style = defaultFootprint();
  expect(planFootprintText(c.ctx, style, [row], slot, () => 29, "Test Font")).toBe(8);
  const outlier = { ...row, buyVolume: 123456789 };
  expect(planFootprintText(c.ctx, style, [row, outlier], slot, () => 29, "Test Font")).toBe(0);
  expect(planFootprintText(c.ctx, style, [row, { ...outlier, filtered: true }], slot, () => 29, "Test Font")).toBe(8);
  expect(planFootprintText(c.ctx, { ...style, textFit: true }, [row], slot, () => 29, "Test Font")).toBeNull();
});
it("plans only drawable bars, sharing the size without borrowing offscreen numbers", () => {
  const c = canvas(), bar = (time: number, level: FootprintLevel): FootprintBar => ({ time, levels: [level], delta: level.buyVolume - level.sellVolume, volume: level.buyVolume + level.sellVolume, poc: level.price });
  const args = { coords: { width: 200, pxPerBar: () => 100, timeToX: (t: number) => t, priceToY: (p: number) => (110 - p) * 30 }, bounds: {}, scale: {}, theme: { fontFamily: "Test Font" } } as unknown as RendererLayerArgs;
  expect(footprintTextPlan(c.ctx, args, [bar(100, row), bar(999, { ...row, buyVolume: 123456789 })], 1, defaultFootprint(), { width: 80, offset: 0, within: true })).toBe(8);
});
it("shrinks individual Ladder numbers to five pixels without stretching glyphs", () => {
  const source = { ...row, buyVolume: 999 }, style = { ...defaultFootprint(), volumeMode: "bid-ask-ladder" as const, textAutoSize: false, textSize: 11 };
  const a = canvas(), b = canvas(), small = { left: 78, right: 122, axis: 100 };
  paintFootprintText(a.ctx, source, style, small, 29, 100, 999, "Test Font", "#123456", 1, null);
  expect(a.calls.map(call => call.args[0])).toEqual(["1"]);
  paintFootprintText(b.ctx, source, { ...style, textFit: true }, small, 29, 100, 999, "Test Font", "#123456", 1, null);
  expect(b.calls.map(call => [call.args[0], call.font])).toEqual([["1", "11px Test Font"], ["999", "5px Test Font"]]);
  expect(b.calls.every(call => call.args.length === 3)).toBe(true);
});
it("gates labels by opacity, row height, slot width and a suppressing Auto plan", () => {
  for (const [opacity, height, width, planned] of [[.59, 29, 80, null], [1, 13, 80, null], [1, 29, 21, null], [1, 29, 80, 0]] as const) {
    const c = canvas(); paintFootprintText(c.ctx, row, defaultFootprint(), { left: 100 - width / 2, right: 100 + width / 2, axis: 100 }, height, 100, 1000, "Test Font", "#123456", opacity, planned); expect(c.calls).toEqual([]);
  }
  const c = canvas(); paintFootprintText(c.ctx, row, defaultFootprint(), slot, 29, 100, 1000, "Test Font", "#123456", .6, 8); expect(c.calls).toHaveLength(2);
});
it("positions Delta values by plotted sign while retaining raw volume labels", () => {
  const c = canvas(), source = { ...row, buyVolume: 8, sellVolume: 6, buyCount: 8, sellCount: 1 }, style = { ...defaultFootprint(), volumeMode: "delta" as const, averageTradeSize: true };
  paintFootprintText(c.ctx, source, style, slot, 29, 100, 5, "Test Font", "#123456", 1, null);
  expect(c.calls.map(call => [call.args, call.align])).toEqual([[["+2", 97, 100], "right"]]);
});
it("left-aligns scalar Volume/Absolute Delta values and omits actual zero sides", () => {
  for (const volumeMode of ["total", "absolute-delta"] as const) {
    const c = canvas(); paintFootprintText(c.ctx, { ...row, buyVolume: 2, sellVolume: 1 }, { ...defaultFootprint(), volumeMode }, slot, 29, 100, 3, "Test Font", "#123456", 1, null);
    expect(c.calls[0].args[1]).toBe(63); expect(c.calls[0].align).toBe("left");
  }
  const c = canvas(); paintFootprintText(c.ctx, { ...row, buyVolume: 0, buyCount: 0 }, defaultFootprint(), slot, 29, 100, 1, "Test Font", "#123456", 1, null); expect(c.calls.map(call => call.args[0])).toEqual(["1"]);
});
it("preserves unknown-count dashes and uses the explicit 14px magnifier size", () => {
  const c = canvas(); paintFootprintText(c.ctx, { ...row, buyVolume: 9, buyCount: undefined }, { ...defaultFootprint(), cellValues: "bid-ask-trades" }, slot, 29, 100, 9, "Test Font", "#123456", 1, null, 14);
  expect(c.calls.map(call => [call.args[0], call.font])).toEqual([["1", "14px Test Font"], ["—", "14px Test Font"]]);
});
it("validates and round-trips independent chart, disabled-instance and range font controls", () => {
  const settings = { ...defaultFootprint(), textAutoSize: false, textSize: 20, textFit: true, fp2Enabled: true, fp2TextAutoSize: false, fp2TextSize: 6, fp5Enabled: false, fp5TextSize: 40, fp5TextFit: true, vrEnabled: true, vrTextSize: 30, vrTextAutoSize: false };
  expect(validFootprint(settings)).toBe(true); const saved = resolveFootprintChart(settings); expect(resolveFootprintChart(saved)).toEqual(saved);
  expect(resolveFootprintInstances({ ...saved, fp5Enabled: true }).map(i => i.style.textSize)).toEqual([20, 6, 40]); expect(resolveVisibleFootprint(saved).style.textSize).toBe(30);
  for (const [key, value] of [["textSize", 5], ["fp2TextSize", 41], ["fp5TextSize", 11.5], ["vrTextFit", "true"]] as const) expect(validFootprint({ ...saved, [key]: value })).toBe(false);
  expect([5, 99, 11.4].map(textSize => resolveFootprint({ textSize }).textSize)).toEqual([6, 40, 11]);
});
it("exposes 6–40px manual size conditionally in all instances and both native overlays", () => {
  const settings = footprintSettings(); expect(settings.instances![4].rows.find(r => "key" in r && r.key === "fp5TextSize")).toMatchObject({ kind: "number", min: 6, max: 40, defval: 11, when: { key: "fp5TextAutoSize", equals: false } });
  for (const kind of ["bar", "visible"] as const) {
    expect(footprintOverlayInputs(kind).find(i => i.key === "textSize")).toMatchObject({ type: "int", min: 6, max: 40, defval: 11 });
    expect(footprintOverlayInputVisible(kind, "textSize", { textAutoSize: true })).toBe(false); expect(footprintOverlayInputVisible(kind, "textSize", { textAutoSize: false })).toBe(true);
  }
});
