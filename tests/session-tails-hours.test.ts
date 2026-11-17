import { afterEach, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, RendererLayerArgs } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { registerMarketSessions, clearMarketSessions, type MarketSessionCalendar } from "@/lib/market/sessionWindows";
import { defaultTails, resolveTails, tailsInputs, tailsInputVisible, selectTailWindows } from "@/lib/orderflow/volumeTails";
import { tailsDescriptor, type TailsChannel } from "@/lib/orderflow/volumeTailsIndicator";
import { TailsRenderCache } from "@/lib/orderflow/volumeTailsRenderer";
import { studyArguments } from "@/lib/chart/statusLine";
const base = Date.UTC(2026, 10, 4), minute = 60000, day = 86400000, symbol = "KRK:BTC/USD";
const trade = (id: string, time: number, quantity = 1): Tick => ({ id, time, quantity, symbol, price: 100, side: "buy", simulated: false });
const bar = (time: number) => ({ time, open: 100, high: 101, low: 99, close: 100, volume: 1 });
const view = { from: 0, to: 100 };
const select = (input: Tick[], values: Record<string, unknown>, calendar?: MarketSessionCalendar) => selectTailWindows(input,
  [bar(base), bar(base + day)], "1D", "session", resolveTails(values), symbol, view, undefined, calendar);
afterEach(() => { clearMarketSessions(); vi.useRealTimers(); });

it.each([
  ["Pre-market", 540, 810], ["Market", 810, 1200], ["Post-market", 1200, 1440],
  ["London", 480, 990], ["New York", 780, 1320], ["Asian", 0, 540],
] as const)("selects %s by actual execution timestamps with an exclusive end", (tradingHours, from, to) => {
  const input = [trade("before", base + from * minute - 1, 9), trade("first", base + from * minute, 2),
    trade("last", base + to * minute - 1, 3), trade("after", base + to * minute, 8)];
  // Include the previous day too, so Asian's before-start print is source-eligible.
  const windows = selectTailWindows(input, [bar(base - day), bar(base)], "1D", "session", resolveTails({ tradingHours }), symbol, view);
  const window = windows.find(w => w.start === base + from * minute)!;
  expect(window).toMatchObject({ start: base + from * minute, end: base + to * minute });
  expect(window.trades.map(t => t.id)).toEqual(["first", "last"]);
});

it("supports overnight custom HHMM, midnight aliases and rejects impossible minutes", () => {
  const windows = select([trade("start", base + 22 * 60 * minute, 2), trade("overnight", base + day + minute, 3),
    trade("end", base + day + 2 * 60 * minute, 99)], { tradingHours: "Custom", customStart: 2200, customEnd: 200 });
  expect(windows).toHaveLength(1); expect(windows[0].trades.map(t => t.id)).toEqual(["start", "overnight"]);
  expect(windows[0]).toMatchObject({ start: base + 22 * 60 * minute, end: base + day + 2 * 60 * minute });
  expect(select([trade("midnight", base)], { tradingHours: "Custom", customStart: 2400, customEnd: 0 })[0].start).toBe(base);
  expect(() => resolveTails({ tradingHours: "Custom", customStart: 1260 })).toThrow(/HHMM/);
  expect(() => resolveTails({ tradingHours: "Custom", customEnd: 2361 })).toThrow(/HHMM/);
});

it("selects explicit RTH/ETH and independent inherited chart modes from the same source", () => {
  const regular = [[base + 14.5 * 60 * minute, base + 21 * 60 * minute]] as const;
  const calendar: MarketSessionCalendar = { regular: [...regular], extended: [[base + 9 * 60 * minute, base + day]], mode: "regular", revision: 1 };
  const input = [trade("pre", base + 10 * 60 * minute), trade("rth", base + 15 * 60 * minute), trade("post", base + 22 * 60 * minute)];
  const ids = (tradingHours: string, mode: "regular" | "extended") => select(input, { tradingHours }, { ...calendar, mode })[0].trades.map(t => t.id);
  expect(ids("Full day", "regular")).toEqual(["rth"]); expect(ids("Full day", "extended")).toEqual(["pre", "rth", "post"]);
  expect(ids("Regular hours (RTH)", "extended")).toEqual(["rth"]);
  expect(ids("Extended hours (ETH)", "regular")).toEqual(["pre", "rth", "post"]);
  expect(() => select(input, { tradingHours: "Extended hours (ETH)" }, { ...calendar, extended: [] })).toThrow(/no extended-hours/);
});

it("keeps legacy day clocks on continuous venues and ignores daily windows for Week/Month", () => {
  const input = [trade("before", base), trade("inside", base + 10 * 60 * minute)];
  for (const tradingHours of ["Full day", "Regular hours (RTH)", "Extended hours (ETH)"])
    expect(select(input, { tradingHours, sessionStartMinutes: 600, sessionMinutes: 60 })[0].trades.map(t => t.id)).toEqual(["inside"]);
  for (const session of ["Week", "Month"])
    expect(select(input, { session, tradingHours: "Custom", customStart: 1260, customEnd: 1260 })[0].trades).toHaveLength(2);
  expect(defaultTails()).toMatchObject({ tradingHours: "Full day", customStart: 0, customEnd: 0 });
});

it("offers ten session-only windows and conditional day/custom controls", () => {
  expect(tailsInputs("session").find(i => i.key === "tradingHours")?.options).toHaveLength(10);
  for (const kind of ["visible", "rolling"] as const)
    expect(tailsInputs(kind).some(i => ["tradingHours", "customStart", "customEnd"].includes(i.key))).toBe(false);
  expect(tailsInputVisible("tradingHours", { session: "Week" })).toBe(false);
  expect(tailsInputVisible("customStart", { tradingHours: "Custom" })).toBe(true);
  expect(tailsInputVisible("customStart", { tradingHours: "London" })).toBe(false);
  expect(tailsInputVisible("sessionZone", { tradingHours: "Custom" })).toBe(false);
  expect(tailsInputVisible("sessionZone", {})).toBe(true);
  expect(studyArguments({ session: "Day", tradingHours: "London" }, "session-tails")).toContain("Day · London");
  expect(studyArguments({ tradingHours: "Custom", customStart: 2200, customEnd: 200 }, "session-tails")).toContain("2200–0200 UTC");
  expect(studyArguments({ session: "Week", tradingHours: "London" }, "session-tails")).toContain("Week UTC");
});

it("invalidates quiet cached drawings on calendar changes without discarding retained executions", () => {
  const input = [trade("first", base + 10 * 60 * minute, 2), trade("second", base + 15 * 60 * minute, 3)];
  const windows = (from: number) => ({ regular: [[base + from * 60 * minute, base + (from + 2) * 60 * minute] as const], extended: [[base, base + day] as const] });
  registerMarketSessions(symbol, windows(9), "extended");
  let channel: TailsChannel | undefined;
  const context = { id: "tails-hours", symbol, timeframe: "1D", session: "regular", live: true, emit() {}, setStatus() {},
    pushData(value: TailsChannel) { channel = value; } } as unknown as NativeIndicatorContext;
  const instance = tailsDescriptor("session", () => input, () => () => {}).create(); instance.start(context, {});
  const args = { bars: [bar(base)], coords: { visibleLogicalRange: () => view } } as unknown as RendererLayerArgs;
  const cache = new TailsRenderCache(), retained = channel!.trades;
  expect(cache.read(args, channel!, "session")[0].total).toBe(2); expect(channel!.calendar!.mode).toBe("regular");
  registerMarketSessions(symbol, windows(14), "extended"); instance.onBars();
  expect(channel!.trades).toBe(retained); expect(cache.read(args, channel!, "session")[0].total).toBe(3);
  expect(channel!.message).toContain("Source-resolved");
  (context as { session: string }).session = "extended"; instance.onBars();
  expect(cache.read(args, channel!, "session")[0].total).toBe(5); instance.stop();
});

it("does not extrapolate source windows across absent dates or future Replay candles", () => {
  const calendar: MarketSessionCalendar = { regular: [[base + 9 * 60 * minute, base + 11 * 60 * minute]], extended: [], mode: "regular", revision: 1 };
  const input = [trade("today", base + 10 * 60 * minute), trade("unmapped", base + day + 10 * 60 * minute)];
  expect(select(input, { tradingHours: "Regular hours (RTH)" }, calendar)[0].trades.map(t => t.id)).toEqual(["today"]);
  expect(selectTailWindows(input, [bar(base), bar(base + day)], "1D", "session", resolveTails({ tradingHours: "Regular hours (RTH)" }),
    symbol, view, base, calendar)).toEqual([]);
  expect(selectTailWindows(input, [bar(base), bar(base + day)], "1D", "session", resolveTails({ tradingHours: "Regular hours (RTH)" }),
    symbol, view, base + day, calendar)[0].trades.map(t => t.id)).toEqual(["today"]);
});
