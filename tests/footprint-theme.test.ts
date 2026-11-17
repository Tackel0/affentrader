import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { defaultFootprint, footprintSettings, paintFootprintBar, resolveFootprintChart, resolveFootprintInstances, resolveVisibleFootprint, validFootprint } from "@/lib/orderflow/footprint";
import { footprintTextColor } from "@/lib/orderflow/footprintTheme";
import { footprintOverlayInputs, footprintOverlayInputVisible } from "@/lib/orderflow/footprintOverlay";
import { FOOTPRINT_MODES } from "@/lib/orderflow/footprintModes";
import { explicitPickerColor } from "@/lib/chart/colorPickerEnhancement";
import { footprintPocColor } from "@/lib/orderflow/footprintStructure";
import { nativeIndicatorInputs } from "@/lib/indicators/nativeInputs";
import type { IndicatorInstance } from "@/types/trading";
it("retains explicit choices equal to default colors through settings, studies and theme changes", () => {
  const text = explicitPickerColor("#d1d4dc"), poc = explicitPickerColor("#ffffff");
  const saved = resolveFootprintChart({ ...defaultFootprint(), textColor: text, pocColor: poc, fp5Enabled: false, fp5TextColor: text, fp5PocColor: poc, vrTextColor: text, vrPocColor: poc });
  expect(validFootprint(saved)).toBe(true);
  for (const style of [...resolveFootprintInstances({ ...saved, fp5Enabled: true }).map(i => i.style), resolveVisibleFootprint(saved).style]) for (const background of ["#000000", "#ffffff"]) {
    expect(footprintTextColor(style, { background, textColor: "#abcdef" })).toBe(text); expect(footprintPocColor(style.pocColor, background)).toBe(poc);
  }
  for (const definitionId of ["footprint", "visible-footprint"]) {
    const indicator = { definitionId, inputs: { textColor: text, pocColor: poc }, source: "close", color: "#123456", lineWidth: 1 } as unknown as IndicatorInstance;
    expect(nativeIndicatorInputs(indicator)).toMatchObject({ textColor: text, pocColor: poc });
  }
});
it("uses the reference palette by default instead of an unrelated chart theme text override", () => {
  const style = defaultFootprint(); expect(style.textColorAuto).toBe(false);
  for (const [background, expected] of [["#000000", "#d1d4dc"], ["#ffffff", "#2a2e39"], ["#777777", "#d1d4dc"], ["#808080", "#2a2e39"]]) expect(footprintTextColor(style, { background, textColor: "#ff00ff" })).toBe(expected);
});
it("preserves custom alpha colors and the explicit legacy chart-theme preference", () => {
  for (const background of ["#000000", "#ffffff"]) {
    expect(footprintTextColor({ textColor: "#11223380", textColorAuto: false }, { background, textColor: "#abcdef" })).toBe("#11223380");
    expect(footprintTextColor({ textColor: "#11223380", textColorAuto: true }, { background, textColor: "#abcdef" })).toBe("#abcdef");
  }
});
it("retains independent saved theme/custom choices across disabled instances and the visible aggregate", () => {
  const saved = resolveFootprintChart({ ...defaultFootprint(), textColorAuto: true, fp2Enabled: true, fp2TextColorAuto: false, fp2TextColor: "#11223380", fp5Enabled: false, fp5TextColorAuto: true, vrEnabled: true, vrTextColorAuto: false, vrTextColor: "#44556680" });
  expect(validFootprint(saved)).toBe(true); expect(resolveFootprintChart(saved)).toEqual(saved);
  expect(resolveFootprintInstances({ ...saved, fp5Enabled: true }).map(i => i.style.textColorAuto)).toEqual([true, false, true]);
  expect(resolveVisibleFootprint(saved).style).toMatchObject({ textColorAuto: false, textColor: "#44556680" });
});
it("exposes the custom picker in Values and hides it when the explicit theme override is enabled", () => {
  const settings = footprintSettings(), rows = settings.rows!;
  const at = rows.findIndex(row => row.kind === "color" && row.key === "textColor");
  const heading = rows.slice(0, at).filter(row => row.kind === "heading").at(-1); expect(heading).toMatchObject({ label: "Values" });
  expect(rows[at]).toMatchObject({ when: { key: "textColorAuto", equals: false } });
  expect(settings.instances![4].rows.find(row => "key" in row && row.key === "fp5TextColor")).toMatchObject({ when: { key: "fp5TextColorAuto", equals: false } });
  expect(settings.subsections![0].rows.find(row => "key" in row && row.key === "vrTextColor")).toMatchObject({ when: { key: "vrTextColorAuto", equals: false } });
  for (const kind of ["bar", "visible"] as const) {
    expect(footprintOverlayInputs(kind).find(i => i.key === "textColorAuto")).toMatchObject({ defval: false, group: "Values" });
    expect(footprintOverlayInputVisible(kind, "textColor", { textColorAuto: true })).toBe(false);
    expect(footprintOverlayInputVisible(kind, "textColor", { textColorAuto: false })).toBe(true);
  }
});
it("paints custom ink in every mode without changing raw values or imbalance recoloring", () => {
  for (const volumeMode of FOOTPRINT_MODES) {
    const texts: Array<[string, string]> = [], ctx = { fillStyle: "", save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {}, fillRect() {}, fillText(text: string) { texts.push([text, this.fillStyle]); } };
    const args = { coords: { width: 600, pxPerBar: () => 200, timeToX: () => 200, priceToY: (p: number) => (110 - p) * 30 }, bounds: { top: 0, height: 600 }, scale: {}, theme: { background: "#ffffff", textColor: "#abcdef", fontFamily: "Arial" } } as unknown as RendererLayerArgs;
    const source = { time: 0, volume: 10, delta: 6, poc: 100, levels: [{ price: 100, upperPrice: 101, buyVolume: 8, sellVolume: 2, buyImbalance: true, sellImbalance: false, imbalance: "buy" as const }] }, before = structuredClone(source);
    const style = { ...defaultFootprint(), volumeMode, candleVisible: false, valueAreaVisible: false, pocVisible: false, textAutoSize: false, textColor: "#11223380" };
    paintFootprintBar(ctx as unknown as CanvasRenderingContext2D, args, source, undefined, 1, style, { width: 160, offset: 0, within: true });
    expect(texts.length).toBeGreaterThan(0); expect(texts.every(([, color]) => color === "#11223380")).toBe(true); expect(source).toEqual(before);
    texts.length = 0; paintFootprintBar(ctx as unknown as CanvasRenderingContext2D, args, source, undefined, 1, { ...style, imbalanceRecolor: true, imbalanceTextAskColor: "#998877" }, { width: 160, offset: 0, within: true });
    expect(texts.at(-1)?.[1]).toBe("#998877");
  }
});
