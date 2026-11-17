import { afterEach, describe, expect, it } from "vitest";
import { buildTpoSessions, createTpoCache } from "@/lib/orderflow/tpoModel";
import { defaultTpo } from "@/lib/orderflow/tpoSettings";
import { clearTpoSurface, publishTpoSurface, readTpoSurface } from "@/lib/orderflow/tpoReadout";

const minute = 60000, style = { ...defaultTpo(), rowSize: .1, blockMinutes: "5" as const };
const bar = (time: number, low: number, high = low) => ({ time, low, high, open: low, close: high, volume: 1 });
const bars = [bar(0, .2, .3), bar(5 * minute, .3), bar(15 * minute, .3, .4)];
const range = { first: 0, last: 15 * minute, count: 3, high: .4, low: .3 };
const context = { symbol: "HL:BTC", timeframe: "5m", epoch: 2, replay: false, seriesRange: range }, owner = Symbol("TPO"), newer = Symbol("newer");
const sessions = buildTpoSessions(bars, style, "5m", context.symbol);
function publish(cell = "primary", token = owner) { publishTpoSurface(cell, token, { ...context, sessions, style }); }
const read = (time = 0) => readTpoSurface("primary", context, time);
afterEach(() => { for (const cell of ["primary", "cell-2"]) for (const token of [owner, newer]) clearTpoSurface(cell, token); });

describe("native TPO inspection and repaired-history calculation", () => {
  it("counts whole revealed session opportunities and exact grid/value-area bounds without volume claims", () => {
    publish(); const result = read(), values = Object.fromEntries(result.rows.map(row => [row.label, row.value]));
    expect(result.status).toBe("ready"); expect(result.message).toContain("not trade volume");
    expect(values).toMatchObject({ "TPO opportunities": "5", "POC opportunities": "3", "POC row [lower, upper)": "[0.3, 0.4)", "POC price": "0.35",
      "Observed blocks": "3", "Loaded candle slots": "3", "Missing slots through last candle": "1", "Rows visited by one block": "2", "Price rows": "3" });
    expect(read(86400000)).toMatchObject({ status: "empty", rows: [] }); expect(read(-1).status).toBe("empty");
    expect(readTpoSurface("primary", context, undefined).status).toBe("waiting");
  });
  it("reports a missing opening and internal gaps rather than implying complete session history", () => {
    const sliced = buildTpoSessions(bars.slice(1), style, "5m", context.symbol)[0];
    expect(sliced.partialStart).toBe(true); expect(sliced.coverage).toMatchObject({ loadedBars: 2, missingSlots: 2, firstBar: 5 * minute, lastBar: 15 * minute });
    publishTpoSurface("primary", owner, { ...context, sessions: [sliced], style }); expect(read().message).toContain("Missing candle slots");
    expect(read().rows.find(row => row.label === "Session opening loaded")?.value).toBe("No");
  });
  it("invalidates older in-place high/low/time repairs and recovers after invalid data is corrected", () => {
    const source = bars.map(bar => ({ ...bar })), cache = createTpoCache(), original = cache.read(source, style, "5m", context.symbol);
    source[0].low = .1; const corrected = cache.read(source, style, "5m", context.symbol);
    expect(corrected).not.toBe(original); expect(corrected).toEqual(buildTpoSessions(source, style, "5m", context.symbol));
    source[0].high = .5; expect(cache.read(source, style, "5m", context.symbol)).toEqual(buildTpoSessions(source, style, "5m", context.symbol));
    source[1].time += 1; expect(() => cache.read(source, style, "5m", context.symbol)).toThrow(/session boundary/);
    source[1].time -= 1; expect(cache.read(source, style, "5m", context.symbol)).toEqual(buildTpoSessions(source, style, "5m", context.symbol));
    source[0].low = NaN; expect(() => cache.read(source, style, "5m", context.symbol)).toThrow();
    source[0].low = .2; expect(cache.read(source, style, "5m", context.symbol)).toEqual(buildTpoSessions(source, style, "5m", context.symbol));
  });
  it("refreshes quote metadata while reusing display-only edits, and rebuilds for mathematical settings", () => {
    const source = bars.map(bar => ({ ...bar })), cache = createTpoCache(), first = cache.read(source, style, "5m", context.symbol);
    source[0].volume = 10000; source[0].close = .25;
    const updated = cache.read(source, style, "5m", context.symbol);
    expect(updated).not.toBe(first);
    expect(cache.read(source, { ...style, splitPeriods: true, textColor: "#123456" }, "5m", context.symbol)).toBe(updated);
    expect(cache.read(source, { ...style, rowSize: .2 }, "5m", context.symbol)).not.toBe(first);
  });
  it("fences source/cell/interval/Replay changes and late destruction of replaced layers", () => {
    publish("cell-2"); expect(read().status).toBe("waiting"); publish();
    for (const patch of [{ symbol: "HL:ETH" }, { timeframe: "1m" }, { epoch: 3 }, { replay: true }]) expect(readTpoSurface("primary", { ...context, ...patch }, 0).rows).toEqual([]);
    publish("primary", newer); clearTpoSurface("primary", owner); expect(read().status).toBe("ready"); clearTpoSurface("primary", newer); expect(read().status).toBe("waiting");
  });
  it("never serves a longer Replay prefix or different developing tail while native model painting is pending", () => {
    publishTpoSurface("primary", owner, { ...context, replay: true, sessions, style });
    const replay = { ...context, replay: true };
    expect(readTpoSurface("primary", replay, 0).message).toContain("REPLAY");
    for (const patch of [{ first: 300000 }, { last: 300000 }, { count: 2 }, { high: .5 }, { low: .2 }])
      expect(readTpoSurface("primary", { ...replay, seriesRange: { ...range, ...patch } }, 0)).toMatchObject({ status: "waiting", rows: [] });
    const prefix = bars.slice(0, 1), prefixRange = { first: 0, last: 0, count: 1, high: .3, low: .2 };
    publishTpoSurface("primary", owner, { ...replay, seriesRange: prefixRange, sessions: buildTpoSessions(prefix, style, "5m", context.symbol), style });
    const result = readTpoSurface("primary", { ...replay, seriesRange: prefixRange }, 0);
    expect(result.rows.find(row => row.label === "TPO opportunities")?.value).toBe("2");
  });
  it("preserves explicit calculation errors without returning old profile numbers", () => {
    publish(); publishTpoSurface("primary", owner, { ...context, error: "row capacity" });
    expect(read()).toEqual({ status: "error", message: "TPO unavailable: row capacity", rows: [] });
  });
});
