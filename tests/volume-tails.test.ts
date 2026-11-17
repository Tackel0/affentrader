import { afterEach, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, RendererLayerArgs } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { buildVolumeTails, defaultTails, resolveTails, selectTailWindows, tailsFromBins, tailsInputs } from "@/lib/orderflow/volumeTails";
import { tailsDescriptor, type TailsChannel } from "@/lib/orderflow/volumeTailsIndicator";
import { paintTailDrawing, TailsRenderCache } from "@/lib/orderflow/volumeTailsRenderer";

const minute = 60000, day = 86400000, symbol = "BTCUSDT";
const tick = (id: string, time: number, price: number, quantity: number, side: Tick["side"] = "buy"): Tick => ({ id, time, symbol, price, quantity, side, simulated: false, tradeCount: 1 });
const bars = (...times: number[]) => times.map(time => ({ time, open: 100, high: 200, low: 50, close: 101, volume: 1e6 }));
const view = { from: 0, to: 99 };
afterEach(() => vi.useRealTimers());

it("defaults to 10%/50 bins/100 bars and validates every exposed setting", () => {
  expect(defaultTails()).toMatchObject({ threshold: 10, resolution: 50, bars: 100, session: "Day" });
  expect(tailsInputs("rolling").find(i => i.key === "bars")?.defval).toBe(100);
  expect(tailsInputs("visible").some(i => i.key === "bars" || i.key === "session")).toBe(false);
  expect(tailsInputs("session").filter(i => i.tab === "Style")).toHaveLength(12);
  for (const invalid of [{ threshold: 0 }, { threshold: NaN }, { resolution: 1 }, { resolution: 2.5 }, { bars: 0 }, { bars: 50001 },
    { session: "bad" }, { supplyArea: "yes" }, { demandColor: "red" }, { sessionZone: "bad/zone" }, { sessionMinutes: 0 }]) expect(() => resolveTails(invalid)).toThrow();
});

it("targets COMBINED volume from opposite extremes and consumes the full crossing bin", () => {
  // Total 100, target 20: demand consumes 12+15=27; supply 5+10+20=35.
  const r = tailsFromBins([0, 1, 2, 3, 4], [.5, 1.5, 2.5, 3.5], [12, 15, 23, 0], [15, 20, 10, 5], 20);
  expect(r).toMatchObject({ total: 100, target: 20,
    demand: { low: 0, high: 2, average: 1, volume: 27, reached: true, bins: 2 },
    supply: { low: 1, high: 4, average: 2.5, volume: 35, reached: true, bins: 3 } });
  expect(r.demand!.weighted).toBeCloseTo((12 * .5 + 15 * 1.5) / 27);
  expect(r.supply!.weighted).toBeCloseTo((5 * 3.5 + 10 * 2.5 + 20 * 1.5) / 35);
  expect(r.equilibrium!.midpoint).toBe(1.5); expect(r.equilibrium!.average).toBe(1.75);
  expect(r.equilibrium!.weighted).toBeCloseTo((r.demand!.weighted + r.supply!.weighted) / 2);
});

it("distinguishes a missing side from insufficient side volume and handles empty extreme bins", () => {
  const r = tailsFromBins([10, 20, 30, 40], [15, 25, 35], [0, 90, 0], [0, 0, 10], 50);
  expect(r.demand).toMatchObject({ low: 10, high: 30, volume: 90, reached: true, bins: 2 });
  expect(r.supply).toMatchObject({ low: 10, high: 40, volume: 10, reached: false, bins: 3 });
  const buyOnly = tailsFromBins([0, 1], [.5], [3], [0], 10);
  expect(buyOnly.supply).toBeNull(); expect(buyOnly.equilibrium).toBeNull();
  expect(tailsFromBins([0, 1], [.5], [0], [0], 10).demand).toBeNull();
});

it("keeps stable means for large finite prices/quantities and rejects invalid precision", () => {
  const r = tailsFromBins([1e100, 2e100, 3e100], [1.5e100, 2.5e100], [1e200, 1e200], [0, 0], 90);
  expect(r.demand!.weighted / 1e100).toBeCloseTo(2);
  for (const args of [
    [[0, 0], [0], [1], [0], 10], [[0, 1], [2], [1], [0], 10], [[0, 1], [.5], [-1], [0], 10],
    [[0, 1], [.5], [Infinity], [0], 10], [[0, 1], [.5], [Number.MIN_VALUE], [0], .1],
  ] as const) expect(() => tailsFromBins(args[0], args[1], args[2], args[3], args[4])).toThrow();
});

it("bins observed aggressor quantities once, without using candle direction/volume", () => {
  const source = [tick("buy-low", 1, 100, 3), tick("sell-high", 2, 110, 5, "sell"), tick("buy-mid", 3, 105, 2)];
  const r = buildVolumeTails(source, resolveTails({ resolution: 2, threshold: 20 }))!;
  expect(r).toMatchObject({ total: 10, target: 2, observations: 3, simulated: false, min: 100, max: 110,
    demand: { low: 100, high: 105, volume: 3 }, supply: { low: 105, high: 110, volume: 5 } });
  const flat = buildVolumeTails([tick("flat", 1, 100, 2)], defaultTails())!;
  expect(flat.demand!.weighted).toBe(100); expect(flat.supply).toBeNull(); expect(buildVolumeTails([], defaultTails())).toBeNull();
});

it("selects visible and rolling loaded bars, includes the last candle and excludes its exact end", () => {
  const source = [tick("a", 1, 100, 1), tick("b", minute + 1, 101, 1), tick("c", 2 * minute + 1, 102, 1), tick("edge", 3 * minute, 103, 1)];
  const loaded = bars(0, minute, 2 * minute), style = resolveTails({ bars: 2 });
  expect(selectTailWindows(source, loaded, "1m", "visible", style, symbol, { from: 1, to: 1 })[0].trades.map(t => t.id)).toEqual(["b"]);
  expect(selectTailWindows(source, loaded, "1m", "rolling", style, symbol, view)[0].trades.map(t => t.id)).toEqual(["b", "c"]);
  expect(selectTailWindows(source, loaded, "1m", "visible", style, symbol, { from: -10, to: -1 })).toEqual([]);
  expect(selectTailWindows(source, loaded, "1m", "visible", style, symbol, { from: 8, to: 9 })).toEqual([]);
});

it("slides rolling tails as new bars appear and filters completed Replay candles exclusively", () => {
  const source = [tick("a", 1, 100, 1), tick("b", minute + 1, 101, 1), tick("c", 2 * minute + 1, 102, 1)];
  const style = resolveTails({ bars: 1 });
  expect(selectTailWindows(source, bars(0, minute), "1m", "rolling", style, symbol, view)[0].trades.map(t => t.id)).toEqual(["b"]);
  expect(selectTailWindows(source, bars(0, minute, 2 * minute), "1m", "rolling", style, symbol, view)[0].trades.map(t => t.id)).toEqual(["c"]);
  expect(selectTailWindows(source, bars(0, minute, 2 * minute), "1m", "rolling", style, symbol, view, 2 * minute)[0].trades.map(t => t.id)).toEqual(["b"]);
});

it.each(["Week", "Month"] as const)("groups UTC %s periods and ignores day-hour filtering", session => {
  const a = Date.parse(session === "Week" ? "2026-11-01T23:59:00Z" : "2026-10-31T23:59:00Z"), b = a + minute;
  const source = [tick("a", a, 100, 1), tick("b", b, 101, 1)];
  const r = selectTailWindows(source, bars(a, b), "1m", "session", resolveTails({ session, sessionMinutes: 1, sessionStartMinutes: 600, weekdaysOnly: true }), symbol, view);
  expect(r.map(w => w.trades.map(t => t.id))).toEqual([["a"], ["b"]]);
});

it("applies custom intrabar day boundaries and DST/weekend session filtering", () => {
  const first = Date.parse("2026-03-06T14:30:00Z"), next = Date.parse("2026-03-09T13:30:00Z");
  const source = [tick("before", first - minute, 100, 1), tick("fri", first, 100, 2), tick("weekend", first + day, 100, 3), tick("mon", next, 100, 4)];
  const r = selectTailWindows(source, bars(first - 30 * minute, first + day - 30 * minute, next - 30 * minute), "1h", "session",
    resolveTails({ sessionZone: "America/New_York", sessionStartMinutes: 570, sessionMinutes: 390, weekdaysOnly: true }), symbol, view);
  expect(r.map(w => w.trades.map(t => t.id))).toEqual([["fri"], ["mon"]]);
  expect(r[0].start).toBe(first); expect(r[1].start).toBe(next);
});

it("rejects unsupported intervals, source mixing, wrong markets and conflicting execution IDs", () => {
  const valid = tick("a", 1, 100, 1), select = (input: Tick[], tf = "1m") => selectTailWindows(input, bars(0), tf, "visible", defaultTails(), symbol, view);
  expect(() => select([valid], "100T")).toThrow(/time-based/);
  expect(() => select([valid, { ...tick("b", 2, 100, 1), simulated: true }])).toThrow(/different markets or real/);
  expect(() => select([{ ...valid, symbol: "ETHUSDT" }])).toThrow(/another market/);
  expect(() => select([valid, { ...valid, quantity: 9 }])).toThrow(/Conflicting/);
  expect(select([valid, valid])[0].trades).toHaveLength(1);
});

function harness(live = true, archive?: Parameters<typeof tailsDescriptor>[3]) {
  let source = [tick("seed", 1, 100, 3)], receive: ((t: Tick) => void) | undefined, channel: TailsChannel | null = null;
  const read = vi.fn(() => source), subscribe = vi.fn((_s: string, cb: (t: Tick) => void) => { receive = cb; return vi.fn(); });
  const instance = tailsDescriptor("rolling", read, subscribe, archive).create();
  const context = { symbol, timeframe: "1m", live, bars: () => bars(0, minute), emit() {}, pushData: (value: TailsChannel | null) => { channel = value; }, setStatus() {} } as unknown as NativeIndicatorContext;
  instance.start(context, {});
  return { instance, read, subscribe, channel: () => channel!, receive: () => receive!, replace: (value: Tick[]) => { source = value; } };
}

it("retains executions beyond the rolling service tape through style edits and fences callbacks", () => {
  vi.useFakeTimers(); const h = harness(), channel = h.channel(); channel.repaint = vi.fn();
  const next = tick("next", minute + 1, 110, 4, "sell"); h.replace([next]); h.receive()(next); h.receive()(next); vi.runAllTimers();
  expect(h.channel().trades!.map(t => t.id)).toEqual(["seed", "next"]);
  h.instance.setInputs({ threshold: 20, supplyWeighted: true }); expect(h.channel().trades).toHaveLength(2);
  const old = h.receive(); h.instance.suspend(); expect(h.channel()).toBeNull(); old(tick("stale", 2, 200, 1)); vi.runAllTimers();
  h.instance.resume(); expect(h.channel().trades!.map(t => t.id)).toEqual(["next"]); h.instance.stop();
});

it("uses only archived Replay prefixes, rebuilds on seek and clears on missing source", () => {
  let through = minute, available = true;
  const source = [tick("past", 1, 100, 3), tick("future", minute + 1, 200, 999)];
  const h = harness(false, { replay: () => available ? { through, trades: source.filter(t => t.time < through), label: "recorded prefix" } : undefined });
  expect(h.channel().trades!.map(t => t.id)).toEqual(["past"]); expect(h.read).not.toHaveBeenCalled(); expect(h.subscribe).not.toHaveBeenCalled();
  through = 2 * minute; h.instance.onBars(); expect(h.channel().trades).toHaveLength(2);
  through = minute; h.instance.onBars(); expect(h.channel().trades).toHaveLength(1);
  available = false; h.instance.onBars(); expect(h.channel().trades).toBeUndefined(); expect(h.channel().message).toContain("Replay needs"); h.instance.stop();
});

it("excludes invalid execution records and discloses their rejection", () => {
  const h = harness(); h.instance.suspend(); h.replace([tick("valid", 1, 100, 1), tick("bad", 2, 100, Infinity)]);
  // Invalid records are rejected by the shared collection rather than used in bins.
  h.instance.resume(); expect(h.channel().trades).toHaveLength(1); expect(h.channel().message).toContain("1 invalid observations rejected"); h.instance.stop();
});

it("recomputes a range after same-endpoint archive/source changes and a pan", () => {
  const h = harness(), cache = new TailsRenderCache(), channel = h.channel();
  let visible = { from: 0, to: 0 };
  const args = { bars: bars(0, minute), coords: { visibleLogicalRange: () => visible } } as unknown as RendererLayerArgs;
  expect(cache.read(args, channel, "visible")[0].total).toBe(3);
  channel.trades = [tick("changed", 1, 100, 7), tick("new", minute + 1, 110, 8)];
  expect(cache.read(args, channel, "visible")[0].total).toBe(7);
  visible = { from: 1, to: 1 }; expect(cache.read(args, channel, "visible")[0].total).toBe(8);
  channel.trades = undefined; expect(cache.read(args, channel, "visible")).toEqual([]); h.instance.stop();
});

it("paints independent area/average/weighted controls and returns exact hover values", () => {
  const tails = buildVolumeTails([tick("low", 1, 100, 3), tick("high", 2, 110, 5, "sell")], resolveTails({ resolution: 2 }))!;
  const ctx = { fillRect: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() } as unknown as CanvasRenderingContext2D;
  const style = resolveTails({ supplyWeighted: true, demandWeighted: true });
  const hover = paintTailDrawing(ctx, { ...tails, start: 0, end: 10 }, style, { x: t => t * 10, y: p => 200 - p }, { x: 50, y: 98 });
  expect(ctx.fillRect).toHaveBeenCalledTimes(2); expect(ctx.stroke).toHaveBeenCalledTimes(5); expect(hover).toContain("Demand"); expect(hover).toContain("weighted 102.5");
});
