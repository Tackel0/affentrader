import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import type { NativeIndicatorContext, RendererLayerArgs } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { periodSessionCalendar } from "@/lib/orderflow/sessionPeriods";
import { defaultTpo, resolveTpo, validTpo, tpoSettings } from "@/lib/orderflow/tpoSettings";
import { buildTpoSessions, createTpoCache } from "@/lib/orderflow/tpoModel";
import { tpoReferenceLevels } from "@/lib/orderflow/tpoReferenceLevels";
import { tpoLetter } from "@/lib/orderflow/tpoMath";
import { paintTpoSessions } from "@/lib/orderflow/tpoRenderer";
import { defaultVolumeProfile, resolveVolumeProfile, volumeProfileInputs } from "@/lib/orderflow/volumeProfileSettings";
import { buildSessionVolumeProfiles } from "@/lib/orderflow/volumeProfileModel";
import { sessionProfileDescriptor } from "@/lib/orderflow/volumeProfileIndicator";
import { packSessionTrades, type SessionProfileRequest, type SessionProfileResponse } from "@/lib/orderflow/sessionProfileJobs";
import type { VolumeProfileChannel } from "@/lib/orderflow/volumeProfileRenderer";

const day = 86400000, hour = 3600000, symbol = "BTCUSDT";
const stamp = (value: string) => Date.parse(value);
const bar = (time: number, high = 102) => ({ time, open: 100, high, low: 100, close: 101, volume: 1 });
const tick = (id: string, time: number, quantity = 1): Tick => ({ id, time, symbol, price: 100, quantity, side: "buy", simulated: false });
afterEach(() => vi.useRealTimers());

it.each([
  ["Week", "2026-12-31T12:00:00Z", "2026-12-28T00:00:00Z", "2027-01-04T00:00:00Z"],
  ["Month", "2028-02-29T23:59:59Z", "2028-02-01T00:00:00Z", "2028-03-01T00:00:00Z"],
] as const)("anchors %s on exact UTC calendar edges across year/leap boundaries", (sessionPeriod, time, start, end) => {
  const cal = periodSessionCalendar({ ...defaultVolumeProfile(), sessionPeriod, sessionZone: "America/New_York", sessionStartMinutes: 570, sessionMinutes: 1, weekdaysOnly: true });
  expect(cal.at(stamp(time))).toEqual({ start: stamp(start), end: stamp(end), date: start.slice(0, 10) });
  expect(cal.at(stamp(end))?.start).toBe(stamp(end)); expect(cal.forDate(time.slice(0, 10))).toEqual(cal.at(stamp(time)));
});
it("keeps day DST/overnight behavior but UTC weeks always last seven full days", () => {
  const prefs = { ...defaultVolumeProfile(), sessionZone: "America/New_York" };
  const t = stamp("2026-03-08T12:00:00Z"), daily = periodSessionCalendar(prefs).at(t)!;
  expect(daily.end - daily.start).toBe(23 * hour);
  const week = periodSessionCalendar({ ...prefs, sessionPeriod: "Week" }).at(t)!; expect(week.end - week.start).toBe(7 * day);
});
it("rejects invalid calendar periods/dates instead of rolling an impossible date", () => {
  expect(() => periodSessionCalendar({ ...defaultVolumeProfile(), sessionPeriod: "bad" as "Day" })).toThrow(/Choose/);
  const cal = periodSessionCalendar({ ...defaultVolumeProfile(), sessionPeriod: "Month" });
  expect(() => cal.at(Infinity)).toThrow(/calendar/); expect(() => cal.forDate("2026-02-30")).toThrow(/valid/);
});
it("accepts legacy Day preferences and 4h blocks while validating the new period", () => {
  const { sessionPeriod: _period, ...legacy } = defaultTpo(); expect(validTpo(legacy)).toBe(true); expect(resolveTpo(legacy).sessionPeriod).toBe("Day");
  expect(validTpo({ ...defaultTpo(), sessionPeriod: "Month", blockMinutes: "240" })).toBe(true);
  expect(validTpo({ ...defaultTpo(), sessionPeriod: "Quarter" })).toBe(false);
  expect(() => resolveVolumeProfile({ sessionPeriod: "Quarter" })).toThrow();
  expect(volumeProfileInputs().find(i => i.key === "sessionPeriod")?.options).toEqual(["Day", "Week", "Month"]);
  expect(tpoSettings().rows?.some(r => "key" in r && r.key === "sessionPeriod")).toBe(true);
  expect([0, 25, 26, 51, 52, 61, 62].map(tpoLetter)).toEqual(["A", "Z", "a", "z", "0", "9", "A2"]);
});
it("groups weekly TPO bars without weekday/day-hour filtering and retains honest incomplete coverage", () => {
  const monday = stamp("2026-11-02T00:00:00Z"), style = { ...defaultTpo(), sessionPeriod: "Week" as const, blockMinutes: "240" as const, rowSize: 1, sessionMinutes: 60, weekdaysOnly: true };
  const sessions = buildTpoSessions([bar(monday), bar(monday + 6 * day), bar(monday + 7 * day)], style, "1h", symbol);
  expect(sessions).toHaveLength(2); expect(sessions[0].end).toBe(monday + 7 * day);
  expect(sessions[0].coverage.loadedBars).toBe(2); expect(sessions[0].completion).toMatchObject({ expectedBars: 168, missingSlots: 166, status: "incomplete" });
  expect(tpoReferenceLevels(sessions[0])).toBeNull();
});
it("freezes weekly completion/reference levels only after all slots and the next period are revealed", () => {
  const monday = stamp("2026-11-02T00:00:00Z"), source = Array.from({ length: 169 }, (_, i) => bar(monday + i * hour));
  const prefs = { ...defaultTpo(), sessionPeriod: "Week" as const, blockMinutes: "240" as const, rowSize: 1 };
  const prefix = buildTpoSessions(source.slice(0, -1), prefs, "1h", symbol)[0]; expect(prefix.completion.status).toBe("developing");
  expect(tpoReferenceLevels(prefix)).toBeNull();
  const complete = buildTpoSessions(source, prefs, "1h", symbol)[0]; expect(complete.completion.status).toBe("complete");
  expect(tpoReferenceLevels(complete)?.from).toBe(monday + 7 * day);
});
it("uses actual month lengths and no future TPO extrema in a historical prefix", () => {
  const feb = stamp("2028-02-01T00:00:00Z"), style = { ...defaultTpo(), sessionPeriod: "Month" as const, blockMinutes: "240" as const, rowSize: 1 };
  const source = [bar(feb), bar(feb + 28 * day, 105), bar(feb + 29 * day, 999)];
  const prefix = buildTpoSessions(source.slice(0, 2), style, "1h", symbol)[0];
  expect(prefix.end).toBe(feb + 29 * day); expect(prefix.completion.expectedBars).toBe(696); expect(prefix.rows.at(-1)!.price).toBe(105);
  const all = buildTpoSessions(source, style, "1h", symbol); expect(all).toHaveLength(2); expect(all[0].rows).toEqual(prefix.rows);
});
it("invalidates the TPO model when the session period changes on the same bar array", () => {
  const t = stamp("2026-11-02T00:00:00Z"), source = [bar(t), bar(t + day)], cache = createTpoCache();
  const prefs = { ...defaultTpo(), rowSize: 1 };
  expect(cache.read(source, prefs, "30m", symbol)).toHaveLength(2);
  expect(cache.read(source, { ...prefs, sessionPeriod: "Week" }, "30m", symbol)).toHaveLength(1);
});
it("conserves classified session quantities across Day/Week/Month changes", () => {
  const t = stamp("2026-10-31T23:59:00Z"), source = [tick("a", t, 3), tick("b", t + 60000, 7)];
  expect(buildSessionVolumeProfiles(source, defaultVolumeProfile(), symbol).sessions).toHaveLength(2);
  const week = buildSessionVolumeProfiles(source, { ...defaultVolumeProfile(), sessionPeriod: "Week", weekdaysOnly: true }, symbol);
  expect(week.sessions).toHaveLength(1); expect(week.sessions[0].valueArea.total).toBe(10);
  expect(buildSessionVolumeProfiles(source, { ...defaultVolumeProfile(), sessionPeriod: "Month" }, symbol).sessions).toHaveLength(2);
});
it("rebuilds a live profile calendar without reseeding away collected tape contributions", () => {
  vi.useFakeTimers(); const t = stamp("2026-11-02T00:00:00Z"); let input = [tick("first", t, 3)], next: ((value?: Tick) => void) | undefined, channel: VolumeProfileChannel | null = null;
  const native = sessionProfileDescriptor(() => input, (_s, cb) => { next = cb; return () => {}; }).create();
  native.start({ id: "period", symbol, timeframe: "1m", live: true, emit() {}, pushData: (v: VolumeProfileChannel | null) => { channel = v; }, setStatus() {} } as unknown as NativeIndicatorContext, {});
  input = [tick("new", t + day, 7)]; next!(input[0]); vi.runAllTimers(); expect(channel!.current!.model!.sessions).toHaveLength(2);
  native.setInputs({ sessionPeriod: "Week" }); expect(channel!.current!.model!.sessions).toHaveLength(1); expect(channel!.current!.model!.sessions[0].valueArea.total).toBe(10); native.stop();
});
it("runs shipped worker period changes on one worker without reusing a Day calendar", () => {
  const replies: SessionProfileResponse[] = [], scope: { onmessage?: (event: { data: SessionProfileRequest }) => void; postMessage: (response: SessionProfileResponse) => void } = { postMessage: r => replies.push(r) };
  runInNewContext(readFileSync("public/workers/session-profile.js", "utf8"), { self: scope, console });
  const t = stamp("2026-11-02T00:00:00Z"), trades = [tick("a", t, 3), tick("b", t + day, 7)];
  for (const sessionPeriod of ["Day", "Week", "Month"] as const) {
    const style = { ...defaultVolumeProfile(), sessionPeriod }, request: SessionProfileRequest = { id: replies.length + 1, values: packSessionTrades(trades), simulated: false, style, symbol };
    scope.onmessage!({ data: request });
    expect(replies.at(-1)?.error).toBeUndefined(); expect(JSON.parse(JSON.stringify(replies.at(-1)!.model))).toEqual(buildSessionVolumeProfiles(trades, style, symbol));
  }
});
it("keeps packed partial weekly TPO blocks inside the loaded source extent", () => {
  const t = stamp("2026-11-04T00:00:00Z"), style = { ...defaultTpo(), sessionPeriod: "Week" as const, blockMinutes: "240" as const, rowSize: 1,
    candlesVisible: false, ibVisible: false, boundariesVisible: false, pocVisible: false, valueAreaVisible: false };
  const source = [bar(t), bar(t + hour)], sessions = buildTpoSessions(source, style, "1h", symbol), rects: number[][] = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, fill() {}, fillText() {}, rect: (...values: number[]) => rects.push(values) } as unknown as CanvasRenderingContext2D;
  const args = { bars: source, coords: { width: 500, timeToX: (time: number) => (time - t) / hour * 10, priceToY: (p: number) => 500 - p * 2 }, bounds: { top: 0, height: 500 }, scale: {}, theme: { textColor: "black" } } as unknown as RendererLayerArgs;
  paintTpoSessions(ctx, args, sessions, style); expect(rects.length).toBeGreaterThan(0); expect(rects.every(r => r[0] >= 4)).toBe(true);
});
