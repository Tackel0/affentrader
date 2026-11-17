import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar, OHLCV, Tick } from "@/types/trading";
import { unfinishedAuctionRows, createUnfinishedAuctionCache, paintUnfinishedAuctions } from "@/lib/orderflow/unfinishedAuctions";
import { defaultFootprint, resolveFootprint, validFootprint, footprintSettings } from "@/lib/orderflow/footprint";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import { publishFootprintSurface, readFootprintSurface, clearFootprintSurface } from "@/lib/orderflow/footprintReadout";
const start = Date.UTC(2026, 10, 4), minute = 60000;
const candle = (offset: number, low = 100, high = 103): OHLCV => ({ time: start + offset * minute, open: low, close: high, low, high, volume: 1 });
const footprint = (offset = 0, buy = 2, sell = 3): FootprintBar => ({ time: start + offset * minute, poc: 100, volume: buy + sell, delta: buy - sell,
  levels: [{ price: 100, upperPrice: 101, buyVolume: buy, sellVolume: sell, imbalance: null },
    { price: 102, upperPrice: 103, buyVolume: buy, sellVolume: sell, imbalance: null }] });
const settings = { ...defaultFootprint(), unfinishedVisible: true };
it("ignores compact-label dust even with a zero minimum and keeps exact threshold equality", () => {
  expect(unfinishedAuctionRows(footprint(0, .0049, 2), 1, 0)).toEqual([]);
  expect(unfinishedAuctionRows(footprint(0, .005, .005), 1, .005)).toHaveLength(2);
  expect(unfinishedAuctionRows(footprint(0, .005, .005), 1, .006)).toEqual([]);
});
it("finds true extrema regardless of input order and retains filtered raw observations", () => {
  const bar = footprint(); bar.levels.reverse(); bar.levels[0].filtered = true;
  expect(unfinishedAuctionRows(bar, 1, 0).map(r => [r.side, r.price])).toEqual([["high", 103], ["low", 100]]);
  bar.levels = [bar.levels[0]];
  expect(unfinishedAuctionRows(bar, 1, 0).map(r => r.side)).toEqual(["high", "low"]);
});
it("keeps the one-pixel row gap, omits collapsed outlines and paints low last on a single row", () => {
  const boxes: unknown[][] = [], colors: string[] = [];
  const ctx = { save() {}, restore() {}, strokeStyle: "", strokeRect(this: { strokeStyle: string }, ...v: number[]) { boxes.push([this.strokeStyle, ...v]); }, beginPath() {}, moveTo() {}, lineTo() {}, stroke(this: { strokeStyle: string }) { colors.push(this.strokeStyle); } } as unknown as CanvasRenderingContext2D;
  const bar = footprint(); bar.levels = [bar.levels[0]];
  const refs = createUnfinishedAuctionCache().read([bar], [candle(0)], "1m", 1, 0);
  const args = { coords: { width: 500, pxPerBar: () => 100, timeToX: () => 100, priceToY: (p: number) => (110 - p) * 10 }, bounds: { top: 0, height: 300 }, scale: {} } as unknown as RendererLayerArgs;
  paintUnfinishedAuctions(ctx, args, refs, { ...settings, unfinishedWidth: 2 }, { width: 40, offset: 0, within: true });
  expect(boxes).toEqual([[settings.unfinishedHighColor, 81, 91, 38, 7], [settings.unfinishedLowColor, 81, 91, 38, 7]]);
  expect(colors).toEqual([settings.unfinishedHighColor, settings.unfinishedLowColor]); boxes.length = 0;
  paintUnfinishedAuctions(ctx, args, refs, { ...settings, unfinishedWidth: 2 }, { width: 2, offset: 0, within: true }); expect(boxes).toEqual([]);
  paintUnfinishedAuctions(ctx, { ...args, coords: { ...args.coords, priceToY: (p: number) => (110 - p) * 3 } } as unknown as RendererLayerArgs, refs, { ...settings, unfinishedWidth: 2 }, { width: 40, offset: 0, within: true }); expect(boxes).toEqual([]);
});
it("requires actual volume on both outer rows and uses high/low outer edges", () => {
  expect(unfinishedAuctionRows(footprint(), 1, 0).map(r => [r.side, r.price])).toEqual([["high", 103], ["low", 100]]);
  expect(unfinishedAuctionRows(footprint(0, 0), 1, 0)).toEqual([]);
  expect(unfinishedAuctionRows(footprint(0, 2, 1), 1, 2)).toEqual([]);
  expect(unfinishedAuctionRows(footprint(0, 2, 2), 1, 2)).toHaveLength(2);
  expect(unfinishedAuctionRows({ ...footprint(), levels: [] }, 1, 0)).toEqual([]);
});
it("does not promote a two-sided interior row when an extreme is one-sided", () => {
  const bar = footprint(); bar.levels[0].sellVolume = 0;
  bar.levels.splice(1, 0, { price: 101, upperPrice: 102, buyVolume: 100, sellVolume: 100, imbalance: null });
  expect(unfinishedAuctionRows(bar, 1, 0).map(r => r.side)).toEqual(["high"]);
});
it("recomputes auction flags on merged display rows and exact canonical boundaries", () => {
  const history = new FootprintHistory("1m");
  history.add([{ id: "a", symbol: "BTCUSDT", time: start + 1, price: .1, quantity: 2, side: "buy", simulated: false },
    { id: "b", symbol: "BTCUSDT", time: start + 2, price: .2, quantity: 3, side: "sell", simulated: false }] as Tick[]);
  expect(unfinishedAuctionRows(history.read({ step: .1, ratio: 3 })[0], .1, 0)).toEqual([]);
  const merged = unfinishedAuctionRows(history.read({ step: .3, ratio: 3 })[0], .3, 0);
  expect(merged.map(r => [r.side, r.price, r.buy, r.sell])).toEqual([["high", .3, 2, 3], ["low", 0, 2, 3]]);
});
it("ignores same-bar contact, uses inclusive later ranges and never bridges a price gap", () => {
  const result = createUnfinishedAuctionCache().read([footprint()], [candle(0), candle(1, 104, 105), candle(2, 101, 102), candle(3, 103, 104)], "1m", 1, 0);
  expect(result.map(r => [r.side, r.touched])).toEqual([["high", start + 3 * minute], ["low", null]]);
});
it("invalidates historical range repairs, source row changes and backward Replay seeks", () => {
  const cache = createUnfinishedAuctionCache(), bars = [candle(0), candle(1, 104, 105), candle(2, 100, 103)], prints = [footprint()];
  const first = cache.read(prints, bars, "1m", 1, 0); expect(first[0].touched).toBe(start + 2 * minute);
  expect(cache.read(prints, bars, "1m", 1, 0)).toBe(first);
  bars[1].low = 100; expect(cache.read(prints, bars, "1m", 1, 0)[0].touched).toBe(start + minute);
  expect(cache.read(prints, bars, "1m", 1, 0, start + minute).every(r => r.touched === null)).toBe(true);
  expect(cache.read(prints, bars, "1m", 1, 0, start)).toEqual([]);
  prints[0].levels.at(-1)!.sellVolume = 0;
  expect(cache.read(prints, bars, "1m", 1, 0).map(r => r.side)).toEqual(["low"]);
});
it("excludes a still-forming Replay revisit until its candle completes", () => {
  const cache = createUnfinishedAuctionCache(), bars = [candle(0), candle(1)];
  expect(cache.read([footprint()], bars, "1m", 1, 0, start + minute).map(r => r.touched)).toEqual([null, null]);
  expect(cache.read([footprint()], bars, "1m", 1, 0, start + 2 * minute).map(r => r.touched)).toEqual([start + minute, start + minute]);
});
it("matches a brute-force oracle across many observed extremes and repeated prices", () => {
  const bars = Array.from({ length: 400 }, (_, i) => candle(i, 95 + i % 11, 99 + i % 11));
  const result = createUnfinishedAuctionCache().read(Array.from({ length: 300 }, (_, i) => footprint(i)), bars, "1m", 1, 0);
  for (const ref of result) expect(ref.touched).toBe(bars.find(b => b.time > ref.time && b.low <= ref.price && b.high >= ref.price)?.time ?? null);
});
it("migrates saved preferences and validates all auction controls", () => {
  const legacy = { ...defaultFootprint() };
  for (const key of ["unfinishedVisible", "unfinishedMinVolume", "unfinishedWidth", "unfinishedExtend", "unfinishedHighColor", "unfinishedLowColor"] as const) delete legacy[key];
  expect(validFootprint(legacy)).toBe(true); expect(resolveFootprint(legacy)).toMatchObject({ unfinishedVisible: false, unfinishedExtend: true, unfinishedWidth: 1 });
  for (const value of [{ unfinishedWidth: 0 }, { unfinishedWidth: 1.5 }, { unfinishedMinVolume: -1 }, { unfinishedHighColor: "bad" }, { unfinishedExtend: "yes" }])
    expect(validFootprint({ ...settings, ...value })).toBe(false);
  expect(footprintSettings().rows!.find(r => r.kind === "toggle" && r.key === "unfinishedVisible")).toMatchObject({ defval: false });
});
it.each([false, true])("paints outer-row outlines and only eligible ray spans, inverted=%s", invert => {
  const lines: number[][] = [], outlines: number[][] = [], path: number[] = [];
  const ctx = { save() {}, restore() {}, beginPath() { path.length = 0; }, moveTo(...v: number[]) { path.push(...v); }, lineTo(...v: number[]) { path.push(...v); }, stroke() { lines.push([...path]); },
    strokeRect(...v: number[]) { outlines.push(v); } } as unknown as CanvasRenderingContext2D;
  const args = { coords: { width: 500, pxPerBar: () => 100, timeToX: (t: number) => 100 + (t - start) / minute * 100,
    priceToY: (p: number) => invert ? (p - 95) * 10 : (110 - p) * 10 }, bounds: { top: 0, height: 300 }, scale: {} } as unknown as RendererLayerArgs;
  const refs = createUnfinishedAuctionCache().read([footprint()], [candle(0), candle(1, 104, 105), candle(2)], "1m", 1, 0);
  paintUnfinishedAuctions(ctx, args, refs, settings);
  expect(outlines).toHaveLength(2); expect(lines).toHaveLength(2);
  expect(lines[0][0]).toBe(141); expect(lines[0][2]).toBe(300);
  lines.length = 0; outlines.length = 0;
  paintUnfinishedAuctions(ctx, args, refs, { ...settings, unfinishedExtend: false }); expect(outlines).toHaveLength(2); expect(lines).toHaveLength(0);
  outlines.length = 0; paintUnfinishedAuctions(ctx, args, refs, { ...settings, unfinishedVisible: false }); expect(outlines).toHaveLength(0);
});
it("reports observed revisit provenance in the existing data-window surface", () => {
  const token = Symbol(), auctions = createUnfinishedAuctionCache().read([footprint()], [candle(0), candle(1)], "1m", 1, 0);
  publishFootprintSurface("ua-test", token, { symbol: "BTCUSDT", timeframe: "1m", epoch: 0, bars: [footprint()], simulated: false, dropped: 0, unfinished: auctions });
  try {
    const rows = readFootprintSurface("ua-test", { symbol: "BTCUSDT", timeframe: "1m", epoch: 0, replay: false }, start).rows;
    expect(rows).toContainEqual({ label: "Unfinished high price", value: "103" });
    expect(rows.find(r => r.label === "Unfinished auction basis")?.value).toContain("gaps remain unknown");
  } finally { clearFootprintSurface("ua-test", token); }
});
