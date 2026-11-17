import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, RendererLayerArgs } from "@luxalgo/vela";
import { defaultFootprint, footprintStep, resolveFootprint, resolveFootprintChart, resolveFootprintInstances, resolveVisibleFootprint, validFootprint } from "@/lib/orderflow/footprint";
import { createFootprintGridSource, footprintGridNotice } from "@/lib/orderflow/footprintGrid";
import { footprintOverlayDescriptor, footprintOverlayInputVisible, footprintOverlayInputs, type FootprintOverlayChannel } from "@/lib/orderflow/footprintOverlay";
import { paintFootprintOverlay, createFootprintOverlayCache } from "@/lib/orderflow/footprintOverlayRenderer";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import { readVisibleFootprint } from "@/lib/orderflow/visibleFootprint";
import { bindCellContext, contextForCanvas, requestCellFrame } from "@/lib/chart/cellContext";
import type { PriceGridMetadata } from "@/lib/market/priceGridMetadata";
import type { Tick } from "@/types/trading";
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const meta = (symbol = "BTCUSDT", tickSize = .01): PriceGridMetadata => ({ symbol, tickSize, checkedAt: Date.now(), source: "Verified test venue tick" });
const input = { symbol: "BTCUSDT", price: 100, simulated: false, scope: "live" };
const args = (slope = 20) => ({ nowMs: 0, bars: [{ time: 0, open: 100, close: 100.5, low: 99, high: 101, volume: 6 }], cursor: null, scale: { min: 95, max: 105 }, bounds: { top: 0, height: 200 },
  coords: { width: 500, pxPerBar: () => 100, timeToX: () => 200, priceToY: (p: number) => p * slope, visibleLogicalRange: () => ({ from: 0, to: 0 }) }, theme: { textColor: "#111111", background: "#ffffff" } }) as unknown as RendererLayerArgs;
const ticks: Tick[] = [100.01, 100.02, 100.06, 100.07].map((price, index) => ({ id: String(index), symbol: "BTCUSDT", time: index + 1, price, quantity: index + 1, side: index % 2 ? "sell" : "buy", tradeCount: 1, simulated: false }));
afterEach(() => vi.useRealTimers());
describe("Footprint venue tick grids", () => {
  it.each([1, 2, 3, 10, 20, 64, -20])("uses the reference power-of-two Auto threshold at slope %s", slope => {
    const tick = .25, height = Math.abs(slope * tick), exponent = Math.max(0, Math.min(12, Math.ceil(Math.log2(16 / height))));
    expect(footprintStep(args(slope), defaultFootprint(), 100, tick)).toBe(tick * 2 ** exponent);
  });
  it("measures logarithmic midpoint pixels instead of a linear scale-span budget", () => {
    const view = args(), mid = 50.5; view.scale = { min: 1, max: 100 } as RendererLayerArgs["scale"];
    view.coords.priceToY = p => -Math.log(p) * 200 / Math.log(100);
    const px = Math.abs(view.coords.priceToY(mid + 1, view.scale, view.bounds) - view.coords.priceToY(mid, view.scale, view.bounds));
    const expected = 2 ** Math.max(0, Math.min(12, Math.ceil(Math.log2(16 / px))));
    expect(footprintStep(view, defaultFootprint(), 80_000, 1)).toBe(expected);
    expect(expected).toBe(32);
  });
  it("keeps one tick at the exact threshold, caps Auto at 4096, and retains one tick for nonpositive pixel distance", () => {
    expect(footprintStep(args(64), defaultFootprint(), 100, .25)).toBe(.25);
    expect(footprintStep(args(63.99), defaultFootprint(), 100, .25)).toBe(.5);
    expect(footprintStep(args(.000001), defaultFootprint(), 100, .25)).toBe(1024);
    expect(footprintStep(args(0), defaultFootprint(), 100, .25)).toBe(.25);
  });
  it("uses 1–64 independent Manual ticks without changing explicit legacy price overrides", () => {
    for (let n = 1; n <= 64; n++) expect(footprintStep(args(.001), { ...defaultFootprint(), rowMode: "manual", rowTicks: n }, 100, .1)).toBe(n / 10);
    expect(footprintStep(args(), { ...defaultFootprint(), rowSize: .3, rowMode: "manual", rowTicks: 64 }, 100)).toBe(.3);
    expect(() => footprintStep(args(), defaultFootprint(), 100)).toThrow("verified venue");
  });
  it("normalizes native Manual counts but rejects malformed backup values, including disabled instances", () => {
    expect(resolveFootprint({ rowMode: "manual", rowTicks: 4.6 })).toMatchObject({ rowMode: "manual", rowTicks: 5 });
    expect(resolveFootprint({ rowTicks: 100 })).toMatchObject({ rowTicks: 64 });
    const saved = { ...defaultFootprint(), fp2Enabled: true, fp2RowMode: "manual", fp2RowTicks: 7, fp3Enabled: false, fp3RowTicks: 64, vrEnabled: true, vrRowMode: "manual", vrRowTicks: 3 };
    const restored = resolveFootprintChart(JSON.parse(JSON.stringify(saved))); expect(validFootprint(restored)).toBe(true); expect(restored).toMatchObject(saved);
    expect(resolveFootprintInstances(restored)[1].style.rowTicks).toBe(7); expect(resolveVisibleFootprint(restored).style.rowTicks).toBe(3);
    for (const invalid of [{ rowMode: "other" }, { rowTicks: 0 }, { rowTicks: 1.5 }, { fp3RowTicks: 65 }, { vrRowTicks: "4" }]) expect(validFootprint({ ...saved, ...invalid })).toBe(false);
  });
  it("keeps native overlay row-count and height controls scoped to their mode", () => {
    expect(footprintOverlayInputVisible("bar", "rowTicks", { rowMode: "Manual" })).toBe(true);
    expect(footprintOverlayInputVisible("bar", "rowTicks", { rowMode: "Auto" })).toBe(false);
    expect(footprintOverlayInputs("visible").some(row => row.key === "rowHeight")).toBe(false);
    expect(footprintStep(args(1), { ...defaultFootprint(), rowHeight: 40 }, 100, 1)).toBe(16);
  });
  it("aggregates raw executions on the decimal Manual grid and preserves counts/volume", () => {
    const history = new FootprintHistory("1m"); history.add(ticks);
    const step = footprintStep(args(), { ...defaultFootprint(), rowMode: "manual", rowTicks: 4 }, 100, .01);
    const bars = history.read({ step, ratio: 3 });
    expect(step).toBe(.04); expect(bars[0].levels.map(row => row.price)).toEqual([100, 100.04]);
    expect(bars[0].levels.map(row => [row.buyVolume, row.sellVolume])).toEqual([[1, 2], [3, 4]]);
    expect(bars[0].levels.reduce((sum, row) => sum + row.buyCount! + row.sellCount!, 0)).toBe(4); expect(bars[0].volume).toBe(10);
    expect(readVisibleFootprint(history, { ...args(), settings: { ...defaultFootprint(), vrEnabled: true, vrRowMode: "manual", vrRowTicks: 4 } }, "1m", undefined, .01)?.bar?.volume).toBe(10);
    expect(readVisibleFootprint(history, { ...args(), settings: { vrEnabled: true } }, "1m")).toBeUndefined();
  });
  it("does not estimate a real venue tick while metadata loads, then notifies a paused consumer", async () => {
    const changed = vi.fn(), load = vi.fn(async () => meta()), source = createFootprintGridSource(changed, load);
    expect(source.read(input)).toMatchObject({ pending: true }); expect(source.read(input).tick).toBeUndefined();
    await flush(); expect(load).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledTimes(1);
    expect(source.read(input)).toMatchObject({ tick: .01, pending: false, source: "Verified test venue tick" });
  });
  it("backs off failures, refreshes metadata and withholds rows after a failed refresh", async () => {
    vi.useFakeTimers(); const changed = vi.fn(), load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(meta()).mockRejectedValueOnce(new Error("rules unavailable"));
    const source = createFootprintGridSource(changed, load); source.read(input); await flush();
    expect(source.read(input)).toMatchObject({ error: "offline", pending: false }); expect(source.read(input).tick).toBeUndefined(); expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000); source.read(input); await flush(); expect(source.read(input).tick).toBe(.01);
    vi.advanceTimersByTime(300_000); expect(source.read(input)).toMatchObject({ tick: .01, pending: true }); await flush();
    expect(source.read(input)).toMatchObject({ error: "rules unavailable" }); expect(source.read(input).tick).toBeUndefined();
  });
  it("fences replies from a previous symbol and source scope", async () => {
    const resolvers: ((value: PriceGridMetadata) => void)[] = [], changed = vi.fn(), source = createFootprintGridSource(changed, () => new Promise(resolve => resolvers.push(resolve)));
    source.read(input); await flush(); const next = { ...input, symbol: "KRK:BTC/USD", scope: "Replay" }; source.read(next); await flush();
    resolvers[0](meta()); await flush(); expect(changed).not.toHaveBeenCalled(); expect(source.read(next).tick).toBeUndefined();
    resolvers[1](meta(next.symbol, .1)); await flush(); expect(source.read(next).tick).toBe(.1); expect(changed).toHaveBeenCalledTimes(1);
  });
  it("rejects metadata for another market and invalid precision", async () => {
    for (const value of [meta("OTHER"), meta("BTCUSDT", 0), { symbol: "BTCUSDT", checkedAt: 0, source: "bad" }]) {
      const source = createFootprintGridSource(() => {}, async () => value); source.read(input); await flush();
      expect(source.read(input).tick).toBeUndefined(); expect(source.read(input).error).toBeTruthy();
    }
  });
  it("never starts a queued request after disposal and rejects late suspended replies", async () => {
    const load = vi.fn(async () => meta()), changed = vi.fn(), source = createFootprintGridSource(changed, load);
    source.read(input); source.dispose(); await flush(); expect(load).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
    source.reset(); source.read(input); await flush(); expect(source.read(input).tick).toBe(.01);
    source.dispose(); expect(source.read(input).tick).toBeUndefined();
  });
  it("keeps SIMULATED estimates and explicit overrides labeled and separate from venue metadata", async () => {
    const load = vi.fn(async () => meta()), source = createFootprintGridSource(() => {}, load);
    const simulated = source.read({ ...input, simulated: true }); expect(simulated.tick).toBeGreaterThan(0); expect(simulated.source).toContain("SIMULATED");
    expect(footprintGridNotice(simulated, true)).not.toContain("Current venue");
    expect(source.read({ ...input, required: false })).toMatchObject({ source: "Explicit price row overrides" }); await flush(); expect(load).not.toHaveBeenCalled();
    expect(footprintGridNotice({ tick: .01, source: "Kraken", pending: false }, true)).toContain("historical rule changes");
  });
  it("recalculates Hyperliquid precision at the observed chart price", async () => {
    const source = createFootprintGridSource(() => {}, async () => ({ symbol: "HL:BTC", sizeDecimals: 5, source: "Hyperliquid", checkedAt: 0 }));
    const value = { ...input, symbol: "HL:BTC", price: 80_000 }; source.read(value); await flush();
    expect(source.read(value).tick).toBe(1); expect(source.read({ ...value, price: .12345 }).tick).toBe(.1);
  });
  it("requests a real cell frame and releases the request bridge after teardown", () => {
    const host = { dataset: {} } as unknown as HTMLElement, canvas = { closest: () => host } as unknown as HTMLElement, redraw = vi.fn();
    const off = bindCellContext(host, () => ({ id: "a", symbol: "BTCUSDT", timeframe: "1m", replay: false }), redraw);
    expect(contextForCanvas(canvas)?.id).toBe("a"); expect(requestCellFrame(canvas)).toBe(true); expect(redraw).toHaveBeenCalledTimes(1);
    off(); expect(requestCellFrame(canvas)).toBe(false); expect(contextForCanvas(canvas)).toBeUndefined();
  });
  it("pushes a native overlay frame when asynchronous metadata completes without another bar/trade", async () => {
    const outputs: unknown[] = [], statuses: string[] = [], instance = footprintOverlayDescriptor("bar", () => ticks, () => () => {}, {}, async () => meta()).create();
    const context = { id: "grid-overlay", symbol: "BTCUSDT", timeframe: "1m", live: true, bars: () => args().bars, emit() {}, pushData(value: unknown) { outputs.push(value); }, setStatus(value: string) { statuses.push(value); } } as unknown as NativeIndicatorContext;
    instance.start(context, { rowMode: "Manual", rowTicks: 4 }); expect(outputs).toHaveLength(1); expect(statuses.at(-1)).toBe("loading");
    await flush(); expect(outputs).toHaveLength(2); const channel = outputs.at(-1) as FootprintOverlayChannel; expect(channel.priceTick).toBe(.01); expect(statuses.at(-1)).toBe("live");
    const ctx = { save() {}, restore() {}, fillRect() {}, strokeRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} } as unknown as CanvasRenderingContext2D;
    expect(paintFootprintOverlay(ctx, args(), channel, createFootprintOverlayCache())?.step).toBe(.04); instance.stop();
  });
});
