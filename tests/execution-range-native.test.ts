import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDrawing, deserializeDrawing, type Drawing, type OHLCV, type Projector, type RendererLayerArgs } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import type { FixedProfileResult } from "@/lib/orderflow/fixedProfileModel";
import { registerFixedProfileConstruction } from "@/lib/drawings/fixedProfilePlugin";
import { bindCellContext, type CellContext } from "@/lib/chart/cellContext";
import { executionRangeSource, watchExecutionRange, clearExecutionRangeWatch } from "@/lib/orderflow/executionRangeSource";
import { studyTradeSource } from "@/lib/orderflow/studyTradeSource";
import { marketService } from "@/lib/market/service";
import { useChartStore } from "@/stores/useChartStore";
import { VisibleProfileCache } from "@/lib/orderflow/visibleProfile";
import { paintVisibleProfile } from "@/lib/orderflow/visibleProfileRenderer";
import { profileJobs, type ProfileResponse } from "@/lib/orderflow/profileJobs";
import { ExecutionRangeProfileCache } from "@/lib/orderflow/executionRangeProfile";
const base = Date.UTC(2026, 10, 1, 12), symbol = "HL:BTC", minute = 60000;
const bars: OHLCV[] = [0, minute, 2 * minute].map(offset => ({ time: base + offset, open: 100, low: 50, high: 200, close: 150, volume: 999999 }));
const tick = (id: string, price: number, quantity: number, offset = 1, side: Tick["side"] = "buy"): Tick => ({ id, symbol, time: base + offset, price, quantity, side, simulated: false });
let trades: Tick[], cell: CellContext; const owners: object[] = [], cleanups: Array<() => void> = [];
function fixture() {
  const host = { dataset: {} } as unknown as HTMLElement, canvas = { isConnected: true, closest: () => host } as unknown as HTMLCanvasElement;
  cleanups.push(bindCellContext(host, () => cell));
  const projector: Projector & { afCanvas: HTMLCanvasElement; afRepaint: () => void } = { width: 1000, height: 600, xOf: time => time - base, yOf: price => 300 - price,
    paneIdAtY: () => "price", pxToPoint: (x, y) => ({ time: base + x, price: y }), barsInRange: (from, to) => bars.filter(bar => bar.time >= from && bar.time <= to), afCanvas: canvas, afRepaint: vi.fn() };
  return { canvas, projector };
}
interface Shape extends Drawing { volumeSource: string; compute(p: Projector): FixedProfileResult | null; frvpNotice: string }
const drawing = () => { const shape = createDrawing("fixedrangevp", { id: "classified-fixed", paneId: "price", anchors: [{ time: base + minute, price: 100 }, { time: base, price: 100 }], props: { rows: 4, volumeSource: "Classified executions" } })! as Shape; owners.push(shape); return shape; };
function archive(input = trades) { studyTradeSource.install({ selection: { symbol, from: base, to: base + 3 * minute }, trades: input, first: input[0]?.time ?? null, last: input.at(-1)?.time ?? null, coverage: "observed-only", buyVolume: "0", sellVolume: "0", delta: "0" }); }
registerFixedProfileConstruction();
beforeEach(() => {
  trades = [tick("a", 100, 3), tick("b", 101, 2, minute + 1, "sell"), tick("later", 102, 99, 2 * minute)];
  cell = { id: "primary", symbol, timeframe: "1m", replay: false };
  useChartStore.setState({ feedMode: "auto", dataSources: { [`${symbol}:1m`]: "exchange" }, marketEpochs: { [symbol]: 0 } });
  vi.spyOn(marketService, "tradesFor").mockImplementation(() => trades);
});
afterEach(() => { owners.splice(0).forEach(clearExecutionRangeWatch); cleanups.splice(0).forEach(off => off()); studyTradeSource.clear(symbol); vi.restoreAllMocks(); vi.useRealTimers(); });
describe("native classified fixed and visible range profiles", () => {
  it("retains native drawing construction, exact row geometry and source persistence", () => {
    const shape = drawing(), { projector } = fixture(), result = shape.compute(projector)!;
    expect(result).toMatchObject({ executions: 2, total: 5, buys: 3, sells: 2 }); expect(result.profile.rows.reduce((sum, row) => sum + row.up + row.down, 0)).toBe(5);
    expect(shape.frvpNotice).toContain("observed classified"); expect(shape.priceRange()).toEqual({ min: 100, max: 101 });
    expect(shape.schema().fields.find(field => field.path === "volumeSource")?.kind).toBe("select");
    const doc = JSON.parse(JSON.stringify(shape.serialize())), restored = deserializeDrawing(doc)! as Shape; owners.push(restored);
    expect(doc.props.volumeSource).toBe("Classified executions"); expect(restored.volumeSource).toBe("Classified executions"); expect(restored.compute(projector)!.total).toBe(5);
    restored.applyProps({ volumeSource: "OHLCV estimate" }); expect(restored.compute(projector)!.total).toBe(1999998); expect(restored.frvpNotice).toContain("OHLCV estimate");
  });
  it("uses only loaded archive prefixes in Replay and never substitutes missing OHLCV volume", () => {
    archive(); cell = { ...cell, replay: true, replayThrough: base + minute }; trades = [tick("live", 105, 1e9)];
    const shape = drawing(), { projector } = fixture(); expect(shape.compute(projector)).toMatchObject({ total: 3, executions: 1 }); expect(shape.frvpNotice).toContain("REPLAY");
    cell.replayThrough = base + 2 * minute; expect(shape.compute(projector)!.total).toBe(5);
    cell.replayThrough = base + minute; expect(shape.compute(projector)!.total).toBe(3);
    studyTradeSource.clear(symbol); expect(shape.compute(projector)).toBeNull(); expect(shape.frvpNotice).toContain("Replay needs");
    expect(shape.priceRange()).toBeNull();
  });
  it("isolates simulation from real archives and refuses an unknown chart source", () => {
    archive(); useChartStore.setState({ dataSources: { [`${symbol}:1m`]: "simulation" }, feedMode: "simulation" }); trades = [{ ...tick("sim", 110, 7), simulated: true }];
    expect(executionRangeSource(cell, bars).execution.trades).toEqual(trades); expect(executionRangeSource(cell, bars).label).toContain("SIMULATED");
    cell.replay = true; cell.replayThrough = base + minute; expect(() => executionRangeSource(cell, bars)).toThrow(/exchange/);
    cell.replay = false; useChartStore.setState({ dataSources: {} }); expect(() => executionRangeSource(cell, bars)).toThrow(/Wait/);
  });
  it("paints actual classified visible rows and source quantities; panning changes the selected interval", () => {
    const cache = new VisibleProfileCache(), text: string[] = [], rects: number[][] = [];
    const ctx = { fillRect: (...a: number[]) => rects.push(a), strokeRect() {}, fillText: (s: string) => text.push(s), measureText: (s: string) => ({ width: s.length * 3 }) } as unknown as CanvasRenderingContext2D;
    let range = { from: 0, to: 0 };
    const args = { data: { volumeSource: "Classified executions", rows: 4 }, bars, coords: { width: 800, visibleLogicalRange: () => range, priceToY: (price: number) => 300 - price }, bounds: { top: 0, height: 300 }, scale: {}, theme: { background: "#000", textColor: "#fff" } } as unknown as RendererLayerArgs;
    paintVisibleProfile(ctx, args, cache, () => cell); expect(text).toContain("VRVP · Classified executions"); expect(text.join(" ")).toContain("1 trades"); expect(text.join(" ")).toContain("buys 3");
    text.length = 0; range = { from: 1, to: 1 }; paintVisibleProfile(ctx, args, cache, () => cell); expect(text.join(" ")).toContain("sells 2");
    text.length = 0; trades = []; paintVisibleProfile(ctx, args, cache, () => cell); expect(text.join(" ")).toContain("No observed classified"); expect(rects.every(rect => rect[2] > 0 && rect[3] > 0)).toBe(true);
  });
  it("rejects obsolete background classified input before a native drawing can repaint it", () => {
    trades = Array.from({ length: 10001 }, (_, i) => tick(String(i), 100 + i % 10, .01, i));
    const pending: Array<(response: ProfileResponse) => void> = [];
    vi.spyOn(profileJobs, "submit").mockImplementation((_owner, _bars, _options, complete) => { pending.push(complete); });
    const shape = drawing(), { projector } = fixture(); expect(shape.compute(projector)).toBeNull(); expect(shape.frvpNotice).toContain("Calculating classified");
    const result = new ExecutionRangeProfileCache().read(bars.slice(0, 2), { rows: 4, valueAreaPct: 70, developing: false }, trades, "1m");
    trades = [tick("replacement", 150, 5)]; pending[0]({ id: 1, result }); expect(projector.afRepaint).not.toHaveBeenCalled();
    expect(shape.compute(projector)!.total).toBe(5);
  });
  it("publishes only completed included candle bounds for inspection during Replay", () => {
    archive(); cell = { ...cell, replay: true, replayThrough: base + minute };
    const ctx = { fillRect() {}, strokeRect() {}, fillText() {}, measureText: (s: string) => ({ width: s.length }) } as unknown as CanvasRenderingContext2D;
    const args = { data: { volumeSource: "Classified executions", rows: 4 }, bars, coords: { width: 800, visibleLogicalRange: () => ({ from: 0, to: 2 }), priceToY: (p: number) => p }, bounds: { top: 0, height: 300 }, scale: {}, theme: { background: "#000", textColor: "#fff" } } as unknown as RendererLayerArgs;
    expect(paintVisibleProfile(ctx, args, new VisibleProfileCache(), () => cell)).toMatchObject({ first: base, last: base, result: { bars: 1, executions: 1, total: 3 } });
  });
  it("batches trade/source-only paints, skips live ticks in Replay and releases disconnected watches", () => {
    vi.useFakeTimers(); let receive: ((tick: Tick) => void) | undefined; const offTrades = vi.fn(); vi.spyOn(marketService, "onTick").mockImplementation(next => { receive = next; return offTrades; });
    const { canvas } = fixture(), owner = {}, repaint = vi.fn(); owners.push(owner); watchExecutionRange(owner, canvas, repaint, true);
    receive!(trades[0]); receive!(trades[1]); vi.runAllTimers(); expect(repaint).toHaveBeenCalledTimes(1);
    cell.replay = true; receive!(trades[0]); vi.runAllTimers(); expect(repaint).toHaveBeenCalledTimes(1);
    archive(); vi.runAllTimers(); expect(repaint).toHaveBeenCalledTimes(2);
    Object.defineProperty(canvas, "isConnected", { value: false }); receive!(trades[0]); studyTradeSource.clear(symbol); vi.runAllTimers(); expect(repaint).toHaveBeenCalledTimes(2); expect(offTrades).toHaveBeenCalled();
  });
});
