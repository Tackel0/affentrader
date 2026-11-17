import { afterEach, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, NativeIndicatorOutput, RendererLayerArgs } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { activeBarStats, BarStatsAccumulator, barStatsCells, barStatsInputs, defaultBarStats, resolveBarStats, BAR_STATS_ROWS } from "@/lib/orderflow/barStats";
import { barStatsDescriptor, type BarStatsChannel } from "@/lib/orderflow/barStatsIndicator";
import { paintBarStats, statAtPoint } from "@/lib/orderflow/barStatsRenderer";
import { INDICATORS } from "@/lib/indicators/catalog";
const minute = 60000;
const tick = (id: string, time: number, quantity: number, side: Tick["side"] = "buy", tradeCount: number | undefined = 1): Tick =>
  ({ id, time, quantity, side, tradeCount, symbol: "BTCUSDT", simulated: false, price: 100 });
const trades = [tick("a", 1000, 8, "buy", 4), tick("b", 2000, 2, "sell", 2), tick("c", minute + 1, 20, "sell", 5)];
function model(source = trades) { const m = new BarStatsAccumulator("BTCUSDT", "1m"); m.add(source); return m; }
const candle = (time: number) => ({ time, open: 100, high: 102, low: 99, close: 101, volume: 999999 });
const allRows = () => ({ ...defaultBarStats(), buyTradesVisible: true, sellTradesVisible: true, tradesVisible: true });
afterEach(() => { vi.useRealTimers(); });

it("aggregates all seven statistics from classified executions rather than candle volume", () => {
  const m = model(), rows = m.read();
  expect(rows).toEqual([
    { time: 0, volume: 10, buy: 8, sell: 2, delta: 6, buyTrades: 4, sellTrades: 2, trades: 6, exact: { volume: "10", buy: "8", sell: "2", delta: "6" } },
    { time: minute, volume: 20, buy: 0, sell: 20, delta: -20, buyTrades: 0, sellTrades: 5, trades: 5, exact: { volume: "20", buy: "0", sell: "20", delta: "-20" } },
  ]);
  expect(model([]).read()).toEqual([]);
  m.add([trades[0]]); expect(m.read()).toBe(rows); expect(m.coverage.observations).toBe(3);
});
it("keeps exact decimal volume and delta despite fractional/late deliveries", () => {
  const m = model([tick("b", 2000, .2), tick("a", 1000, .1), tick("c", 3000, .05, "sell")]);
  expect(m.read()[0]).toMatchObject({ volume: .35, delta: .25, buy: .3, sell: .05,
    exact: { volume: "0.35", buy: "0.3", sell: "0.05", delta: "0.25" } });
  m.add([tick("late", 500, .15, "sell")]);
  expect(m.read()[0].exact).toEqual({ volume: "0.5", buy: "0.3", sell: "0.2", delta: "0.1" });
});
it("preserves classified quantities while leaving only unknown count sides empty", () => {
  const m = model([tick("buy", 1000, 4, "buy", 2), { ...tick("legacy", 2000, 1, "sell"), tradeCount: undefined }]);
  expect(m.read()[0]).toMatchObject({ volume: 5, delta: 3, buyTrades: 2, sellTrades: null, trades: null });
  const cells = barStatsCells(m.read(), new Set([0]), allRows());
  expect(cells.map(cell => cell.row)).toEqual(["volume", "delta", "buy", "sell", "buyTrades"]);
  expect(m.coverage.unknownCounts).toBe(1);
});
it("recomputes intensity against each row's visible maximum with signed delta colors", () => {
  const m = model(), style = allRows(), both = barStatsCells(m.read(), new Set([0, minute]), style);
  expect(both.find(cell => cell.time === 0 && cell.row === "volume")?.alpha).toBeCloseTo(.56);
  expect(both.find(cell => cell.time === minute && cell.row === "volume")?.alpha).toBe(1);
  expect(both.find(cell => cell.time === minute && cell.row === "delta")?.color).toBe(style.deltaDownColor);
  expect(both.find(cell => cell.time === 0 && cell.row === "delta")?.color).toBe(style.deltaColor);
  expect(barStatsCells(m.read(), new Set([0]), style).find(cell => cell.row === "volume")?.alpha).toBe(1);
  expect(barStatsCells(m.read(), new Set([120000]), style)).toEqual([]);
  expect(both.find(cell => cell.time === minute && cell.row === "buy")?.value).toBe(0);
});
it("seeks into a long history and excludes an unmatched interior candle from normalization", () => {
  const bar = model().read()[0];
  const history = Array.from({ length: 20000 }, (_, index) => ({ ...bar, time: index * minute, volume: index === 19001 ? 1e9 : bar.volume }));
  const has = vi.fn((time: number) => time !== 19001 * minute);
  const times = { has, keys: () => new Set([19000 * minute, 19002 * minute]).keys() };
  const cells = barStatsCells(history, times, defaultBarStats()).filter(cell => cell.row === "volume");
  expect(cells.map(cell => [cell.time / minute, cell.alpha])).toEqual([[19000, 1], [19002, 1]]);
  expect(has).toHaveBeenCalledTimes(3);
});
it("validates every persisted row/color setting and defaults count rows to hidden", () => {
  const defaults = defaultBarStats();
  expect(activeBarStats(defaults)).toEqual(["volume", "delta", "buy", "sell"]);
  expect(barStatsInputs().map(input => input.key).sort()).toEqual(Object.keys(defaults).sort());
  expect(resolveBarStats({ ...defaults })).toEqual(defaults);
  for (const values of [{ volumeVisible: "yes" }, { buyColor: "bad" }, { deltaDownColor: false }, { values: "Always" }]) expect(() => resolveBarStats(values)).toThrow();
  expect(INDICATORS.find(item => item.id === "bar-stats")?.nativeId).toBe("af-bar-stats");
});
it("rejects unsupported intervals, conflicting IDs and failed capacity without returning partial data", () => {
  for (const interval of ["1M", "100T", "bad"]) expect(() => new BarStatsAccumulator("BTCUSDT", interval)).toThrow(/fixed-duration/);
  const m = model(); expect(() => m.add([{ ...trades[0], quantity: 9 }])).toThrow(/Conflicting/); expect(() => m.read()).toThrow(/Conflicting/);
  const capacity = new BarStatsAccumulator("BTCUSDT", "1m", { ids: 5, buckets: 1 });
  expect(() => capacity.add(trades)).toThrow(/20,000/); expect(() => capacity.read()).toThrow();
  const burst = new BarStatsAccumulator("BTCUSDT", "1m", { ids: 2, buckets: 10 });
  expect(() => burst.add([tick("a", 0, 1), tick("b", 0, 1), tick("c", 0, 1)])).toThrow(/duplicate tracking/);
});
it("retains sums after ID compaction, excludes expired duplicates and catches integer/volume overflow", () => {
  const m = new BarStatsAccumulator("BTCUSDT", "1m", { ids: 4, buckets: 20 });
  for (let i = 0; i < 10; i++) m.add([tick(String(i), i * 1000, .1)]);
  m.add([tick("0", 0, .1)]); expect(m.read()[0]).toMatchObject({ volume: 1, buyTrades: 10, trades: 10 });
  expect(m.coverage.rejected).toBe(1);
  const counts = model([]); expect(() => counts.add([tick("a", 0, 1, "buy", Number.MAX_SAFE_INTEGER), tick("b", 1, 1)])).toThrow(/safe integer/);
  const quantities = model([tick("a", 0, Number.MAX_VALUE), tick("b", 1, Number.MAX_VALUE)]);
  expect(() => quantities.read()).toThrow(/precision/);
});
it("keeps source transitions, malformed trades and wrong-market records separate", () => {
  const m = model([trades[0], { ...tick("wrong", 3000, 100), symbol: "ETHUSDT" }, tick("invalid", 4000, NaN)]);
  expect(m.read()[0].volume).toBe(8); expect(m.coverage.rejected).toBe(2);
  m.add([{ ...tick("sim", minute, 3), simulated: true }, tick("old-real", 5000, 100)]);
  expect(m.read()).toHaveLength(1); expect(m.read()[0]).toMatchObject({ time: minute, volume: 3 });
  expect(m.coverage.simulated).toBe(true);
});
const args = (pitch = 60) => ({ bars: [candle(0), candle(minute)], bounds: { top: 100, height: 140 }, scale: { min: 90, max: 110 },
  coords: { width: 400, visibleLogicalRange: () => ({ from: -.5, to: 1.5 }), pxPerBar: () => pitch, timeToX: (time: number) => 100 + time / minute * pitch },
  theme: { background: "#111111", textColor: "#eeeeee" }, cursor: null }) as unknown as RendererLayerArgs;
function canvas() {
  const texts: string[] = [], rectangles: number[][] = [];
  const ctx = { globalAlpha: 1, fillStyle: "", font: "", textAlign: "", textBaseline: "",
    measureText: (text: string) => ({ width: text.length * 6 }), fillText: (text: string) => texts.push(text), fillRect: (...values: number[]) => rectangles.push(values) };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, rectangles };
}
it("aligns one cell per candle/active row, uses exact hover values and prints only when they fit", () => {
  const channel = { stats: model().read(), style: defaultBarStats(), message: "partial" }, c = canvas(), a = args();
  const cells = paintBarStats(c.ctx, a, channel);
  expect(cells).toHaveLength(8); expect(cells[0]).toMatchObject({ x: 70, y: 100, width: 60, height: 35, text: true });
  expect(c.texts).toContain("10"); expect(statAtPoint(cells, 100, 110)?.row).toBe("volume"); expect(statAtPoint(cells, 100, 145)?.row).toBe("delta");
  a.cursor = { x: 100, y: 145 }; paintBarStats(c.ctx, a, channel); expect(c.texts).toContain("Delta: 6");
  expect(paintBarStats(canvas().ctx, args(5), channel).every(cell => !cell.text)).toBe(true);
  const partial = args();
  partial.coords.visibleLogicalRange = () => ({ from: .1, to: 6.5 });
  partial.coords.timeToX = (time: number) => time / minute * 60 - 10;
  expect(paintBarStats(canvas().ctx, partial, channel).filter(cell => cell.time === 0)).toHaveLength(4);
  const outside = canvas();
  partial.cursor = { x: -10, y: 110 };
  paintBarStats(outside.ctx, partial, channel);
  expect(outside.texts).not.toContain("Volume: 10");
  const inside = canvas();
  partial.cursor = { x: 5, y: 110 };
  paintBarStats(inside.ctx, partial, channel);
  expect(inside.texts).toContain("Volume: 10");
  const off = canvas(); paintBarStats(off.ctx, args(), { ...channel, style: { ...channel.style, values: "Off" } });
  expect(off.texts).toEqual([]);
});
it("removes disabled rows and absent observations without synthesizing zero cells", () => {
  const style = defaultBarStats(); for (const row of BAR_STATS_ROWS) style[`${row}Visible`] = false;
  expect(paintBarStats(canvas().ctx, args(), { style, stats: model().read(), message: "partial" })).toEqual([]);
  expect(paintBarStats(canvas().ctx, args(), { style: defaultBarStats(), stats: [], message: "partial" })).toEqual([]);
});

function harness(live = true) {
  let trades = [tick("seed", 1000, 2, "buy", 4)], through = minute, revision = 0, data: BarStatsChannel | null = null;
  let changed: ((tick: Tick) => void) | undefined, archiveChanged: (() => void) | undefined;
  const outputs: NativeIndicatorOutput[] = [], off = vi.fn(), archiveOff = vi.fn();
  const instance = barStatsDescriptor(() => trades, (_symbol, callback) => { changed = callback; return off; }, {
    revision: () => revision, subscribe: (_symbol, callback) => { archiveChanged = callback; return archiveOff; },
    replay: () => ({ trades: trades.filter(tick => tick.time < through), through, label: "REPLAY observed" }),
  }).create();
  const context = { symbol: "BTCUSDT", timeframe: "1m", live, bars: () => [candle(0), candle(minute)], emit: (output: NativeIndicatorOutput) => outputs.push(output),
    pushData: (value: BarStatsChannel | null) => { data = value; }, setStatus() {} } as unknown as NativeIndicatorContext;
  instance.start(context, {});
  return { instance, context, outputs, off, archiveOff, data: () => data!, send: (tick: Tick) => changed!(tick),
    replace(next: Tick[]) { trades = next; revision++; archiveChanged?.(); }, seek(next: number) { through = next; instance.onBars(); } };
}
it("emits categorical pane labels and preserves live history through row/style edits", async () => {
  vi.useFakeTimers(); const h = harness(), repaint = vi.fn(); h.data().repaint = repaint;
  expect(h.outputs.at(-1)!.paneAxis).toEqual({ bands: [{ frac: .125, label: "Volume" }, { frac: .375, label: "Delta" }, { frac: .625, label: "Buy" }, { frac: .875, label: "Sell" }] });
  h.send(tick("live", 2000, 3, "sell", 2)); await vi.advanceTimersByTimeAsync(50);
  const stats = h.data().stats;
  h.instance.setInputs({ tradesVisible: true, values: "Off" });
  expect(h.data().stats).toBe(stats);
  expect(h.data().stats![0]).toMatchObject({ volume: 5, delta: -1, trades: 6 });
  expect(repaint).toHaveBeenCalled(); expect(h.outputs.at(-1)!.paneAxis).toMatchObject({ bands: expect.arrayContaining([{ frac: .9, label: "Trades" }]) });
  h.instance.stop();
});
it("fences pending live callbacks after suspension and rebuilds the resumed source", async () => {
  vi.useFakeTimers(); const h = harness();
  h.send(tick("pending", 2000, 3)); h.instance.suspend(); const length = h.outputs.length;
  h.send(tick("stale", 3000, 500)); await vi.advanceTimersByTimeAsync(100);
  expect(h.outputs).toHaveLength(length); expect(h.data()).toBeNull();
  h.instance.resume(); expect(h.data().stats![0].volume).toBe(2);
  h.instance.stop(); expect(h.off).toHaveBeenCalledTimes(2); expect(h.archiveOff).toHaveBeenCalledTimes(2);
});
it("rebuilds recorded prefixes on backward Replay seeks, ignores live ticks and clears removed archives", () => {
  const h = harness(false); h.replace(trades);
  expect(h.data().stats).toHaveLength(1); expect(h.data().stats![0].volume).toBe(10);
  h.seek(2 * minute); expect(h.data().stats).toHaveLength(2);
  h.seek(minute); expect(h.data().stats).toHaveLength(1);
  h.replace([]); expect(h.data().stats).toEqual([]); expect(h.off).not.toHaveBeenCalled(); h.instance.stop();
});
it("clears prior statistics for invalid settings, monthly charts and Replay without an archive", () => {
  const h = harness(); h.instance.setInputs({ volumeVisible: "bad" });
  expect(h.data().stats).toBeUndefined(); expect(h.data().message).toMatch(/unavailable/);
  h.instance.setInputs({ volumeVisible: true }); expect(h.data().stats![0].volume).toBe(2);
  const instance = barStatsDescriptor(() => trades, () => () => {}).create();
  instance.start({ ...h.context, timeframe: "1M" }, {}); expect(h.data().message).toMatch(/fixed-duration/);
  instance.start({ ...h.context, live: false }, {}); expect(h.data().message).toMatch(/Replay needs/);
  expect(h.outputs.at(-1)!.paneAxis).toBe("none"); instance.stop(); h.instance.stop();
});
