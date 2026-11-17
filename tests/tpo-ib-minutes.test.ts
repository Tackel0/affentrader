import { describe, expect, it } from "vitest";
import { buildTpoSessions, createTpoCache, tpoCalendar } from "@/lib/orderflow/tpoModel";
import { defaultTpo, resolveTpo, tpoIbMinutes, tpoSettings, validTpo } from "@/lib/orderflow/tpoSettings";
import { tpoInitialBalanceMinutes } from "@/lib/orderflow/tpoInitialBalance";
import { tpoIbExtension } from "@/lib/orderflow/tpoIbExtension";
import { nativeSeriesPreferences } from "@/lib/chart/seriesPreferences";
import { clearTpoSurface, publishTpoSurface, readTpoSurface } from "@/lib/orderflow/tpoReadout";

const m = 60000;
const bar = (time: number, low = 100, high = 101) => ({ time, low, high, open: low, close: high, volume: 1 });
const bars = Array.from({ length: 97 }, (_, i) => bar(i * 5 * m, 100 - i, 101 + i));
const style = { ...defaultTpo(), rowSize: 1 };

describe("independent TPO Initial Balance minutes", () => {
  it("keeps the default opening hour independent of every supported block interval", () => {
    const ranges = (["5", "15", "30", "60", "240"] as const).map(blockMinutes =>
      buildTpoSessions(bars, { ...style, blockMinutes }, "5m")[0].initialBalance);
    for (const ib of ranges) expect(ib).toEqual(ranges[0]);
    expect(ranges[0]).toMatchObject({ end: 60 * m, high: 112, low: 89, loadedBars: 12, status: "complete" });
  });
  it("migrates old block counts without changing their duration and makes subsequent block edits independent", () => {
    const { ibMinutes: _, ...legacy } = { ...style, blockMinutes: "240" as const, ibBlocks: 3 };
    expect(validTpo(legacy)).toBe(true);
    const migrated = resolveTpo(legacy);
    expect(migrated.ibMinutes).toBe(720);
    expect(tpoIbMinutes({ ...migrated, blockMinutes: "5" })).toBe(720);
    expect(buildTpoSessions(bars, legacy, "5m")[0].initialBalance).toEqual(buildTpoSessions(bars, migrated, "5m")[0].initialBalance);
    expect(resolveTpo({ blockMinutes: "240" }).ibMinutes).toBe(60);
    const { ibBlocks: _blocks, ...oldest } = { ...legacy, blockMinutes: "60" as const };
    expect(validTpo(oldest)).toBe(true);
    expect(resolveTpo(oldest).ibMinutes).toBe(120);
    expect(tpoIbMinutes(oldest)).toBe(120);
  });
  it("validates minute inputs and preserves them through the native settings serialization path", () => {
    for (const invalid of [0, -1, 1.5, 11521, NaN, Infinity, "60", null]) {
      expect(validTpo({ ...style, ibMinutes: invalid })).toBe(false);
      expect(resolveTpo({ ...style, ibMinutes: invalid }).ibMinutes).toBe(60);
    }
    const native = nativeSeriesPreferences({ tpo: { ...style, ibMinutes: 45, blockMinutes: "240" } } as never);
    expect(resolveTpo(JSON.parse(JSON.stringify(native.chartTypes?.tpo)))).toMatchObject({ ibMinutes: 45, blockMinutes: "240" });
    const controls = (tpoSettings().rows ?? []).filter(row => "key" in row);
    expect(controls.find(row => "key" in row && row.key === "ibMinutes")).toMatchObject({ defval: 60, min: 1, step: 1 });
    expect(controls.some(row => "key" in row && row.key === "ibBlocks")).toBe(false);
  });
  it("never includes post-IB extremes and withholds extensions until the opening window is revealed", () => {
    const prefs = { ...style, blockMinutes: "240" as const, ibMinutes: 45 };
    const developing = buildTpoSessions(bars.slice(0, 9), prefs, "5m")[0].initialBalance;
    expect(developing).toMatchObject({ high: 109, low: 92, status: "developing", end: 45 * m });
    expect(tpoIbExtension(developing, 100).upper).toBeNull();
    const complete = buildTpoSessions([...bars.slice(0, 9), bar(45 * m, -500, 500)], prefs, "5m")[0].initialBalance;
    expect(complete).toMatchObject({ high: 109, low: 92, status: "complete" });
    expect(tpoIbExtension(complete, 100)).toMatchObject({ status: "ready", upper: 126, lower: 75 });
  });
  it("excludes candles straddling an unaligned IB endpoint rather than leaking their extrema", () => {
    const coarse = [bar(0, 98, 103), bar(30 * m, -500, 500), bar(60 * m)];
    const ib = buildTpoSessions(coarse, { ...style, ibMinutes: 45 }, "30m")[0].initialBalance;
    expect(ib).toMatchObject({ end: 45 * m, high: 103, low: 98, loadedBars: 1, expectedBars: 2, missingSlots: 1, status: "incomplete" });
    expect(tpoIbExtension(ib, 100).upper).toBeNull();
    const unavailable = buildTpoSessions([bar(0), bar(240 * m)], { ...style, blockMinutes: "240" }, "4h")[0].initialBalance;
    expect(unavailable).toMatchObject({ end: 60 * m, high: null, status: "unavailable" });
  });
  it("clamps to a short session and uses elapsed minutes through a DST fold", () => {
    const short = buildTpoSessions(bars.slice(0, 7), { ...style, sessionMinutes: 30, ibMinutes: 60 }, "5m")[0].initialBalance;
    expect(short).toMatchObject({ end: 30 * m, expectedBars: 6, status: "complete" });
    const prefs = { ...style, sessionZone: "America/New_York", sessionStartMinutes: 90, ibMinutes: 90, blockMinutes: "240" as const };
    const start = tpoCalendar(prefs).forDate("2026-11-01").start;
    const ib = buildTpoSessions(bars.map(b => ({ ...b, time: start + b.time })), prefs, "5m")[0].initialBalance;
    expect(ib.end).toBe(Date.parse("2026-11-01T07:00:00Z"));
    expect(ib.loadedBars).toBe(18);
  });
  it("recomputes minute changes and historical repairs while preserving display-only cache reuse", () => {
    const cache = createTpoCache(), source = bars.map(b => ({ ...b }));
    const first = cache.read(source, style, "5m", "BTCUSDT");
    expect(cache.read(source, { ...style, ibBlocks: 12, ibColor: "#ffffff" }, "5m", "BTCUSDT")).toBe(first);
    const shorter = cache.read(source, { ...style, ibMinutes: 45 }, "5m", "BTCUSDT");
    expect(shorter).not.toBe(first); expect(shorter[0].initialBalance.high).toBe(109);
    source[0].high = 500;
    expect(cache.read(source, { ...style, ibMinutes: 45 }, "5m", "BTCUSDT")[0].initialBalance.high).toBe(500);
  });
  it("reports the minute window and partial coverage in the Data readout", () => {
    const prefs = { ...style, ibMinutes: 45 }, sessions = buildTpoSessions(bars, prefs, "5m");
    const token = Symbol(), context = { symbol: "BTCUSDT", timeframe: "5m", epoch: 1, replay: true,
      seriesRange: { first: 0, last: bars.at(-1)!.time, count: bars.length, high: 197, low: 4 }, style: prefs };
    publishTpoSurface("ib-minutes", token, { ...context, sessions });
    try {
      const result = readTpoSurface("ib-minutes", context, 0);
      expect(result.status).toBe("ready");
      expect(result.rows).toContainEqual({ label: "Initial balance duration", value: "45 min (clamped at session end)" });
      expect(result.rows.find(row => row.label === "Initial balance source")?.value).toContain("Whole loaded candles");
    } finally { clearTpoSurface("ib-minutes", token); }
  });
  it("rejects invalid direct-minute calculations", () => {
    for (const minutes of [0, .5, NaN, 11521]) expect(() => tpoInitialBalanceMinutes(bars, 0, 86400000, minutes, 5 * m, 60 * m)).toThrow();
  });
});
