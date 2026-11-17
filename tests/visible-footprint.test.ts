import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import { defaultFootprint, footprintSettings, resolveFootprintChart, resolveFootprintInstances, resolveVisibleFootprint, validFootprint } from "@/lib/orderflow/footprint";
import { paintVisibleFootprint, readVisibleFootprint, visibleFootprintPlacement, visibleFootprintTimes } from "@/lib/orderflow/visibleFootprint";
import { footprintRowAtPoint } from "@/lib/orderflow/footprintHover";
import { clearFootprintSurface, publishFootprintSurface, readFootprintSurface } from "@/lib/orderflow/footprintReadout";
const tick = (id: string, time: number, price: number, quantity: number, side: "buy" | "sell", tradeCount?: number): Tick => ({ id, symbol: "FIXTURE", time, price, quantity, side, simulated: true, tradeCount });
const trades = [tick("a", 1, 100, 20, "buy", 10), tick("b", 2, 100, 2, "sell", 1), tick("c", 60001, 100, 10, "buy", 1), tick("d", 60002, 101, 3, "sell", 1), tick("e", 180001, 102, 5, "buy", 1)];
const args = (from = 0, to = 3) => ({ settings: { vrEnabled: true, vrRowSize: 1 }, priceStyle: "footprint", bars: [0, 60000, 120000, 180000].map(time => ({ time, open: 100, close: 102, high: 103, low: 99, volume: 50 })),
  coords: { width: 500, pxPerBar: () => 4, visibleLogicalRange: () => ({ from, to }), timeToX: (time: number) => time / 1000, priceToY: (price: number) => (110 - price) * 20 }, scale: { min: 95, max: 110 }, bounds: { top: 0, height: 400 }, theme: { background: "#fff", textColor: "#111" } }) as unknown as RendererLayerArgs;
const history = () => { const value = new FootprintHistory("1m"); value.add(trades); return value; };
it("aggregates the deduplicated raw tape on an independent sixth grid", () => {
  const h = history(); h.add(trades);
  for (let i = 0; i < 5; i++) h.read({ step: i + 1, ratio: 3 }, `fp${i + 1}`);
  const bar = h.readVisible({ step: 1, ratio: 3 }, [0, 60000])!;
  expect(bar.volume).toBe(35); expect(bar.delta).toBe(25);
  expect(bar.levels).toMatchObject([{ price: 100, buyVolume: 30, sellVolume: 2, buyCount: 11, sellCount: 1 }, { price: 101, buyVolume: 0, sellVolume: 3, sellCount: 1 }]);
  expect(h.coverage.trades).toBe(5);
  expect(h.readVisible({ step: 1, ratio: 3 }, [60000, 0, 0])).toBe(bar);
});
it("selects partial edge slots, rejects empty/offscreen ranges and gates completed Replay candles", () => {
  expect(visibleFootprintTimes(args(.2, 1.2), "1m")).toEqual([0, 60000, 120000]);
  expect(visibleFootprintTimes(args(0, 3), "1m", 120000)).toEqual([0, 60000]);
  expect(visibleFootprintTimes(args(0, 3), "1m", NaN)).toEqual([]);
  for (const [from, to] of [[-5, -2], [9, 10], [2, 1], [NaN, 2]]) expect(visibleFootprintTimes(args(from, to), "1m")).toEqual([]);
});
it("recalculates means and filters after aggregation, never sums per-bar means", () => {
  const a = args(0, 1); a.settings = { vrEnabled: true, vrRowSize: 1, vrAverageTradeSize: true, vrMinAskVolume: 2.5, vrMaxAskVolume: 3 };
  const result = readVisibleFootprint(history(), a, "1m")!;
  expect(result.bar!.levels[0]).toMatchObject({ buyVolume: 30, buyCount: 11, filtered: false }); // 30 / 11; not 2 + 10.
  expect(result.style.averageTradeSize).toBe(true);
  expect(result.bar!.volume).toBe(35);
  a.settings = { ...a.settings, vrMinAskVolume: 3 };
  expect(readVisibleFootprint(history(), a, "1m")!.bar!.levels[0].filtered).toBe(true);
});
it("poisons unknown constituent counts while keeping raw side volumes", () => {
  const h = history(); h.add([tick("legacy", 70000, 100, 4, "buy")]);
  expect(h.readVisible({ step: 1, ratio: 3 }, [0, 60000])!.levels[0]).toMatchObject({ buyVolume: 34, buyCount: null, sellVolume: 2, sellCount: 1 });
});
it("invalidates visible aggregation on late observations, regrids, source changes and whole-bar eviction", () => {
  const h = history(), first = h.readVisible({ step: 1, ratio: 3 }, [0, 60000]);
  h.add([tick("late", 3, 100, 1, "sell", 1)]);
  expect(h.readVisible({ step: 1, ratio: 3 }, [0, 60000])!.volume).toBe(first!.volume + 1);
  expect(h.readVisible({ step: 2, ratio: 3 }, [0, 60000])!.levels).toHaveLength(1);
  h.add([{ ...tick("new-source", 240001, 105, 7, "buy", 1), simulated: false }]);
  expect(h.readVisible({ step: 1, ratio: 3 }, [0, 60000])).toBeNull();
  const small = new FootprintHistory("1m", { trades: 4, bars: 2, rows: 20 }); small.add(trades);
  expect(small.readVisible({ step: 1, ratio: 3 }, [0])).toBeNull();
});
it("reports only selected observed candles and never invents volume for missing intervals", () => {
  const frame = readVisibleFootprint(history(), args(1, 2), "1m")!;
  expect(frame).toMatchObject({ first: 60000, last: 120000, candles: 2, observedCandles: 1 });
  expect(frame.bar?.volume).toBe(13);
  expect(readVisibleFootprint(history(), args(2, 2), "1m")?.bar).toBeNull();
});
it("stays pinned with a fixed pixel width while per-bar zoom changes", () => {
  const a = args(), frame = readVisibleFootprint(history(), a, "1m")!;
  expect(frame.placement?.width).toBe(150);
  const b = { ...a, coords: { ...a.coords, timeToX: () => -9000, pxPerBar: () => 1 } } as unknown as RendererLayerArgs;
  const placement = visibleFootprintPlacement(b, 0, 30)!;
  expect(placement.width).toBe(150); expect(-9000 + placement.offset + placement.width / 2).toBe(492);
  expect(visibleFootprintPlacement({ ...a, coords: { ...a.coords, width: 40 } } as unknown as RendererLayerArgs, 0, 30)).toBeUndefined();
});
it.each([false, true])("paints detailed rows even at one-pixel candle zoom on inverted=%s", inverted => {
  const a = args(); if (inverted) a.coords.priceToY = (price: number) => (price - 95) * 20;
  const frame = readVisibleFootprint(history(), a, "1m")!, text: string[] = [], fills: number[][] = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {}, fillRect(...v: number[]) { fills.push(v); }, fillText(value: string) { text.push(value); } } as unknown as CanvasRenderingContext2D;
  paintVisibleFootprint(ctx, a, frame);
  expect(text).toContain("30"); expect(text).toContain("Visible range · partial executions"); expect(fills.length).toBeGreaterThan(0);
  const y = inverted ? 110 : 190;
  const hit = footprintRowAtPoint(a, [{ id: "vr", label: "Visible range", bars: [frame.bar!], step: frame.step, style: frame.style, placement: frame.placement }], 420, y);
  expect(hit?.lower).toBe(100);
});
it("retains dense manual-row histograms and hover while suppressing unreadable numeric labels", () => {
  const a = args(); a.coords.priceToY = (price: number) => 110 - price;
  const frame = readVisibleFootprint(history(), a, "1m")!, text: string[] = [], fills: number[][] = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {}, fillRect(...v: number[]) { fills.push(v); }, fillText(value: string) { text.push(value); } } as unknown as CanvasRenderingContext2D;
  paintVisibleFootprint(ctx, a, frame);
  expect(fills.length).toBeGreaterThan(0); expect(fills.every(rect => rect[3] <= 1)).toBe(true);
  expect(text).toEqual(["Visible range · partial executions"]);
  expect(footprintRowAtPoint(a, [{ id: "vr", label: "Visible range", bars: [frame.bar!], style: frame.style, step: 1, placement: frame.placement }], 420, 9.5)?.lower).toBe(100);
});
it("strictly validates independent visible settings and excludes per-candle projections", () => {
  const value = { ...defaultFootprint(), vrEnabled: true, vrWidthPercent: 45, vrRowSize: 2, vrVolumeMode: "absolute-delta", vrImbalanceRecolor: false, vrBuyColor: "#12345680", fp2Enabled: true };
  expect(validFootprint(value)).toBe(true);
  expect(resolveFootprintChart(value)).toMatchObject(value);
  expect(resolveFootprintInstances(value)).toHaveLength(2);
  expect(resolveVisibleFootprint(value)).toMatchObject({ enabled: true, widthPercent: 45, style: { rowSize: 2, volumeMode: "absolute-delta", candleVisible: false, stackedVisible: false, unfinishedVisible: false, pocExtend: false } });
  for (const invalid of [{ vrEnabled: 1 }, { vrWidthPercent: 91 }, { vrWidthPercent: NaN }, { vrMinVolume: -1 }, { vrBuyColor: "bad" }, { vrPocExtend: true }, { vrStackedVisible: true }, { vrUnfinishedVisible: true }]) expect(validFootprint({ ...value, ...invalid })).toBe(false);
  const schema = footprintSettings(); expect(schema.instances).toHaveLength(5);
  const visible = schema.subsections![0]; expect(visible).toMatchObject({ title: "Visible range", enableKey: "vrEnabled" });
  expect(visible.rows.some(row => "key" in row && row.key === "vrPocExtend")).toBe(false);
  expect(visible.rows.find(row => "key" in row && row.key === "vrVolumeSplit")).toMatchObject({ when: { key: "vrVolumeMode", equals: "total" } });
});
it("publishes truthful independent range totals in the existing source-fenced data window", () => {
  const token = Symbol(), h = history(), frame = readVisibleFootprint(h, args(), "1m")!;
  publishFootprintSurface("visible-test", token, { symbol: "FIXTURE", timeframe: "1m", epoch: 1, bars: h.read({ step: 1, ratio: 3 }), simulated: true, dropped: 0, visibleRange: frame });
  const read = readFootprintSurface("visible-test", { symbol: "FIXTURE", timeframe: "1m", epoch: 1, replay: false }, 0);
  expect(read.rows.find(row => row.label === "Visible range source")?.value).toContain("3/4 selected candles");
  expect(read.rows.find(row => row.label === "Visible range total / delta")?.value).toBe("40 / 30");
  clearFootprintSurface("visible-test", token);
});
