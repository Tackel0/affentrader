import { expect, it } from "vitest";
import type { Tick, FootprintLevel } from "@/types/trading";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { footprints } from "@/lib/orderflow/math";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import { footprintCellText, footprintDisplayBar, footprintSizes, FOOTPRINT_CELL_VALUES } from "@/lib/orderflow/footprintCells";
import { footprintSideCount } from "@/lib/orderflow/footprintCounts";
import { defaultFootprint, resolveFootprint, validFootprint, paintFootprintBar, footprintSettings, type FootprintPreferences } from "@/lib/orderflow/footprint";
import { createFootprintInspection, footprintInspectionCsv } from "@/lib/orderflow/footprintInspection";
const tick = (id: string, price: number, quantity: number, side: "buy" | "sell", tradeCount?: number): Tick => ({ id, symbol: "KRK:BTC/USD", time: 1000, price, quantity, side, tradeCount, simulated: false });
const source = [tick("buy0", 100, 20, "buy", 10), tick("sell0", 100, 8, "sell", 1), tick("buy1", 101, 10, "buy", 1), tick("sell1", 101, 1, "sell", 1)];
const style = { ...defaultFootprint(), rowSize: 1, candleVisible: false, imbalanceVisible: false, pocVisible: false };
const bar = () => footprints(source, "1m", 1)[0];
it("retains underlying counts independently from aggregate message count in both math paths", () => {
  const history = new FootprintHistory("1m"); history.add(source); history.add([source[0]]);
  expect(history.read({ step: 1, ratio: 3 })).toEqual(footprints(source, "1m", 1));
  expect(bar().levels.map(r => [r.buyCount, r.sellCount])).toEqual([[10, 1], [1, 1]]);
  expect(history.read({ step: 2, ratio: 3 })[0].levels[0]).toMatchObject({ buyCount: 11, sellCount: 2, buyVolume: 30, sellVolume: 9 });
});
it("poisons unknown count sides, never assumes one print per message and preserves other known sides", () => {
  const row = footprints([...source, tick("legacy", 100, 2, "buy")], "1m", 1)[0].levels[0];
  expect(footprintSideCount(row, "buy")).toBeNull(); expect(footprintSideCount(row, "sell")).toBe(1);
  expect(footprintCellText(row, "bid-ask-trades", "total")).toMatchObject({ left: "1", right: "—" });
  expect(footprintCellText(row, "trades", "total").center).toBe("—");
  expect(footprintSizes(row, true)).toEqual({ buy: null, sell: 8 });
});
it("does not overflow count precision or coerce malformed count values", () => {
  for (const count of [0, -1, 1.5, Infinity, NaN]) expect(footprintSideCount(footprints([tick("bad", 100, 1, "buy", count)], "1m", 1)[0].levels[0], "buy")).toBeNull();
  const row = footprints([tick("a", 100, 1, "buy", Number.MAX_SAFE_INTEGER), tick("b", 100, 1, "buy", 1)], "1m", 1)[0].levels[0];
  expect(row.buyCount).toBeNull(); expect(footprintSideCount(row, "sell")).toBe(0);
});
it("keeps every numeric cell mode independent from the profile's geometry mode", () => {
  const row = bar().levels[0];
  expect(footprintCellText(row, "auto", "delta")).toMatchObject({ center: "+12", sign: 1 });
  expect(footprintCellText(row, "total", "delta")).toMatchObject({ center: "28", sign: 0 });
  expect(footprintCellText(row, "bid-ask", "total")).toMatchObject({ left: "8", right: "20" });
  expect(footprintCellText(row, "trades", "bid-ask").center).toBe("11");
  expect(footprintCellText(row, "bid-ask-trades", "delta")).toMatchObject({ left: "1", right: "10" });
});
it("computes average geometry, POC and diagonals from side means while retaining raw labels and totals", () => {
  const raw = bar(), plotted = footprintDisplayBar(raw, 1, { ...style, averageTradeSize: true });
  expect(raw.poc).toBe(100); expect(plotted.poc).toBe(101);
  expect(plotted.volume).toBe(raw.volume); expect(plotted.delta).toBe(raw.delta);
  expect(plotted.levels[0]).toMatchObject({ buyVolume: 20, sellVolume: 8, buyCount: 10, sellCount: 1 });
  expect(footprintSizes(plotted.levels[0], true)).toEqual({ buy: 2, sell: 8 });
  expect(footprintDisplayBar(raw, 1, style)).toBe(raw);
  const diagonal = footprints([tick("lower", 100, 8, "sell", 8), tick("upper", 101, 9, "buy", 1)], "1m", 1)[0];
  expect(diagonal.levels[1].buyImbalance).toBe(false);
  expect(footprintDisplayBar(diagonal, 1, { ...style, averageTradeSize: true }).levels[1].buyImbalance).toBe(true);
  expect(footprintDisplayBar(footprints([tick("old", 100, 5, "buy")], "1m", 1)[0], 1, { ...style, averageTradeSize: true }).poc).toBeNaN();
});
it("does not mutate raw grids while toggling average sizing or rebuilding historical prefixes", () => {
  const history = new FootprintHistory("1m"); history.add(source.slice(0, 2)); const raw = history.read({ step: 1, ratio: 3 })[0], encoded = JSON.stringify(raw);
  footprintDisplayBar(raw, 1, { ...style, averageTradeSize: true }); expect(JSON.stringify(raw)).toBe(encoded);
  history.add(source.slice(2)); const current = history.read({ step: 1, ratio: 3 })[0];
  expect(current.levels).toHaveLength(2); expect(footprintDisplayBar(current, 1, { ...style, averageTradeSize: true }).poc).toBe(101);
});
it("renders smaller mean-size bars with unchanged raw volume text and explicit count text", () => {
  const widths: number[] = [], text: string[] = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect(_x: number, _y: number, width: number) { widths.push(width); }, fillText(s: string) { text.push(s); } } as unknown as CanvasRenderingContext2D;
  const args = { coords: { width: 500, pxPerBar: () => 100, timeToX: () => 100, priceToY: (p: number) => (110 - p) * 20 },
    bounds: { top: 0, height: 300 }, scale: {}, theme: { textColor: "#111111" } } as unknown as RendererLayerArgs;
  paintFootprintBar(ctx, args, bar(), undefined, 1, style); const rawWidths = [...widths]; widths.length = 0; text.length = 0;
  paintFootprintBar(ctx, args, footprintDisplayBar(bar(), 1, { ...style, averageTradeSize: true }), undefined, 1, { ...style, averageTradeSize: true });
  expect(widths[1]).toBeLessThan(rawWidths[1]); expect(text).toEqual(["8", "20", "1", "10"]);
  text.length = 0; paintFootprintBar(ctx, args, bar(), undefined, 1, { ...style, cellValues: "bid-ask-trades" }); expect(text).toEqual(["1", "10", "1", "1"]);
});
it("migrates legacy preferences and exposes all six labels and the average toggle", () => {
  const legacy: FootprintPreferences = { ...defaultFootprint() }; delete legacy.cellValues; delete legacy.averageTradeSize;
  expect(validFootprint(legacy)).toBe(true); expect(resolveFootprint(legacy)).toMatchObject({ cellValues: "auto", averageTradeSize: false });
  for (const cellValues of FOOTPRINT_CELL_VALUES) expect(validFootprint({ ...legacy, cellValues })).toBe(true);
  expect(validFootprint({ ...legacy, cellValues: "unknown" })).toBe(false);
  expect(validFootprint({ ...legacy, averageTradeSize: "yes" })).toBe(false);
  expect(footprintSettings().rows!.find(r => r.kind === "select" && r.key === "cellValues")).toMatchObject({ defval: "auto" });
});
it("captures count and average provenance in inspection and CSV without rewriting raw volumes", () => {
  const options = { step: 1, ratio: 3, minimumVolume: 0, ignoreZeroOpposite: false, minimumStackRows: 3, averageTradeSize: true, cellValues: "trades" as const };
  const snapshot = createFootprintInspection(footprintDisplayBar(bar(), 1, { ...style, averageTradeSize: true }), options, { symbol: "KRK:BTC/USD", timeframe: "1m", simulated: false, coverage: "Partial" });
  expect(snapshot.rows[0]).toMatchObject({ bid: 8, ask: 20, bidCount: 1, askCount: 10, bidAverage: 8, askAverage: 2 });
  expect(footprintInspectionCsv(snapshot)).toContain('"bid_trade_count","ask_trade_count"'); expect(snapshot.settings).toEqual(options);
});
