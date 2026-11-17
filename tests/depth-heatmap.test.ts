import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, RendererLayerArgs } from "@luxalgo/vela";
import type { OrderBook } from "@/types/trading";
import { createDepthHeatmapProjection, DepthHeatmapCollection, defaultDepthHeatmap, depthHeatmapCells, depthHeatmapSettings, MAX_DEPTH_COLUMNS } from "@/lib/orderflow/depthHeatmap";
import { depthHeatmapDescriptor, type DepthHeatmapChannel, type DepthSource } from "@/lib/orderflow/depthHeatmapIndicator";
import { paintDepthHeatmap } from "@/lib/orderflow/depthHeatmapRenderer";
import { bindReplayClock } from "@/lib/chart/replayClock";
import { replayDepth, ReplayDepth } from "@/lib/orderflow/replayDepth";
const style = defaultDepthHeatmap();
const book = (time = 1000): OrderBook => ({ symbol: "HL:BTC", time, simulated: false, bids: [{ price: 100, quantity: 4 }, { price: 99, quantity: 2 }], asks: [{ price: 101, quantity: 3 }, { price: 102, quantity: 1 }] });
afterEach(() => vi.useRealTimers());
describe("observed order-book heatmap", () => {
  it("samples the last immutable snapshot without adding repeated resting quantities", () => {
    const collection = new DepthHeatmapCollection("HL:BTC"), first = book(); collection.add(first, 1000, style);
    first.bids[0].quantity = 500; expect(collection.read(1000, style)[0].bids[0].quantity).toBe(4);
    collection.add(book(1500), 1500, style); expect(collection.read(1500, style)).toHaveLength(1);
    collection.add(book(2000), 2000, style); const columns = collection.read(2500, style); expect(columns).toHaveLength(2);
    const model = depthHeatmapCells(columns, 2500, { ...style, rowSize: 1 });
    expect(model.cells.filter(cell => cell.from === 1500).reduce((sum, cell) => sum + cell.bid + cell.ask, 0)).toBe(10);
    expect(model.cells.every(cell => cell.to <= 2500 && cell.from >= 1500)).toBe(true);
  });
  it("leaves long gaps empty, never extends depth into the future, and expires retained observations", () => {
    const collection = new DepthHeatmapCollection("HL:BTC"); collection.add(book(), 1000, style); collection.add(book(6000), 6000, style);
    const cells = depthHeatmapCells(collection.read(6500, style), 6500, style).cells;
    expect(cells.filter(cell => cell.from === 1000).every(cell => cell.to === 4000)).toBe(true);
    expect(cells.filter(cell => cell.from === 6000).every(cell => cell.to === 6500)).toBe(true);
    expect(depthHeatmapCells(collection.read(610001, style), 610001, style).cells).toEqual([]);
  });
  it("reuses immutable price rows across updates and rebuilds when the time cut or grid changes", () => {
    const collection = new DepthHeatmapCollection("HL:BTC"), project = createDepthHeatmapProjection();
    collection.add(book(1000), 1000, style);
    collection.add(book(2000), 2000, style);
    const columns = collection.read(2100, style);
    const first = project(columns, 2100, 0);
    expect(project(collection.read(2110, style), 2100, 0)).toBe(first);
    const extended = project(columns, 2500, 0);
    expect(extended.cells[0]).toBe(first.cells[0]);
    expect(extended.cells.at(-1)?.to).toBe(2500);

    collection.add({ ...book(2500), asks: [{ price: 100.25, quantity: 3 }] }, 2500, style);
    const updated = collection.read(2600, style);
    expect(columns.at(-1)?.observedAt).toBe(2000);
    expect(updated.at(-1)?.observedAt).toBe(2500);
    const reranged = project(updated, 2600, 0);
    expect(reranged.step).toBe(.25);
    expect(reranged.cells[0]).not.toBe(first.cells[0]);
    expect(reranged).toEqual(depthHeatmapCells(updated, 2600, style));
    const sealed = project(updated, 5500, 0);
    expect(project(updated, 7000, 0)).toBe(sealed);
  });
  it("rejects simulated, mismatched, crossed, unsorted, duplicate, invalid and stale depth", () => {
    for (const invalid of [
      { ...book(), simulated: true }, { ...book(), symbol: "BTCUSDT" }, { ...book(), bids: [] },
      { ...book(), bids: [{ price: 101, quantity: 1 }] }, { ...book(), bids: [{ price: 100, quantity: -1 }] },
      { ...book(), bids: [{ price: NaN, quantity: 1 }] }, { ...book(), asks: [{ price: 102, quantity: 1 }, { price: 101, quantity: 1 }] },
      { ...book(), bids: [{ price: 100, quantity: 1 }, { price: 100, quantity: 1 }] }, { ...book(), time: -5000 }, { ...book(), time: 3000 },
      { ...book(), asks: Array.from({ length: 51 }, (_, i) => ({ price: 101 + i, quantity: 1 })) },
    ]) {
      const collection = new DepthHeatmapCollection("HL:BTC"); expect(collection.add(invalid, 1000, style)).toBe(false); expect(collection.read(1000, style)).toHaveLength(0);
    }
    const collection = new DepthHeatmapCollection("HL:BTC"); collection.add(book(2000), 2000, style);
    expect(collection.add(book(1000), 2001, style)).toBe(false); expect(collection.add(book(2000), 1999, style)).toBe(false);
  });
  it("bounds retained columns and uses exact canonical rows at decimal boundaries", () => {
    const collection = new DepthHeatmapCollection("HL:BTC"), settings = { ...style, sampleMs: 250, retentionMinutes: 30 };
    for (let i = 0; i < 1000; i++) collection.add(book(1000 + i * 250), 1000 + i * 250, settings);
    expect(collection.read(251000, settings)).toHaveLength(MAX_DEPTH_COLUMNS);
    const tiny = { ...book(), bids: [{ price: .29999999999999993, quantity: 2 }], asks: [{ price: .3, quantity: 3 }] };
    const decimal = new DepthHeatmapCollection("HL:BTC"); decimal.add(tiny, 1000, style);
    const cells = depthHeatmapCells(decimal.read(1001, style), 1001, { ...style, rowSize: .1 }).cells;
    expect(cells.find(cell => cell.bid)?.lower).toBe(.2); expect(cells.find(cell => cell.ask)?.lower).toBe(.3);
    const full = new DepthHeatmapCollection("HL:BTC");
    for (let i = 0; i < MAX_DEPTH_COLUMNS; i++) {
      const stamp = 1000 + i * 250;
      full.add({ ...book(stamp), bids: Array.from({ length: 50 }, (_, j) => ({ price: 100 - j, quantity: 1 })), asks: Array.from({ length: 50 }, (_, j) => ({ price: 101 + j, quantity: 1 })) }, stamp, settings);
    }
    const capacity = depthHeatmapCells(full.read(151000, settings), 151000, { ...settings, rowSize: 1 });
    expect(capacity.cells).toHaveLength(MAX_DEPTH_COLUMNS * 100); expect(capacity.max).toBe(1);
    expect(capacity.cells.filter(cell => cell.from === 1000).reduce((sum, cell) => sum + cell.bid + cell.ask, 0)).toBe(100);
  });
  it("rejects invalid settings and unsupported grid/quantity precision", () => {
    for (const patch of [{ sampleMs: 249 }, { sampleMs: 250.5 }, { retentionMinutes: 31 }, { rowSize: -1 }, { opacity: 0 }, { askColor: "url(evil)" }]) expect(() => depthHeatmapSettings(patch)).toThrow();
    const collection = new DepthHeatmapCollection("HL:BTC"); collection.add(book(), 1000, style);
    expect(() => depthHeatmapCells(collection.read(1001, style), 1001, { ...style, rowSize: Number.MIN_VALUE })).toThrow();
    const overflow = new DepthHeatmapCollection("HL:BTC"); overflow.add({ ...book(), bids: [{ price: 100, quantity: 1e308 }, { price: 99, quantity: 1e308 }] }, 1000, style);
    expect(() => depthHeatmapCells(overflow.read(1001, style), 1001, { ...style, rowSize: 1000 })).toThrow(/precision/);
    expect(depthHeatmapSettings({ opacity: 25, logarithmic: false })).toMatchObject({ opacity: 25, logarithmic: false });
  });
  it("paints bounded positive rectangles on normal/inverted scales and separates mixed-side coarse rows", () => {
    const collection = new DepthHeatmapCollection("HL:BTC"); collection.add(book(), 1000, style);
    for (const invert of [false, true]) {
      const rectangles: number[][] = [], text: string[] = [], ctx = { fillRect: (...v: number[]) => rectangles.push(v), fillText: (v: string) => text.push(v), measureText: (s: string) => ({ width: s.length }) } as unknown as CanvasRenderingContext2D;
      const args = { coords: { width: 800, timeToX: (time: number) => (time - 1000) / 10, priceToY: (p: number) => invert ? p : 300 - p }, bounds: { top: 0, height: 400 }, scale: {}, theme: { background: "black", textColor: "white" } } as unknown as RendererLayerArgs;
      paintDepthHeatmap(ctx, args, { now: 2000, columns: collection.read(2000, style), style: { ...style, rowSize: 1000, bidColor: "red", askColor: "red" }, message: "partial depth" });
      expect(rectangles.slice(0, 2).map(row => row.slice(0, 3))).toEqual([[0, invert ? 0 : -700, 50], [50, invert ? 0 : -700, 50]]);
      expect(rectangles.every(row => row[2] > 0 && row[3] > 0)).toBe(true); expect(text.join(" ")).toContain("Liquidity heatmap");
    }
  });
  it("reprojects the canvas on pan and maps time only once per visible snapshot", () => {
    const collection = new DepthHeatmapCollection("HL:BTC");
    collection.add(book(1000), 1000, style);
    collection.add(book(2000), 2000, style);
    const channel = { now: 2500, columns: collection.read(2500, style), style, message: "partial depth" };
    let pan = 0;
    const timeToX = vi.fn((time: number) => (time - 1000) / 10 + pan);
    const fillRect = vi.fn(), inspect = vi.fn();
    const ctx = { fillRect } as unknown as CanvasRenderingContext2D;
    const args = { coords: { width: 800, timeToX, priceToY: (price: number) => 300 - price },
      bounds: { top: 0, height: 400 }, scale: {} } as unknown as RendererLayerArgs;
    paintDepthHeatmap(ctx, args, channel, () => true, inspect);
    expect(timeToX).toHaveBeenCalledTimes(4);
    const first = fillRect.mock.calls[0][0];
    pan = 25;
    fillRect.mockClear();
    paintDepthHeatmap(ctx, args, channel, () => true, inspect);
    expect(fillRect.mock.calls[0][0]).toBe(first + 25);
    expect(inspect.mock.calls[1][0]).toBe(inspect.mock.calls[0][0]);
  });
});
describe("native depth study lifecycle", () => {
  it("shrinks recorded columns on backward seeks and clips them at the completed candle", () => {
    vi.useFakeTimers();
    const archive = new ReplayDepth();
    archive.recording = "HL:BTC";
    archive.accept(book(59000), 59000);
    archive.accept(book(119000), 119000);
    const recorded = vi.spyOn(replayDepth, "window").mockImplementation(archive.window.bind(archive));
    const data = {};
    const state = { active: true, cursorTime: 60000, nextTime: 120000 };
    const market = { symbol: "HL:BTC", timeframe: "1m" };
    const unbind = bindReplayClock({ data, market, replay: { state } } as unknown as Parameters<typeof bindReplayClock>[0]);
    let channel: DepthHeatmapChannel | undefined;
    const study = depthHeatmapDescriptor(() => () => {}, () => ({ key: "exchange", enabled: true, reason: "" }), () => 125000).create();
    const context = {
      ...market, data, live: false, bars: () => [{ time: state.cursorTime }],
      emit: () => {}, pushData: (value: DepthHeatmapChannel) => { channel = value; },
    } as unknown as NativeIndicatorContext;
    try {
      study.start(context, {});
      expect(channel?.columns?.map(column => column.observedAt)).toEqual([59000, 119000]);
      expect(depthHeatmapCells(channel!.columns!, channel!.now, style).cells.every(cell => cell.to <= 120000)).toBe(true);
      state.cursorTime = 0;
      state.nextTime = 60000;
      study.onBars();
      expect(channel?.identity?.replayThrough).toBe(60000);
      expect(channel?.columns?.map(column => column.observedAt)).toEqual([59000]);
    } finally {
      study.stop();
      unbind();
      recorded.mockRestore();
    }
  });
  function setup() {
    vi.useFakeTimers(); let now = 1000, source: DepthSource = { key: "exchange-1", enabled: true, reason: "source unavailable" }, live = true;
    const listeners: Array<(book: OrderBook) => void> = [], detach = vi.fn(); let channel: DepthHeatmapChannel;
    const push = vi.fn((next: unknown) => { if (next) channel = next as DepthHeatmapChannel; });
    const study = depthHeatmapDescriptor(receive => { listeners.push(receive); return detach; }, () => source, () => now).create();
    const ctx = { id: "depth-native", symbol: "HL:BTC", timeframe: "1m", get live() { return live; }, emit: vi.fn(), pushData: push } as unknown as NativeIndicatorContext;
    study.start(ctx, {});
    return { study, listeners, detach, push, channel: () => channel!, time: (value: number) => { now = value; }, source: (next: DepthSource) => { source = next; }, live: (value: boolean) => { live = value; } };
  }
  it("repaints depth-only events and stale clocks without another candle", () => {
    const f = setup(), repaint = vi.fn(); f.channel().repaint = repaint; f.listeners[0](book()); expect(f.channel().columns).toHaveLength(1); expect(repaint).toHaveBeenCalledTimes(1);
    f.time(7000); vi.advanceTimersByTime(1000); expect(f.channel().message).toContain("STALE"); expect(depthHeatmapCells(f.channel().columns!, 7000, style).cells.every(cell => cell.to <= 4000)).toBe(true); f.study.stop();
  });
  it("excludes all live depth in Replay and clears history on clock/source changes", () => {
    const f = setup(); f.listeners[0](book()); f.live(false); f.study.onBars(); expect(f.channel().columns).toBeUndefined(); expect(f.channel().message).toContain("Depth Replay unavailable");
    expect(f.detach).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    f.time(2000); f.listeners[0](book(2000)); expect(f.channel().columns).toBeUndefined(); f.live(true); f.study.onBars(); expect(f.channel().columns).toHaveLength(0);
    f.listeners[1](book(2000)); f.source({ key: "exchange-2", enabled: true, reason: "" }); f.study.onBars(); expect(f.channel().columns).toHaveLength(0);
    f.source({ key: "simulation", enabled: false, reason: "no order book" }); f.listeners[1](book(2000)); expect(f.channel().columns).toBeUndefined(); expect(f.channel().message).toBe("no order book"); f.study.stop();
  });
  it("does not invalidate the canvas once the idle live model and stale notice stop changing", () => {
    const f = setup(), repaint = vi.fn();
    f.channel().repaint = repaint;
    f.listeners[0](book());
    f.time(7000); vi.advanceTimersByTime(1000);
    expect(f.channel().message).toContain("STALE");
    repaint.mockClear();
    f.time(8000); f.study.onBars(); vi.advanceTimersByTime(1000);
    expect(repaint).not.toHaveBeenCalled();
    f.study.stop();
  });
  it("resets sampling history on sampling edits, retains it for colors, and fences detached callbacks", () => {
    const f = setup(); f.listeners[0](book()); f.study.setInputs({ bidColor: "#2962ff" }); expect(f.channel().columns).toHaveLength(1);
    f.study.setInputs({ sampleMs: 2000 }); expect(f.channel().columns).toHaveLength(0);
    f.study.suspend(); expect(f.detach).toHaveBeenCalledTimes(1); expect(f.push).toHaveBeenLastCalledWith(null);
    f.study.resume(); f.listeners[0](book()); expect(f.channel().columns).toHaveLength(0);
    f.listeners[1](book()); expect(f.channel().columns).toHaveLength(1); f.study.stop(); expect(f.detach).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
    f.listeners[1](book()); expect(f.push).toHaveBeenLastCalledWith(null);
  });
});

it("derives an exact cent grid from adjacent high-priced Binance levels", () => {
  const settings = defaultDepthHeatmap();
  const result = depthHeatmapCells([{
    observedAt: 1000, exchangeTime: 1000,
    bids: [{ price: 77000.01, quantity: 2 }],
    asks: [{ price: 77000.02, quantity: 3 }],
  }], 2000, settings);
  expect(result.step).toBe(0.01);
  expect(result.cells.map(({ lower, upper }) => [lower, upper])).toEqual([
    [77000.01, 77000.02], [77000.02, 77000.03],
  ]);
});
