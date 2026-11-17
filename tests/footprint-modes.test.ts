import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { FOOTPRINT_MODES, FOOTPRINT_MODE_OPTIONS, footprintModeRects, footprintIntensity } from "@/lib/orderflow/footprintModes";
import { defaultFootprint, resolveFootprint, validFootprint, footprintSettings, paintFootprintBar, type FootprintPreferences } from "@/lib/orderflow/footprint";
import { footprintCellText } from "@/lib/orderflow/footprintCells";
import type { FootprintBar } from "@/types/trading";
import { createFootprintInspection, footprintInspectionCsv } from "@/lib/orderflow/footprintInspection";
const style = { ...defaultFootprint(), gradientCells: false, candleVisible: false, pocVisible: false, imbalanceVisible: false };
it("offers the five reference modes and migrates legacy mono volume profiles", () => {
  expect(FOOTPRINT_MODE_OPTIONS.map(option => option[1])).toEqual(["Bid × Ask Profile", "Bid × Ask Ladder", "Volume Profile", "Delta Profile", "Absolute Delta"]);
  for (const volumeMode of FOOTPRINT_MODES) expect(validFootprint({ ...style, volumeMode })).toBe(true);
  const legacy: FootprintPreferences = { ...style, volumeMode: "total" }; delete legacy.volumeSplit;
  expect(validFootprint(legacy)).toBe(true); expect(resolveFootprint(legacy).volumeSplit).toBe(false);
  expect(resolveFootprint({}).volumeSplit).toBe(true); expect(defaultFootprint().volumeSplit).toBe(true);
  expect(footprintSettings().rows!.find(r => r.kind === "select" && r.key === "volumeMode")).toMatchObject({ label: "Display mode", options: FOOTPRINT_MODE_OPTIONS });
});
it("paints fixed-width Ladder cells and side-dependent intensity instead of proportional widths", () => {
  const ladder = footprintModeRects("bid-ask-ladder", 8, 2, 8, 100, 40, style, "#000000");
  expect(ladder).toEqual([{ x: 60, width: 40, color: style.sellColor, alpha: .62 }, { x: 100, width: 40, color: style.buyColor, alpha: .62 }]);
  expect(footprintModeRects("bid-ask", 8, 2, 8, 100, 40, style, "#000000").map(r => [r.x, r.width])).toEqual([[90, 10], [100, 40]]);
  const faded = footprintModeRects("bid-ask-ladder", 8, 2, 8, 100, 40, { ...style, gradientCells: true }, "#000000");
  expect(faded[0].color).not.toBe(style.sellColor); expect(faded[0].width).toBe(40);
});
it("normalizes Absolute Delta by magnitude and anchors both signs at the left edge", () => {
  expect(footprintModeRects("absolute-delta", 2, 8, 6, 100, 40, style, "#000000")).toEqual([{ x: 60, width: 80, color: style.sellColor, alpha: .62 }]);
  expect(footprintModeRects("absolute-delta", 5, 2, 6, 100, 40, style, "#000000")).toEqual([{ x: 60, width: 40, color: style.buyColor, alpha: .62 }]);
  expect(footprintModeRects("delta", 2, 8, 6, 100, 40, style, "#000000")[0]).toMatchObject({ x: 60, width: 40 });
  expect(footprintModeRects("absolute-delta", 8, 8, 6, 100, 40, style, "#000000")).toEqual([]);
});
it("splits volume into adjacent Sell/Buy segments with the combined row width", () => {
  const rects = footprintModeRects("total", 8, 2, 20, 100, 40, style, "#000000");
  expect(rects).toEqual([{ x: 60, width: 8, color: style.sellColor, alpha: .62 }, { x: 68, width: 32, color: style.buyColor, alpha: .62 }]);
  expect(footprintModeRects("total", 8, 0, 8, 100, 40, style, "#000000")).toHaveLength(1);
});
it("interpolates the mono ramp with alpha and supports light/dark theme defaults", () => {
  const mono = { ...style, volumeSplit: false, gradientCells: true, monoLowColor: "#00000080", monoHighColor: "#ffffff80" };
  expect(footprintModeRects("total", 5, 0, 10, 100, 40, mono, "#000000")[0]).toMatchObject({ color: "rgba(128,128,128,0.5019607843137255)", width: 40 });
  expect(footprintModeRects("total", 5, 0, 10, 100, 40, { ...mono, gradientCells: false }, "#000000")[0].color).toBe("rgba(128,128,128,0.5019607843137255)");
  expect(footprintModeRects("total", 5, 0, 10, 100, 40, { ...style, volumeSplit: false }, "#ffffff")[0].color)
    .not.toBe(footprintModeRects("total", 5, 0, 10, 100, 40, { ...style, volumeSplit: false }, "#000000")[0].color);
  expect(footprintIntensity("#ffffff80", 0, true, "#000000")).toBe("rgba(89,89,89,0.5019607843137255)");
});
it("keeps Auto and overridden raw cell values independent of the new geometry", () => {
  const row = { price: 100, buyVolume: 2, sellVolume: 8, buyCount: 1, sellCount: 4, imbalance: null } as const;
  expect(footprintCellText(row, "auto", "bid-ask-ladder")).toMatchObject({ left: "8", right: "2" });
  expect(footprintCellText(row, "auto", "absolute-delta")).toMatchObject({ center: "-6", sign: -1 });
  expect(footprintCellText(row, "trades", "absolute-delta")).toMatchObject({ center: "5", sign: 0 });
  for (const mode of FOOTPRINT_MODES) {
    expect(footprintModeRects(mode, 0, 0, 0, 100, 40, style, "#000000")).toEqual([]);
    expect(footprintModeRects(mode, 1, 2, 2, 100, 40, { ...style, histogramVisible: false }, "#000000")).toEqual([]);
  }
});
it.each([false, true])("paints normalized absolute bars and full Ladder cells on the real canvas path, inverted=%s", invert => {
  const fills: number[][] = [], texts: string[] = [], outlines: number[][] = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect(...v: number[]) { fills.push(v); }, strokeRect(...v: number[]) { outlines.push(v); }, fillText(s: string) { texts.push(s); } } as unknown as CanvasRenderingContext2D;
  const args = { coords: { width: 500, pxPerBar: () => 100, timeToX: () => 100, priceToY: (p: number) => invert ? p * 20 - 1900 : 2200 - p * 20 }, bounds: { top: 0, height: 300 }, scale: {}, theme: { background: "#000000", textColor: "#eeeeee" } } as unknown as RendererLayerArgs;
  const bar: FootprintBar = { time: 0, volume: 17, delta: -3, poc: 100, levels: [{ price: 100, upperPrice: 101, buyVolume: 2, sellVolume: 8, imbalance: null }, { price: 101, upperPrice: 102, buyVolume: 5, sellVolume: 2, imbalance: null }] };
  paintFootprintBar(ctx, args, bar, undefined, 1, { ...style, volumeMode: "absolute-delta" });
  expect(fills.map(r => [r[0], r[2]])).toEqual([[67, 74], [67, 37]]); expect(texts).toEqual(["-6", "+3"]);
  fills.length = 0; texts.length = 0; bar.levels[0].sellImbalance = true;
  paintFootprintBar(ctx, args, bar, undefined, 1, { ...style, volumeMode: "bid-ask-ladder", imbalanceVisible: true });
  expect(fills.every(r => r[2] === 37)).toBe(true); expect(outlines).toHaveLength(1); expect(texts).toEqual(["8", "2", "2", "5"]);
});
it("captures mode and split provenance without altering observed volume", () => {
  const bar: FootprintBar = { time: 0, volume: 10, delta: -6, poc: 100, levels: [{ price: 100, upperPrice: 101, buyVolume: 2, sellVolume: 8, imbalance: null }] };
  const settings = { step: 1, ratio: 3, minimumVolume: 0, ignoreZeroOpposite: false, minimumStackRows: 3, volumeMode: "absolute-delta" as const, volumeSplit: true };
  const snapshot = createFootprintInspection(bar, settings, { symbol: "BTCUSDT", timeframe: "1m", simulated: false, coverage: "Partial" });
  expect(snapshot.settings).toEqual(settings); expect(snapshot.volume).toBe(10);
  expect(footprintInspectionCsv(snapshot)).toContain('"display_mode","volume_buy_sell_split"');
});
