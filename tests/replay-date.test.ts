import { describe, expect, it } from "vitest";
import { replayDateDraft, replaySeekTime } from "@/lib/chart/replayDate";
import { wallDateTime, wallTimeCandidates, resolveZone } from "@/lib/timezones";
import { registerSymbolInfo } from "@/lib/symbolId";
const instant = (text: string) => Date.parse(`${text}Z`);
const fullBounds = { first: instant("1960-01-01T00:00:00"), last: instant("2030-01-01T00:00:00") };
describe("chart-zone Replay date navigation", () => {
  it.each([
    ["UTC", "2026-10-27T01:35:17", "2026-10-27T01:35:17"],
    ["Europe/Berlin", "2026-10-27T01:35:17", "2026-10-27T02:35:17"],
    ["America/New_York", "2026-07-15T13:30:45", "2026-07-15T09:30:45"],
    ["Asia/Kathmandu", "2026-10-25T18:30:07", "2026-10-26T00:15:07"],
    ["Pacific/Kiritimati", "2026-10-25T10:15:01", "2026-10-26T00:15:01"],
  ])("round-trips the exact second in %s independently of the OS zone", (zone, utc, wall) => {
    const cursor = instant(utc), draft = replayDateDraft(cursor, zone);
    expect(draft.value).toBe(wall);
    expect(wallDateTime(cursor, zone)).toBe(wall.slice(0, 16));
    expect(replaySeekTime(draft, zone, fullBounds)).toBe(cursor);
  });
  it.each([
    ["Europe/Berlin", "2026-10-25T00:30:17", "2026-10-25T01:30:17"],
    ["America/New_York", "2026-11-01T05:30:27", "2026-11-01T06:30:27"],
    ["Australia/Lord_Howe", "2026-04-04T14:45:37", "2026-04-04T15:15:37"],
  ])("retains the current occurrence in the repeated hour in %s", (zone, first, second) => {
    const early = replayDateDraft(instant(first), zone), late = replayDateDraft(instant(second), zone);
    expect(early.value).toBe(late.value);
    expect(early.occurrence).toBe(0); expect(late.occurrence).toBe(1);
    expect(replaySeekTime(early, zone, fullBounds)).toBe(instant(first));
    expect(replaySeekTime(late, zone, fullBounds)).toBe(instant(second));
  });
  it("orders bounds as instants across a fold rather than lexical datetime-local strings", () => {
    const first = instant("2026-10-25T00:55:00"), last = instant("2026-10-25T01:15:00");
    const draft = { value: "2026-10-25T02:10:00", occurrence: 1 };
    expect(draft.value < wallDateTime(first, "Europe/Berlin", "second")).toBe(true);
    expect(replaySeekTime(draft, "Europe/Berlin", { first, last })).toBe(instant("2026-10-25T01:10:00"));
    expect(() => replaySeekTime({ ...draft, occurrence: 0 }, "Europe/Berlin", { first, last })).toThrow(/within/);
  });
  it.each([
    ["Europe/Berlin", "2026-03-29T02:30:17"],
    ["America/New_York", "2026-03-08T02:30:18"],
    ["Australia/Lord_Howe", "2026-10-04T02:15:19"],
    ["Pacific/Apia", "2011-12-30T12:00:20"],
  ])("rejects a skipped local second in %s", (zone, value) => {
    expect(wallTimeCandidates(value, zone)).toEqual([]);
    expect(() => replaySeekTime({ value, occurrence: 0 }, zone, fullBounds)).toThrow(/does not exist/);
  });
  it("rejects invalid dates/seconds and an absent occurrence rather than normalizing", () => {
    for (const value of ["", "2026-02-30T10:00:00", "2026-10-27T25:00:00", "2026-10-27T10:00:60", "2026-10-27T10:00:30Z"])
      expect(() => replaySeekTime({ value, occurrence: 0 }, "UTC", fullBounds)).toThrow();
    for (const occurrence of [-1, 2, 0.5, NaN]) expect(() => replaySeekTime({ value: "2026-10-25T02:30:00", occurrence }, "Europe/Berlin", fullBounds)).toThrow(/occurrence/);
  });
  it("requires complete valid loaded bounds and permits their exact endpoints, including epoch zero", () => {
    const draft = { value: "1970-01-01T00:00:00", occurrence: 0 };
    expect(replaySeekTime(draft, "UTC", { first: 0, last: 0 })).toBe(0);
    for (const bounds of [{ first: null, last: 0 }, { first: 0, last: null }, { first: NaN, last: 0 }, { first: 1, last: 0 }])
      expect(() => replaySeekTime(draft, "UTC", bounds)).toThrow(/loading/);
    expect(() => replaySeekTime(draft, "UTC", { first: 1000, last: 2000 })).toThrow(/within/);
    expect(() => replaySeekTime(draft, "UTC", { first: -2000, last: -1000 })).toThrow(/within/);
  });
  it("resolves an exchange-zone choice through the same absolute-second resolver", () => {
    registerSymbolInfo({ symbol: "YF:REPLAYZONE", name: "Replay zone", exchange: "NASDAQ", currency: "USD", type: "stock", delayed: true, timezone: "America/New_York" });
    const zone = resolveZone("exchange", "YF:REPLAYZONE"), cursor = instant("2026-10-27T13:30:12");
    const draft = replayDateDraft(cursor, zone);
    expect(draft.value).toBe("2026-10-27T09:30:12");
    expect(replaySeekTime(draft, zone, fullBounds)).toBe(cursor);
    expect(replayDateDraft(null, zone)).toEqual({ value: "", occurrence: 0 });
  });
});
