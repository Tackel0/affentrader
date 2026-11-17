import { afterEach, expect, it } from "vitest";
import { clearMarketSessions, marketSessions, parseYahooSessionWindows, registerMarketSessions } from "@/lib/market/sessionWindows";
import { defaultTpo, resolveTpo, validTpo } from "@/lib/orderflow/tpoSettings";
import { tpoTradingCalendar, TPO_TRADING_HOURS } from "@/lib/orderflow/tpoTradingHours";
import { buildTpoSessions, createTpoCache } from "@/lib/orderflow/tpoModel";
import { scopedTpoOperations } from "@/lib/orderflow/tpoOperations";
import { tpoOverlayInputVisible, tpoOverlayInputs } from "@/lib/orderflow/tpoOverlay";
import { parseMeta } from "@/lib/market/yahoo";
import { evaluateTpo, tpoAlertSettings, validateTpoCondition } from "@/lib/alerts/tpo";
const stamp = (s: string) => Date.parse(s), day = stamp("2026-11-04T00:00:00Z"), minute = 60000;
const bar = (time: number) => ({ time, open: 100, high: 102, low: 99, close: 101, volume: 2 });
const symbol = "YF:AAPL";
afterEach(clearMarketSessions);
it.each([
  ["Pre-market", 540, 810], ["Market", 810, 1200], ["Post-market", 1200, 1440],
  ["London", 480, 990], ["New York", 780, 1320], ["Asian", 0, 540],
] as const)("uses the Vela fixed-UTC %s window regardless of legacy zone/weekday settings", (tradingHours, start, end) => {
  const cal = tpoTradingCalendar({ ...defaultTpo(), tradingHours, sessionZone: "Asia/Tokyo", weekdaysOnly: true });
  expect(cal.forDate("2026-11-04")).toEqual({ start: day + start * minute, end: day + end * minute, date: "2026-11-04" });
  expect(cal.at(day + start * minute - 1)).toBeNull();
  expect(cal.at(day + start * minute)?.start).toBe(day + start * minute);
  expect(cal.at(day + end * minute)).toBeNull();
});
it("wraps custom HHMM overnight, treats equal bounds as a whole day and rejects invalid minutes", () => {
  const style = { ...defaultTpo(), tradingHours: "Custom" as const, customStart: 2230, customEnd: 130 };
  const cal = tpoTradingCalendar(style), start = day + 22.5 * 60 * minute;
  expect(cal.at(start + 2 * 60 * minute)).toEqual({ start, end: start + 180 * minute, date: "2026-11-04" });
  expect(cal.at(start + 180 * minute)).toBeNull();
  expect(tpoTradingCalendar({ ...style, customStart: 0, customEnd: 2400 }).forDate("2026-11-04").end - day).toBe(1440 * minute);
  expect(validTpo({ ...style, customStart: 1260 })).toBe(false);
  expect(() => tpoTradingCalendar({ ...style, customEnd: 2401 })).toThrow(/HHMM/);
  expect(() => tpoTradingCalendar(resolveTpo({ ...style, customStart: 1260 }))).toThrow(/HHMM/);
});
it("inherits actual RTH/ETH windows, excludes holidays and does not extrapolate missing dates", () => {
  const regular = [[day + 870 * minute, day + 1260 * minute]] as [number, number][];
  const extended = [[day + 540 * minute, day + 1500 * minute]] as [number, number][];
  registerMarketSessions(symbol, { regular, extended }, "regular");
  const prefs = defaultTpo(), regularCal = tpoTradingCalendar(prefs, symbol);
  expect(regularCal.at(day + 869 * minute)).toBeNull(); expect(regularCal.at(day + 870 * minute)?.end).toBe(regular[0][1]);
  expect(regularCal.at(day + 1440 * minute)).toBeNull();
  expect(tpoTradingCalendar({ ...prefs, tradingHours: "Extended hours (ETH)" }, symbol).at(day + 600 * minute)?.end).toBe(extended[0][1]);
  registerMarketSessions(symbol, { regular, extended }, "extended");
  expect(tpoTradingCalendar(prefs, symbol).at(day + 600 * minute)?.start).toBe(extended[0][0]);
});
it("uses source-resolved DST and early-close endpoints without generating an exchange calendar", () => {
  const windows = [[stamp("2026-10-30T13:30:00Z"), stamp("2026-10-30T20:00:00Z")], [stamp("2026-11-02T14:30:00Z"), stamp("2026-11-02T21:00:00Z")],
    [stamp("2026-11-27T14:30:00Z"), stamp("2026-11-27T18:00:00Z")]] as [number, number][];
  registerMarketSessions(symbol, { regular: windows, extended: [] }, "regular");
  const cal = tpoTradingCalendar(defaultTpo(), symbol);
  expect(cal.at(stamp("2026-10-30T14:00:00Z"))?.start).toBe(windows[0][0]);
  expect(cal.at(stamp("2026-11-02T14:00:00Z"))).toBeNull();
  expect(cal.at(stamp("2026-11-26T15:00:00Z"))).toBeNull();
  expect(cal.forDate("2026-11-27").end).toBe(windows[2][1]);
});
it("filters the time model and ladder member bounds while keeping the opening period source-exact", () => {
  registerMarketSessions(symbol, { regular: [[day + 870 * minute, day + 1260 * minute]], extended: [] }, "regular");
  const bars = Array.from({ length: 96 }, (_, i) => bar(day + i * 15 * minute));
  const result = buildTpoSessions(bars, defaultTpo(), "15m", symbol);
  expect(result).toHaveLength(1); expect(result[0].coverage.loadedBars).toBe(26);
  expect(result[0].completion).toMatchObject({ expectedBars: 26, missingSlots: 0, status: "complete" });
  expect(result[0].markers?.open.time).toBe(day + 870 * minute);
  expect(result[0].initialBalance.status).toBe("complete");
});
it("invalidates same-array caches on source calendar corrections and isolates merge scopes", () => {
  const prefs = defaultTpo(), bars = [bar(day + 870 * minute), bar(day + 885 * minute)], cache = createTpoCache();
  const before = cache.read(bars, prefs, "15m", symbol);
  registerMarketSessions(symbol, { regular: [[day + 870 * minute, day + 900 * minute]], extended: [] }, "regular");
  const corrected = cache.read(bars, prefs, "15m", symbol); expect(corrected).not.toBe(before); expect(corrected[0].completion.expectedBars).toBe(2);
  const scope = scopedTpoOperations(prefs, "15m", symbol).scope;
  expect(scopedTpoOperations({ ...prefs, tradingHours: "London" }, "15m", symbol).scope).not.toBe(scope);
});
it("replaces covered calendar dates, including a removed holiday and a moved opening", () => {
  registerMarketSessions(symbol, { regular: [[day, day + minute], [day + 86400000, day + 86400000 + minute], [day + 2 * 86400000, day + 2 * 86400000 + minute]], extended: [] }, "regular");
  registerMarketSessions(symbol, { regular: [[day + minute, day + 2 * minute], [day + 2 * 86400000, day + 2 * 86400000 + minute]], extended: [] }, "regular");
  expect(marketSessions(symbol)?.regular).toHaveLength(2);
  expect(tpoTradingCalendar(defaultTpo(), symbol).at(day)).toBeNull();
  expect(tpoTradingCalendar(defaultTpo(), symbol).at(day + 86400000)).toBeNull();
});
it("ignores day filters for Week/Month and preserves legacy/no-calendar clock behavior", () => {
  expect(tpoTradingCalendar({ ...defaultTpo(), sessionPeriod: "Week", tradingHours: "London" }).at(day)?.start).toBe(stamp("2026-11-02T00:00:00Z"));
  expect(tpoTradingCalendar({ ...defaultTpo(), tradingHours: "Regular hours (RTH)", sessionStartMinutes: 60, sessionMinutes: 30 }).at(day + 70 * minute)?.start).toBe(day + 60 * minute);
  const { tradingHours: _hours, customStart: _start, customEnd: _end, ...legacy } = defaultTpo();
  expect(validTpo(legacy)).toBe(true); expect(resolveTpo(legacy).tradingHours).toBe("Full day");
});
it("preserves provider metadata and rejects malformed windows without assuming ETH equals RTH", () => {
  const r = { start: day / 1000 + 870 * 60, end: day / 1000 + 1260 * 60 };
  const raw = { regular: [[r]], pre: [[{ start: day / 1000 + 540 * 60, end: r.start }]], post: [[{ start: r.end, end: day / 1000 + 1500 * 60 }]] };
  const parsed = parseYahooSessionWindows(raw)!; expect(parsed.extended[0]).toEqual([day + 540 * minute, day + 1500 * minute]);
  expect(parseMeta({ tradingPeriods: raw }).sessions).toEqual(parsed);
  expect(parseYahooSessionWindows([[r]])?.extended).toEqual([]);
  expect(parseYahooSessionWindows([[{ start: 4, end: 3 }]] )).toBeUndefined();
  registerMarketSessions(symbol, { regular: parsed.regular, extended: [] }, "regular");
  expect(() => tpoTradingCalendar({ ...defaultTpo(), tradingHours: "Extended hours (ETH)" }, symbol)).toThrow(/extended-hours calendar/);
});
it("exposes all trading-hour controls to both surfaces with conditional UTC custom inputs", () => {
  expect(tpoOverlayInputs().find(i => i.key === "tradingHours")?.options).toEqual([...TPO_TRADING_HOURS]);
  expect(tpoOverlayInputVisible("customStart", { tradingHours: "Custom" })).toBe(true);
  expect(tpoOverlayInputVisible("customStart", { tradingHours: "London" })).toBe(false);
  expect(tpoOverlayInputVisible("tradingHours", { sessionPeriod: "Month" })).toBe(false);
});
it("copies session parameters into alerts and pins inherited chart hours to their source tape", () => {
  registerMarketSessions(symbol, { regular: [[day + 870 * minute, day + 1260 * minute]], extended: [[day + 540 * minute, day + 1500 * minute]] }, "extended");
  expect(tpoAlertSettings(defaultTpo(), symbol).tradingHours).toBe("Extended hours (ETH)");
  const settings = tpoAlertSettings({ ...defaultTpo(), tradingHours: "Custom", customStart: 2230, customEnd: 1630 }, symbol);
  expect(settings).toMatchObject({ sessionPeriod: "Day", tradingHours: "Custom", customStart: 2230, customEnd: 1630 });
  expect(validateTpoCondition({ type: "tpo", level: "poc", direction: "crossing", settings }, "15m")).toBeNull();
  expect(validateTpoCondition({ type: "tpo", level: "poc", direction: "crossing", settings: { ...settings, customStart: 1260 } }, "15m")).toMatch(/Invalid/);
});
it("keeps legacy alert clocks distinct from inherited calendars and fails closed without ETH coverage", () => {
  registerMarketSessions(symbol, { regular: [[day + 870 * minute, day + 1260 * minute]], extended: [] }, "regular");
  const all = Array.from({ length: 96 }, (_, i) => bar(day + i * 15 * minute)), at = day + 1080 * minute;
  const quote = { price: 101, previous: 100, time: at, simulated: false, changePercent: 1, high: 102, low: 99, volume: 1 };
  const { tradingHours: _hours, customStart: _start, customEnd: _end, sessionPeriod: _period, ...legacy } = tpoAlertSettings({ ...defaultTpo(), sessionStartMinutes: 540, sessionMinutes: 60 });
  const old = evaluateTpo({ type: "tpo", level: "poc", direction: "crossing", settings: legacy }, { bars: all, quote }, symbol, "15m");
  expect(old.incomplete).toBe(false); expect(old.detail).toContain("09:00:00.000Z");
  const unavailable = evaluateTpo({ type: "tpo", level: "poc", direction: "crossing", settings: tpoAlertSettings({ ...defaultTpo(), tradingHours: "Extended hours (ETH)" }) }, { bars: all, quote }, symbol, "15m");
  expect(unavailable).toMatchObject({ met: false, incomplete: true }); expect(unavailable.detail).toContain("extended-hours calendar");
});
it("rebaselines alert observations on source-calendar corrections with unchanged candle prices", () => {
  const windows = { regular: [[day + 540 * minute, day + 600 * minute]] as [number, number][], extended: [] };
  registerMarketSessions(symbol, windows, "regular");
  const settings = tpoAlertSettings({ ...defaultTpo(), tradingHours: "Regular hours (RTH)" }), condition = { type: "tpo" as const, level: "poc" as const, direction: "crossing" as const, settings };
  const bars = Array.from({ length: 4 }, (_, i) => bar(day + (540 + i * 15) * minute)), at = day + 660 * minute;
  const quote = { price: 100, previous: 100, time: at, simulated: false, changePercent: 0, high: 102, low: 99, volume: 1 };
  const before = evaluateTpo(condition, { bars, quote }, symbol, "15m"); expect(before.sample).toBeDefined();
  registerMarketSessions(symbol, windows, "extended");
  const next = evaluateTpo(condition, { bars, quote: { ...quote, price: 102, time: at + 1 }, previousTpo: { [before.key]: before.sample! } }, symbol, "15m");
  expect(next.met).toBe(false); expect(next.sample?.reference).not.toBe(before.sample?.reference);
});
