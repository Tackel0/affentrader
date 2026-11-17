import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createDrawing, deserializeDrawing, type Projector } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { FixedTailsCache, fixedTailsWindow } from "@/lib/orderflow/fixedTails";
import { defaultTails } from "@/lib/orderflow/volumeTails";
import { FixedVolumeTails, FIXED_TAILS_TYPE, registerFixedTails } from "@/lib/drawings/fixedTailsPlugin";
import { nativeDrawingTool } from "@/lib/drawings/preferences";
import { bindCellContext, type CellContext } from "@/lib/chart/cellContext";
import { clearExecutionRangeWatch } from "@/lib/orderflow/executionRangeSource";
import { marketService } from "@/lib/market/service";
import { useChartStore } from "@/stores/useChartStore";
import { studyTradeSource } from "@/lib/orderflow/studyTradeSource";

const base = Date.UTC(2026, 10, 4, 12), minute = 60000, symbol = "BTCUSDT";
const tick = (id: string, offset: number, price: number, quantity: number, side: Tick["side"] = "buy"): Tick => ({ id, symbol, time: base + offset, price, quantity, side, simulated: false });
const bars = [0, minute, 2 * minute].map(offset => ({ time: base + offset, open: 100, high: 120, low: 90, close: 110, volume: 100 }));
const anchors = (from = 0, to?: number) => [{ time: base + from, price: 100 }, ...(to === undefined ? [] : [{ time: base + to, price: 100 }])];
const cleanup: Array<() => void> = []; let sequence = 0;
beforeEach(() => { useChartStore.getState().set({ feedMode: "auto", dataSources: { [`${symbol}:1m`]: "exchange" }, marketEpochs: {} }); registerFixedTails(); });
afterEach(() => { cleanup.splice(0).forEach(f => f()); studyTradeSource.clear(symbol); vi.restoreAllMocks(); vi.useRealTimers(); });

it("includes both fixed candle anchors, normalizes reversed placement and leaves a single end open", () => {
  expect(fixedTailsWindow(anchors(0, minute), false, bars, "1m")).toEqual(bars.slice(0, 2));
  expect(fixedTailsWindow(anchors(minute, 0), false, bars, "1m")).toEqual(bars.slice(0, 2));
  expect(fixedTailsWindow(anchors(minute), false, bars, "1m")).toEqual(bars.slice(1));
  expect(fixedTailsWindow(anchors(0, minute), true, bars, "1m")).toEqual(bars);
});
it("excludes forming/future Replay bars even with an open or future anchored end", () => {
  expect(fixedTailsWindow(anchors(0), true, bars, "1m", base + minute)).toEqual(bars.slice(0, 1));
  expect(fixedTailsWindow(anchors(0, 10 * minute), false, bars, "1m", base + 2 * minute)).toEqual(bars.slice(0, 2));
  expect(fixedTailsWindow(anchors(3 * minute), false, bars, "1m")).toEqual([]);
  expect(fixedTailsWindow([], false, bars, "1m")).toEqual([]);
});
it("rejects unordered bars/invalid anchors and uses classified quantities at exclusive candle ends", () => {
  expect(() => fixedTailsWindow([{ time: NaN, price: 1 }], false, bars, "1m")).toThrow(/anchors/);
  expect(() => fixedTailsWindow(anchors(), false, [...bars].reverse(), "1m")).toThrow(/ascending/);
  const cache = new FixedTailsCache(), input = [tick("a", 1, 100, 3), tick("b", minute + 1, 110, 5, "sell"), tick("edge", 2 * minute, 120, 999)];
  const r = cache.read(anchors(0, minute), false, bars, "1m", input, defaultTails(), symbol, "source")!;
  expect(r).toMatchObject({ total: 8, observations: 2, start: base, end: base + 2 * minute });
  expect(() => cache.read(anchors(), true, bars, "100T", input, defaultTails(), symbol, "source")).toThrow(/time interval/);
  expect(() => cache.read(anchors(), true, bars, "1m", input.map(t => ({ ...t, symbol: "ETHUSDT" })), defaultTails(), symbol, "source")).toThrow(/combine markets/);
});
it("invalidates equal-endpoint range results after an archive/source revision or new quantities", () => {
  const cache = new FixedTailsCache(), first = [tick("a", 1, 100, 3)];
  const initial = cache.read(anchors(), true, bars, "1m", first, defaultTails(), symbol, "a");
  expect(cache.read(anchors(), true, bars, "1m", first, defaultTails(), symbol, "a")).toBe(initial);
  expect(cache.read(anchors(), true, bars, "1m", [tick("b", 1, 110, 8)], defaultTails(), symbol, "b")!.total).toBe(8);
  expect(cache.read(anchors(), true, bars, "1m", [], defaultTails(), symbol, "c")).toBeNull();
});
it("registers one/two-click construction and round-trips anchors, open mode and independent style settings", () => {
  expect(nativeDrawingTool("fixed-tails")).toBe(FIXED_TAILS_TYPE);
  const drawing = createDrawing(FIXED_TAILS_TYPE, { paneId: "price", anchors: anchors(0, minute) })! as FixedVolumeTails;
  expect(drawing.placementMode()).toBe("click"); expect(drawing.anchorSchema()).toMatchObject({ min: 1, max: 2, slots: [{ free: "x" }, { free: "x" }] });
  drawing.applySettings({ "tails.threshold": 17, "tails.supplyWeighted": true, "tails.demandColor": "#123456", followLatest: true });
  const restored = deserializeDrawing(drawing.serialize()) as FixedVolumeTails;
  expect(restored.type).toBe(FIXED_TAILS_TYPE); expect(restored.anchors).toEqual(drawing.anchors);
  expect(restored.tails).toMatchObject({ threshold: 17, supplyWeighted: true, demandColor: "#123456" }); expect(restored.followLatest).toBe(true);
  expect(restored.timeExtent()).toBeNull(); restored.applyProps({ ...restored.serialize().props, followLatest: false });
  expect(restored.timeExtent()).toEqual({ min: base, max: base + minute });
  expect(restored.schema().fields.map(f => f.path)).toContain("tails.equilibriumWeighted");
});

function environment() {
  const id = `fixed-tails-test-${++sequence}`, host = { dataset: {} }, cell: CellContext = { id, symbol, timeframe: "1m", replay: false };
  const canvas = { closest: () => host, isConnected: true } as unknown as HTMLCanvasElement;
  cleanup.push(bindCellContext(host as unknown as HTMLElement, () => cell));
  let input = [tick("buy", 1, 100, 3), tick("sell", minute + 1, 110, 5, "sell")];
  vi.spyOn(marketService, "tradesFor").mockImplementation(() => input);
  const listeners = new Set<(t: Tick) => void>();
  vi.spyOn(marketService, "onTick").mockImplementation(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; });
  const projector = { width: 500, height: 300, xOf: (time: number) => (time - base) / minute * 100, yOf: (price: number) => 200 - price,
    paneIdAtY: () => "price", paneRect: () => ({ top: 10, height: 250 }), pxToPoint: (x: number, y: number) => ({ time: base + x / 100 * minute, price: 200 - y }),
    barsInRange: (from: number, to: number) => bars.filter(b => b.time >= from && b.time <= to), afCanvas: canvas, afRepaint: vi.fn() } as Projector;
  const drawing = new FixedVolumeTails({ id, paneId: "price", anchors: anchors(0, minute) }); cleanup.push(() => clearExecutionRangeWatch(drawing));
  return { id, cell, canvas, projector, drawing, callbacks: () => [...listeners], replace: (trades: Tick[]) => { input = trades; }, receive: (t: Tick) => listeners.forEach(cb => cb(t)) };
}
it("uses the owning chart source, supports axis-only anchor drags and invalidates moved ranges", () => {
  const h = environment(); expect(h.drawing.compute(h.projector).drawing!.total).toBe(8);
  expect(h.drawing.handlePoints(h.projector)).toEqual([[0, 135], [100, 135]]);
  expect(h.drawing.hitHandle(100, 240, h.projector, 4)).toBe(1); expect(h.drawing.hitHandle(100, 500, h.projector, 4)).toBe(-1);
  expect(h.drawing.hitTest(100, 30, h.projector, 4)).toBe(true);
  h.drawing.anchors[1].time = base; expect(h.drawing.compute(h.projector).drawing!.total).toBe(3);
});
it("retains observed quantities beyond the display tape and through native rehydration after edits", () => {
  vi.useFakeTimers(); const h = environment(); h.drawing.compute(h.projector);
  const next = tick("new", 2 * minute + 1, 120, 4); h.replace([next]); h.receive(next); vi.runAllTimers();
  const restored = deserializeDrawing(h.drawing.serialize()) as FixedVolumeTails; cleanup.push(() => clearExecutionRangeWatch(restored));
  restored.followLatest = true;
  expect(restored.compute(h.projector).drawing).toMatchObject({ total: 12, observations: 3 });
});
it("does not show cached exchange tails when the source/Replay becomes unavailable", () => {
  const h = environment(); expect(h.drawing.compute(h.projector).drawing).not.toBeNull();
  h.cell.replay = true; h.cell.replayThrough = base + minute;
  expect(h.drawing.compute(h.projector).drawing).toBeNull(); expect(h.drawing.priceRange()).toBeNull();
  expect(h.drawing.compute(h.projector).message).toContain("Replay needs");
});
it("ignores callbacks captured before a replacement range watch", () => {
  const h = environment(); h.drawing.compute(h.projector); const old = h.callbacks()[0];
  h.cell.timeframe = "5m"; useChartStore.getState().set({ dataSources: { [`${symbol}:5m`]: "exchange" } });
  expect(h.drawing.compute(h.projector).drawing!.total).toBe(8);
  old(tick("stale-old-watch", 1, 100, 100));
  expect(h.drawing.compute(h.projector).drawing!.total).toBe(8);
});
it("rebuilds archived fixed tails through backward seeks, never retaining future executions", () => {
  const h = environment(), input = [tick("past", 1, 100, 3), tick("future", minute + 1, 110, 999)];
  studyTradeSource.install({ selection: { symbol, from: base, to: base + 3 * minute }, trades: input, first: input[0].time, last: input[1].time,
    buyVolume: "1002", sellVolume: "0", delta: "1002", coverage: "observed-only" });
  h.cell.replay = true; h.cell.replayThrough = base + minute; h.drawing.followLatest = true;
  expect(h.drawing.compute(h.projector).drawing!.total).toBe(3);
  h.cell.replayThrough = base + 2 * minute; expect(h.drawing.compute(h.projector).drawing!.total).toBe(1002);
  h.cell.replayThrough = base + minute; expect(h.drawing.compute(h.projector).drawing!.total).toBe(3);
});
it("clears results when the owning market changes instead of reusing another chart's retained range", () => {
  const h = environment(); h.drawing.compute(h.projector); h.cell.symbol = "ETHUSDT";
  expect(h.drawing.compute(h.projector).drawing).toBeNull(); expect(h.drawing.priceRange()).toBeNull();
});
it("routes all five pinned native painters through the extension hook while preserving the built-in path", () => {
  const dist = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela"));
  const bodies = readdirSync(dist).filter(n => /\.(js|cjs)$/.test(n) && !n.endsWith(".min.js")).flatMap(n => {
    const source = readFileSync(path.join(dist, n), "utf8");
    return [...source.matchAll(/paintOne\(ctx, d, proj, theme\) \{\s*(\/\* Affentrader registered drawing paint v1 \*\/\s*if \(typeof d.afPaint === "function"\) \{ d.afPaint\(ctx, proj, theme\); return; \})/g)].map(m => m[1]);
  });
  expect(bodies).toHaveLength(5);
  for (const body of bodies) {
    const paint = new Function("ctx", "d", "proj", "theme", `${body}; return "builtin";`), afPaint = vi.fn();
    expect(paint("ctx", { afPaint }, "proj", "theme")).toBeUndefined(); expect(afPaint).toHaveBeenCalledWith("ctx", "proj", "theme");
    expect(paint("ctx", {}, "proj", "theme")).toBe("builtin");
  }
});
