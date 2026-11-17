import { afterEach, describe, expect, it } from "vitest";
import type { Tick, FootprintDeltaPath } from "@/types/trading";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import { createFootprintInspection, footprintInspectionCsv } from "@/lib/orderflow/footprintInspection";
import { captureFootprintInspection, clearFootprintSurface, publishFootprintSurface, readFootprintSurface } from "@/lib/orderflow/footprintReadout";
const settings = { step: 1, ratio: 3, minimumVolume: 0, ignoreZeroOpposite: false, minimumStackRows: 3 };
const tick = (id: string, time: number, delta: number, seq?: number): Tick => ({ id, time, quantity: Math.abs(delta), price: 100,
  symbol: "HL:BTC", simulated: false, side: delta < 0 ? "sell" : "buy", ...(seq === undefined ? {} : { seq }) });
const token = Symbol("delta-path"), context = { symbol: "HL:BTC", timeframe: "1m", epoch: 1, replay: false, sourceStamp: "source1" };
afterEach(() => clearFootprintSurface("primary", token));
describe("observed Footprint intra-candle delta", () => {
  it("distinguishes paths with identical final row totals and includes the initial zero", () => {
    const a = new FootprintHistory("1m"), b = new FootprintHistory("1m");
    a.add([tick("a", 1000, 10), tick("b", 2000, -15), tick("c", 3000, 8)]);
    b.add([tick("a", 1000, -15), tick("b", 2000, 10), tick("c", 3000, 8)]);
    expect(a.read(settings)).toEqual(b.read(settings));
    expect(a.readDelta(0)).toMatchObject({ high: 10, low: -5, close: 3, executions: 3, first: 1000, last: 3000 });
    expect(b.readDelta(0)).toMatchObject({ high: 3, low: -15, close: 3 });
    expect(a.readDelta(60000)).toBeUndefined();
  });
  it("reorders late executions by timestamp, sequence and ID instead of delivery order", () => {
    const a = tick("z", 1000, -10, 2), b = tick("b", 1000, 8, 1), c = tick("c", 1000, 3);
    const history = new FootprintHistory("1m"); history.add([c]); history.add([a]); history.add([b]);
    expect(history.readDelta(0)).toMatchObject({ high: 8, low: -2, close: 1 });
    const ids = new FootprintHistory("1m"); ids.add([tick("b", 1000, -10), tick("a", 1000, 8)]);
    expect(ids.readDelta(0)).toMatchObject({ high: 8, low: -2, close: -2 });
  });
  it("deduplicates IDs and keeps path extrema independent of row size and imbalance filters", () => {
    const history = new FootprintHistory("1m"), trades = [tick("a", 1000, 10), tick("b", 2000, -15), tick("c", 3000, 8)];
    history.add(trades); const path = history.readDelta(0); history.add(trades);
    expect(history.readDelta(0)).toBe(path);
    for (const step of [.1, 10]) history.read({ ...settings, step, minimumVolume: 100, ignoreZeroOpposite: true });
    expect(history.readDelta(0)).toBe(path); expect(Object.isFrozen(path)).toBe(true);
  });
  it("evicts entire paths and isolates simulation, retaining earlier frozen snapshots", () => {
    const history = new FootprintHistory("1m", { trades: 3, bars: 2, rows: 20 });
    history.add([tick("a", 1000, 10)]); const old = history.readDelta(0)!;
    history.add([tick("b", 61000, -3), tick("c", 121000, 2)]);
    expect(history.readDelta(0)).toBeUndefined(); expect(old.high).toBe(10);
    history.add([{ ...tick("sim", 181000, 4), simulated: true }]); history.add([tick("stale", 120000, -100)]);
    expect(history.readDelta(120000)).toBeUndefined(); expect(history.readDelta(180000)?.close).toBe(4);
  });
  it("publishes matching frozen path revisions rather than reading a newer mutable history", () => {
    const history = new FootprintHistory("1m"); history.add([tick("a", 1000, 10)]);
    const bars = history.read(settings), path = history.readDelta(0)!;
    publishFootprintSurface("primary", token, { ...context, bars, simulated: false, dropped: 0, analysis: settings, deltaPaths: new Map([[0, path]]) });
    const read = readFootprintSurface("primary", context, 0), target = read.inspectionTarget!;
    history.add([tick("late", 2000, -15)]);
    const captured = captureFootprintInspection(target, "source1", 5000)!;
    expect(captured.deltaPath).toMatchObject({ high: 10, low: 0, close: 10, executions: 1 });
    expect(captured.delta).toBe(10); expect(history.readDelta(0)?.close).toBe(-5);
    expect(read.rows.find(row => row.label === "Observed maximum delta")?.value).toBe("10");
    expect(footprintInspectionCsv(captured)).toContain('"observed_delta_max","observed_delta_min"');
    expect(Object.isFrozen(captured.deltaPath)).toBe(true);
  });
  it("rejects future/malformed path metadata and does not invent extrema for legacy rows", () => {
    const history = new FootprintHistory("1m"); history.add([tick("a", 1000, 10)]); const bar = history.read(settings)[0], path = history.readDelta(0)!;
    const source = { symbol: "HL:BTC", timeframe: "1m", simulated: false, coverage: "observed only", replayThrough: 60000 };
    expect(createFootprintInspection(bar, settings, source).deltaPath).toBeUndefined();
    for (const patch of [{ high: -1 }, { low: 1 }, { close: 11 }, { last: 60000 }, { first: -1 }, { executions: 0 }, { ordering: "arrival" }]) {
      expect(() => createFootprintInspection(bar, settings, { ...source, deltaPath: { ...path, ...patch } as FootprintDeltaPath })).toThrow(/delta path/);
    }
  });
  it("matches an independent ordered prefix sum under shuffled delivery and keeps each candle separate", () => {
    const trades = Array.from({ length: 12000 }, (_, i) => tick(String(i), (i * 7919) % 180000, (i % 5 === 0 ? -1 : 1) * (1 + i % 7) / 100, i));
    const history = new FootprintHistory("1m");
    for (let offset = trades.length; offset > 0; offset -= 37) history.add(trades.slice(Math.max(0, offset - 37), offset).reverse());
    for (const start of [0, 60000, 120000]) {
      const selected = trades.filter(t => t.time >= start && t.time < start + 60000).sort((a, b) => a.time - b.time || a.seq! - b.seq!);
      let total = 0, high = 0, low = 0;
      for (const t of selected) { total += t.side === "buy" ? t.quantity : -t.quantity; high = Math.max(high, total); low = Math.min(low, total); }
      const actual = history.readDelta(start)!;
      expect(actual.close).toBeCloseTo(total, 9); expect(actual.high).toBeCloseTo(high, 9); expect(actual.low).toBeCloseTo(low, 9); expect(actual.executions).toBe(selected.length);
    }
  });
  it("supports the complete 100,000-execution bar limit and fails closed before exposing an oversized path", () => {
    const history = new FootprintHistory("1m");
    history.add(Array.from({ length: 100000 }, (_, i) => tick(String(i), 1000, i % 2 ? -1 : 1, i)));
    const snapshot = history.readDelta(0)!;
    expect(snapshot).toMatchObject({ high: 1, low: 0, close: 0, executions: 100000 });
    expect(() => history.add([tick("overflow", 1001, 1)])).toThrow(/One footprint bar/);
    expect(() => history.readDelta(0)).toThrow(/One footprint bar/);
    expect(snapshot.executions).toBe(100000);
  });
});
