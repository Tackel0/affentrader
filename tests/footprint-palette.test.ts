import { expect, it } from "vitest";
import { defaultFootprint, resolveFootprint, resolveFootprintChart, resolveFootprintInstances, resolveVisibleFootprint, validFootprint, footprintSettings } from "@/lib/orderflow/footprint";
import { footprintModeRects, FOOTPRINT_MODES } from "@/lib/orderflow/footprintModes";
import { footprintOverlayInputVisible, footprintOverlayInputs, resolveFootprintOverlay } from "@/lib/orderflow/footprintOverlay";
import { nativeIndicatorInputs } from "@/lib/indicators/nativeInputs";
import type { IndicatorInstance } from "@/types/trading";
const palette = { bidColor: "#112233", askColor: "#223344", volumeBuyColor: "#334455", volumeSellColor: "#445566", deltaUpColor: "#556677", deltaDownColor: "#667788" };
const style = { ...defaultFootprint(), ...palette, gradientCells: false, buyColor: "#ff0000", sellColor: "#00ff00", imbalanceAskColor: "#0000ff", imbalanceBidColor: "#ff00ff" };
it("selects six mode-specific colors independently from candles and imbalance palettes", () => {
  for (const mode of ["bid-ask", "bid-ask-ladder"] as const) expect(footprintModeRects(mode, 8, 2, 8, 100, 40, style, "#000000").map(r => r.color)).toEqual([palette.bidColor, palette.askColor]);
  expect(footprintModeRects("total", 8, 2, 20, 100, 40, style, "#000000").map(r => r.color)).toEqual([palette.volumeSellColor, palette.volumeBuyColor]);
  for (const mode of ["delta", "absolute-delta"] as const) {
    expect(footprintModeRects(mode, 8, 2, 6, 100, 40, style, "#000000")[0].color).toBe(palette.deltaUpColor);
    expect(footprintModeRects(mode, 2, 8, 6, 100, 40, style, "#000000")[0].color).toBe(palette.deltaDownColor);
  }
});
it("applies gradient alpha to the selected mode color while mono remains a volume ramp", () => {
  const alpha = { ...style, deltaUpColor: "#ffffff80", gradientCells: true };
  expect(footprintModeRects("delta", 1, 0, 2, 100, 40, alpha, "#000000")[0].color).toBe("rgba(172,172,172,0.5019607843137255)");
  const mono = { ...style, volumeSplit: false, monoLowColor: "#00000080", monoHighColor: "#ffffff80" };
  for (const gradientCells of [true, false]) expect(footprintModeRects("total", 1, 0, 2, 100, 40, { ...mono, gradientCells }, "#000000")[0].color).toBe("rgba(128,128,128,0.5019607843137255)");
});
it("migrates old shared colors without overwriting any independent explicit field", () => {
  const legacy = { ...defaultFootprint(), buyColor: "#12345680", sellColor: "#abcdef" } as Record<string, unknown>;
  for (const key of Object.keys(palette)) delete legacy[key];
  expect(resolveFootprint(legacy)).toMatchObject({ bidColor: "#abcdef", askColor: "#12345680", volumeBuyColor: "#12345680", volumeSellColor: "#abcdef", deltaUpColor: "#12345680", deltaDownColor: "#abcdef" });
  expect(resolveFootprint({ ...legacy, askColor: "#999999", deltaUpColor: "#888888" })).toMatchObject({ askColor: "#999999", deltaUpColor: "#888888", volumeBuyColor: "#12345680" });
});
it("migrates before SDK defaults for both overlays without mutating saved inputs", () => {
  for (const kind of ["bar", "visible"] as const) {
    const indicator = { definitionId: kind === "bar" ? "footprint" : "visible-footprint", source: "close", color: "#000000", lineWidth: 1, inputs: { buyColor: "#123456", sellColor: "#abcdef", volumeBuyColor: "#fedcba" } } as unknown as IndicatorInstance;
    const inputs = { ...Object.fromEntries(footprintOverlayInputs(kind).map(i => [i.key, i.defval])), ...nativeIndicatorInputs(indicator) };
    expect(resolveFootprintOverlay(kind, inputs).style).toMatchObject({ askColor: "#123456", bidColor: "#abcdef", volumeBuyColor: "#fedcba", volumeSellColor: "#abcdef", deltaUpColor: "#123456", deltaDownColor: "#abcdef" });
    expect(indicator.inputs).not.toHaveProperty("askColor");
  }
});
it("round-trips independent active/disabled instance and range palettes strictly", () => {
  const settings = { ...defaultFootprint(), ...palette, fp2Enabled: true, fp2AskColor: "#123456", fp2VolumeSellColor: "#abcdef", fp5Enabled: false, fp5DeltaDownColor: "#654321", vrEnabled: true, vrVolumeBuyColor: "#fedcba" };
  expect(validFootprint(settings)).toBe(true); const saved = resolveFootprintChart(settings);
  expect(validFootprint(saved)).toBe(true); expect(resolveFootprintChart(saved)).toEqual(saved);
  expect(resolveFootprintInstances({ ...saved, fp5Enabled: true }).map(i => i.style.deltaDownColor)).toEqual([palette.deltaDownColor, "#f23645", "#654321"]);
  expect(resolveVisibleFootprint(saved).style.volumeBuyColor).toBe("#fedcba");
  for (const key of ["askColor", "fp2VolumeSellColor", "fp5DeltaDownColor", "vrVolumeBuyColor"]) for (const value of [null, 1, "url(x)"]) expect(validFootprint({ ...saved, [key]: value })).toBe(false);
});
it("gates the native study palettes by display mode and volume split", () => {
  const groups = { "bid-ask": ["bidColor", "askColor"], "bid-ask-ladder": ["bidColor", "askColor"], total: ["volumeBuyColor", "volumeSellColor"], delta: ["deltaUpColor", "deltaDownColor"], "absolute-delta": ["deltaUpColor", "deltaDownColor"] };
  for (const kind of ["bar", "visible"] as const) for (const volumeMode of FOOTPRINT_MODES) for (const key of Object.keys(palette))
    expect(footprintOverlayInputVisible(kind, key, { volumeMode, volumeSplit: true })).toBe(groups[volumeMode].includes(key));
  for (const kind of ["bar", "visible"] as const) {
    expect(footprintOverlayInputVisible(kind, "volumeBuyColor", { volumeMode: "total", volumeSplit: false })).toBe(false);
    expect(footprintOverlayInputVisible(kind, "monoLowColor", { volumeMode: "total", volumeSplit: false })).toBe(true);
  }
  const fifth = footprintSettings().instances![4].rows.find(r => "key" in r && r.key === "fp5DeltaDownColor");
  expect(fifth).toMatchObject({ kind: "color", when: { key: "fp5VolumeMode", anyOf: ["delta", "absolute-delta"] } });
});
