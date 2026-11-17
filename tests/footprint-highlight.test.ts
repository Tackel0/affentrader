import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar, IndicatorInstance } from "@/types/trading";
import { defaultFootprint, footprintSettings, paintFootprintBar, resolveFootprint, resolveFootprintChart, resolveFootprintInstances, resolveVisibleFootprint, validFootprint, type FootprintPreferences } from "@/lib/orderflow/footprint";
import { footprintOverlayInputs, resolveFootprintOverlay } from "@/lib/orderflow/footprintOverlay";
import { nativeIndicatorInputs } from "@/lib/indicators/nativeInputs";
import { FOOTPRINT_MODES } from "@/lib/orderflow/footprintModes";
const row = { price: 100, upperPrice: 101, buyVolume: 6, sellVolume: 9, buyCount: 2, sellCount: 3, buyImbalance: true, sellImbalance: true, imbalance: "buy" as const };
const bar: FootprintBar = { time: 0, levels: [row], volume: 15, delta: -3, poc: 100 };
function paint(patch: Partial<FootprintPreferences> = {}, inverted = false, source = bar, rowPixels = 20, width = 80) {
  const strokes: Array<{ rect: number[]; color: string; width: number }> = [], fills: number[][] = [], texts: Array<[string, string]> = [];
  const ctx = { fillStyle: "", strokeStyle: "", lineWidth: 0, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    fillRect(...rect: number[]) { fills.push(rect); }, strokeRect(...rect: number[]) { strokes.push({ rect, color: this.strokeStyle, width: this.lineWidth }); },
    fillText(text: string) { texts.push([text, this.fillStyle]); } };
  const args = { coords: { width: 500, timeToX: () => 100, pxPerBar: () => 100, priceToY: (p: number) => inverted ? (p - 95) * rowPixels : (110 - p) * rowPixels }, bounds: { top: 0, height: 1000 }, scale: {}, theme: { textColor: "#112233", background: "#ffffff" } } as unknown as RendererLayerArgs;
  paintFootprintBar(ctx as unknown as CanvasRenderingContext2D, args, source, undefined, 1, { ...defaultFootprint(), textColorAuto: true, candleVisible: false, pocVisible: false, valueAreaVisible: false, ...patch }, { offset: 0, within: true, width });
  return { strokes, fills, texts };
}
it("matches default-off highlight/recolor while preserving explicitly saved legacy switches", () => {
  expect(defaultFootprint()).toMatchObject({ imbalanceVisible: false, imbalanceRecolor: false, imbalanceWidth: 2, imbalancePercent: 300, imbalanceRatio: 3 });
  expect(paint().strokes).toEqual([]);
  expect(paint({ cellValues: "delta" }).texts).toEqual([["-3", "#112233"]]);
  const legacy = { ...defaultFootprint(), imbalanceVisible: true } as Record<string, unknown>; delete legacy.imbalanceRecolor;
  expect(resolveFootprint(legacy)).toMatchObject({ imbalanceVisible: true, imbalanceRecolor: true });
});
it("uses four independent outline/text colors without changing histogram colors or source rows", () => {
  const before = structuredClone(bar), result = paint({ imbalanceVisible: true, imbalanceRecolor: true, cellValues: "bid-ask", buyColor: "#010203", sellColor: "#040506", imbalanceAskColor: "#12345680", imbalanceBidColor: "#abcdef", imbalanceTextAskColor: "#ff00ff", imbalanceTextBidColor: "#00ffff" });
  expect(result.strokes.map(s => s.color)).toEqual(["#abcdef", "#12345680"]);
  expect(result.texts).toEqual([["9", "#00ffff"], ["6", "#ff00ff"]]); expect(bar).toEqual(before);
});
it.each([false, true])("uses inset half-slot rectangles in every mode, inverted=%s", inverted => {
  for (const volumeMode of FOOTPRINT_MODES) {
    const result = paint({ volumeMode, imbalanceVisible: true, imbalanceWidth: 4 }, inverted);
    const top = inverted ? 102 : 182;
    expect(result.strokes).toEqual(volumeMode === "bid-ask-ladder"
      ? [{ rect: [62, top, 36, 15], color: "#f23645", width: 4 }, { rect: [102, top, 36, 15], color: "#089981", width: 4 }]
      : [{ rect: [62, top, 38, 15], color: "#f23645", width: 4 }, { rect: [100, top, 38, 15], color: "#089981", width: 4 }]);
  }
});
it("retains full row height beyond 40px and suppresses unusably small outlines", () => {
  expect(paint({ volumeMode: "bid-ask-ladder", imbalanceVisible: true, imbalanceWidth: 10 }, false, bar, 60).strokes.map(s => s.rect)).toEqual([[65, 545, 30, 49], [105, 545, 30, 49]]);
  expect(paint({ volumeMode: "bid-ask-ladder" }, false, bar, 60).fills.every(rect => rect[1] === 540 && rect[3] === 59)).toBe(true);
  expect(paint({ imbalanceVisible: true, imbalanceWidth: 10 }, false, bar, 10).strokes).toEqual([]);
  expect(paint({ imbalanceVisible: true }, false, bar, 20, 9).strokes).toEqual([]);
});
it("recolors centered values by ask-first flags in all modes, not by delta sign", () => {
  for (const volumeMode of FOOTPRINT_MODES) for (const cellValues of ["total", "delta", "trades"] as const) {
    const patch = { volumeMode, cellValues, imbalanceTextAskColor: "#ff00ff", imbalanceTextBidColor: "#00ffff" };
    expect(paint({ ...patch, imbalanceRecolor: true }).texts[0][1]).toBe("#ff00ff");
    expect(paint({ ...patch, imbalanceRecolor: false }).texts[0][1]).toBe("#112233");
    expect(paint({ ...patch, imbalanceRecolor: true }, false, { ...bar, levels: [{ ...row, buyImbalance: false }] }).texts[0][1]).toBe("#00ffff");
    expect(paint({ ...patch, imbalanceRecolor: true }, false, { ...bar, levels: [{ ...row, buyImbalance: false, sellImbalance: false }] }).texts[0][1]).toBe("#112233");
  }
});
it("migrates old ratio multipliers and colors before native defaults across both overlays", () => {
  for (const definitionId of ["footprint", "visible-footprint"]) {
    const indicator = { definitionId, source: "close", color: "#000000", lineWidth: 1, inputs: { imbalanceRatio: 4.5, imbalanceVisible: true, buyColor: "#123456", sellColor: "#abcdef" } } as unknown as IndicatorInstance;
    const mapped = nativeIndicatorInputs(indicator), schema = footprintOverlayInputs(definitionId === "footprint" ? "bar" : "visible");
    const merged = { ...Object.fromEntries(schema.map(input => [input.key, input.defval])), ...mapped };
    expect(resolveFootprintOverlay(definitionId === "footprint" ? "bar" : "visible", merged).style).toMatchObject({ imbalanceRatio: 4.5, imbalancePercent: 450, imbalanceVisible: true, imbalanceRecolor: true, imbalanceAskColor: "#123456", imbalanceBidColor: "#abcdef", imbalanceTextAskColor: "#123456", imbalanceTextBidColor: "#abcdef" });
    const updated = { ...indicator, inputs: { ...indicator.inputs, imbalancePercent: 750, imbalanceTextAskColor: "#fedcba", imbalanceRecolor: false } };
    expect(resolveFootprintOverlay("bar", nativeIndicatorInputs(updated)).style).toMatchObject({ imbalanceRatio: 7.5, imbalanceTextAskColor: "#fedcba", imbalanceRecolor: false });
    expect(indicator.inputs).not.toHaveProperty("imbalancePercent");
  }
});
it("resolves and strictly persists legacy and new fields in active/disabled instances and the aggregate", () => {
  const legacy = { ...defaultFootprint(), imbalanceRatio: 5, buyColor: "#123456", sellColor: "#abcdef" } as Record<string, unknown>;
  for (const key of ["imbalancePercent", "imbalanceWidth", "imbalanceAskColor", "imbalanceBidColor", "imbalanceTextAskColor", "imbalanceTextBidColor"]) delete legacy[key];
  const settings = { ...legacy, fp2Enabled: true, fp2ImbalanceRatio: 7, fp2BuyColor: "#654321", fp5Enabled: false, fp5ImbalancePercent: 10000, fp5ImbalanceWidth: 10, fp5ImbalanceAskColor: "#ff00ff", vrEnabled: true, vrImbalanceRatio: 4, vrSellColor: "#aabbcc" };
  expect(validFootprint(settings)).toBe(true);
  const saved = resolveFootprintChart(settings); expect(validFootprint(saved)).toBe(true);
  expect(saved).toMatchObject({ imbalancePercent: 500, imbalanceRatio: 5, imbalanceAskColor: "#123456", fp2ImbalancePercent: 700, fp2ImbalanceAskColor: "#654321", fp5ImbalanceRatio: 100, vrImbalancePercent: 400, vrImbalanceBidColor: "#aabbcc" });
  expect(resolveFootprintChart(saved)).toEqual(saved);
  expect(resolveFootprintInstances({ ...saved, fp5Enabled: true }).map(v => v.style.imbalanceRatio)).toEqual([5, 7, 100]);
  expect(resolveVisibleFootprint(saved).style.imbalanceRatio).toBe(4);
  for (const [key, invalid] of [["imbalancePercent", 99], ["fp2ImbalancePercent", 10001], ["fp5ImbalanceWidth", 1.5], ["vrImbalanceWidth", 11], ["fp5ImbalanceAskColor", "url(x)"]] as const)
    expect(validFootprint({ ...saved, [key]: invalid })).toBe(false);
});
it("exposes the percent domain and independent palettes in chart instances and both native studies", () => {
  const settings = footprintSettings();
  for (const rows of [settings.rows!, ...settings.instances!.map(i => i.rows), settings.subsections![0].rows]) {
    const percent = rows.find(r => "key" in r && /[Ii]mbalancePercent$/.test(r.key));
    expect(percent).toMatchObject({ kind: "number", label: "Ratio (%)", defval: 300, min: 100, max: 10000, step: 50 });
    expect(rows.some(r => "key" in r && /[Ii]mbalanceRatio$/.test(r.key))).toBe(false);
  }
  for (const kind of ["bar", "visible"] as const) {
    const inputs = footprintOverlayInputs(kind);
    for (const key of ["imbalanceAskColor", "imbalanceBidColor", "imbalanceTextAskColor", "imbalanceTextBidColor"]) expect(inputs.find(i => i.key === key)).toMatchObject({ type: "color" });
    expect(inputs.find(i => i.key === "imbalancePercent")).toMatchObject({ type: "int", min: 100, max: 10000 });
    expect(inputs.find(i => i.key === "imbalanceWidth")).toMatchObject({ type: "int", min: 1, max: 10, defval: 2 });
  }
});
