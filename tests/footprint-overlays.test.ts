import { afterEach, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, RendererLayerArgs } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { FOOTPRINT_OVERLAY_IDS, footprintOverlayDescriptor, footprintOverlayInputs, footprintOverlayInputVisible, resolveFootprintOverlay, type FootprintOverlayChannel, type FootprintOverlayKind } from "@/lib/orderflow/footprintOverlay";
import { createFootprintOverlayCache, paintFootprintOverlay } from "@/lib/orderflow/footprintOverlayRenderer";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import { defaultFootprint, footprintPlacements, paintFootprintBar } from "@/lib/orderflow/footprint";
import { footprintDisplayBar } from "@/lib/orderflow/footprintCells";
import { clearFootprintSurface, publishFootprintSurface, readFootprintOverlaySurfaces } from "@/lib/orderflow/footprintReadout";
import { INDICATORS } from "@/lib/indicators/catalog";
const tick = (id: string, time: number, price: number, quantity: number, side: "buy" | "sell", tradeCount = 1): Tick => ({ id, symbol: "KRK:BTC/USD", time, price, quantity, side, tradeCount, simulated: false });
const trades = [tick("a", 1, 100, 20, "buy", 10), tick("b", 2, 100, 2, "sell"), tick("c", 60001, 100, 10, "buy"), tick("d", 60002, 101, 3, "sell"), tick("e", 180001, 102, 5, "buy")];
const candle = (time: number) => ({ time, open: 100, close: 102, low: 99, high: 103, volume: 50 });
const args = () => ({ priceStyle: "candles", bars: [0, 60000, 120000, 180000].map(candle), cursor: null, coords: { width: 500, timeToX: (time: number) => 100 + time / 1000, pxPerBar: () => 100, visibleLogicalRange: () => ({ from: 0, to: 3 }), priceToY: (price: number) => (110 - price) * 20 }, bounds: { top: 0, height: 400 }, scale: { min: 95, max: 110 }, theme: { textColor: "#111", background: "#fff" } }) as unknown as RendererLayerArgs;
function canvas() {
  const calls: unknown[][] = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect(...v: number[]) { calls.push(["fill", ...v]); }, strokeRect(...v: number[]) { calls.push(["outline", ...v]); }, fillText(...v: unknown[]) { calls.push(["text", ...v]); } } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}
function channel(kind: FootprintOverlayKind, values: Record<string, unknown> = {}) {
  const history = new FootprintHistory("1m"); history.add(trades);
  return { kind, id: "study-a", history, ...resolveFootprintOverlay(kind, { rowSize: 1, ...values }), message: "Partial", identity: { symbol: "KRK:BTC/USD", timeframe: "1m", live: true as boolean, through: null as number | null, revision: 0 } } satisfies FootprintOverlayChannel;
}
afterEach(() => vi.useRealTimers());
it("exposes both native overlay entries while keeping all five per-bar modes and no secondary instances", () => {
  for (const [id, kind] of [["footprint", "bar"], ["visible-footprint", "visible"]] as const) {
    expect(INDICATORS.find(def => def.id === id)).toMatchObject({ nativeId: FOOTPRINT_OVERLAY_IDS[kind], kind: "orderflow" });
    const inputs = footprintOverlayInputs(kind); expect(new Set(inputs.map(input => input.key)).size).toBe(inputs.length);
    expect(inputs.find(input => input.key === "volumeMode")?.options).toEqual(["Bid × Ask Profile", "Bid × Ask Ladder", "Volume Profile", "Delta Profile", "Absolute Delta"]);
    expect(inputs.some(input => input.key.startsWith("fp2") || input.key === "candleVisible")).toBe(false);
    const descriptor = footprintOverlayDescriptor(kind, () => [], () => () => {}); expect(descriptor).toMatchObject({ overlay: true, multiInstance: true, paneHint: "price" });
  }
  const visible = footprintOverlayInputs("visible");
  for (const key of ["pocExtend", "stackedVisible", "unfinishedVisible"]) expect(visible.some(input => input.key === key)).toBe(false);
  expect(visible.find(input => input.key === "alignment")?.options).toEqual(["Right", "Left"]);
});
it("normalizes readable native choices and applies the same conditional style gates", () => {
  expect(resolveFootprintOverlay("bar", { volumeMode: "Absolute Delta", cellValues: "Bid × Ask Trades", position: "Left" }).style).toMatchObject({ volumeMode: "absolute-delta", cellValues: "bid-ask-trades", position: "left", candleVisible: false });
  expect(footprintOverlayInputVisible("bar", "volumeSplit", { volumeMode: "Volume Profile" })).toBe(true);
  expect(footprintOverlayInputVisible("bar", "monoLowColor", { volumeMode: "Volume Profile", volumeSplit: false })).toBe(true);
  expect(footprintOverlayInputVisible("bar", "monoLowColor", { volumeMode: "Bid × Ask Ladder" })).toBe(false);
  expect(footprintOverlayInputVisible("visible", "volumeSplit", { volumeMode: "Delta Profile" })).toBe(false);
  expect(resolveFootprintOverlay("visible", { valueAreaBackground: "rgba(1,2,3,0.25)", buyColor: "#12345680" }).style).toMatchObject({ valueAreaBackground: "rgba(1,2,3,0.25)", buyColor: "#12345680" });
  expect(resolveFootprintOverlay("visible", { pocExtend: true, stackedVisible: true, unfinishedVisible: true, alignment: "Left" })).toMatchObject({ alignment: "left", style: { pocExtend: false, stackedVisible: false, unfinishedVisible: false } });
});
it("produces identical per-candle cells and retains the base chart style without adding side candles", () => {
  const data = channel("bar", { valueAreaVisible: false, pocVisible: false }), a = args(), actual = canvas(), expected = canvas();
  const result = paintFootprintOverlay(actual.ctx, a, data, createFootprintOverlayCache())!;
  const instance = { id: "fp1", label: "Footprint", style: data.style }, placement = footprintPlacements(a, [instance]).get("fp1");
  for (const raw of data.history.read({ step: 1, ratio: 3 })) paintFootprintBar(expected.ctx, a, footprintDisplayBar(raw, 1, data.style), undefined, 1, data.style, placement);
  expect(actual.calls).toEqual(expected.calls); expect(result.bars.map(bar => bar.volume)).toEqual([22, 13, 5]); expect(a.priceStyle).toBe("candles");
});
it.each(["left", "right"] as const)("pins visible aggregate %s independently from one-pixel candle zoom", alignment => {
  const data = channel("visible", { alignment, widthPercent: 30 }), a = args(); a.coords.pxPerBar = () => 1;
  const result = paintFootprintOverlay(canvas().ctx, a, data, createFootprintOverlayCache())!;
  expect(result.range).toMatchObject({ candles: 4, observedCandles: 3, bar: { volume: 40, delta: 30 }, placement: { width: 150 } });
  const p = result.range!.placement!, center = a.coords.timeToX(result.bars[0].time) + p.offset;
  expect(center).toBe(alignment === "left" ? 83 : 417);
  expect(result.stacks).toBeUndefined(); expect(result.unfinished).toBeUndefined(); expect(result.poc).toBeUndefined();
});
it("keeps full per-bar projections and excludes forming Replay origins even when a dependency supplies them", () => {
  const data = channel("bar", { stackedVisible: true, stackedRows: 2, unfinishedVisible: true, pocExtend: true }), a = args();
  const full = paintFootprintOverlay(canvas().ctx, a, data, createFootprintOverlayCache())!;
  expect(full.poc?.length).toBeGreaterThan(0); expect(full.unfinished?.length).toBeGreaterThan(0); expect(full.stacks).toBeDefined();
  data.identity = { ...data.identity, live: false, through: 90000 as number | null };
  const prefix = paintFootprintOverlay(canvas().ctx, a, data, createFootprintOverlayCache())!;
  expect(prefix.bars.map(bar => bar.time)).toEqual([0]);
  data.identity.through = null; expect(paintFootprintOverlay(canvas().ctx, a, data, createFootprintOverlayCache())).toBeUndefined();
});
function harness(kind: FootprintOverlayKind = "bar", live = true) {
  let rows = [...trades], revision = 0, through = 60000, receive: ((tick: Tick) => void) | undefined, archived: (() => void) | undefined;
  const releases: ReturnType<typeof vi.fn>[] = [], archiveReleases: ReturnType<typeof vi.fn>[] = [];
  let data: FootprintOverlayChannel | null = null;
  const instance = footprintOverlayDescriptor(kind, () => rows, (_symbol, callback) => { receive = callback; const off = vi.fn(); releases.push(off); return off; }, {
    revision: () => revision, subscribe: (_symbol, callback) => { archived = callback; const off = vi.fn(); archiveReleases.push(off); return off; },
    replay: () => ({ trades: rows.filter(tick => tick.time < through), through, label: "Recorded fixture" }),
  }).create();
  const context = { id: `${kind}-study`, symbol: "KRK:BTC/USD", timeframe: "1m", live, bars: () => args().bars, emit() {}, pushData(value: FootprintOverlayChannel | null) { data = value; }, setStatus() {} } as unknown as NativeIndicatorContext;
  instance.start(context, {});
  return { instance, context, data: () => data, releases, archiveReleases, receive: (tick: Tick) => { rows.push(tick); receive?.(tick); }, oldReceiver: () => receive,
    replace(value: Tick[]) { rows = value; revision++; archived?.(); }, seek(value: number) { through = value; instance.onBars(); } };
}
it("collects/coalesces native live updates and preserves history across display edits", async () => {
  vi.useFakeTimers(); const h = harness(), data = h.data()!, original = data.history, repaint = vi.fn(); data.repaint = repaint;
  h.receive(tick("live", 180005, 102, 2, "buy")); h.receive(tick("live", 180005, 102, 2, "buy"));
  await vi.advanceTimersByTimeAsync(50); expect(repaint).toHaveBeenCalledTimes(1); expect(data.history!.coverage.trades).toBe(6);
  h.instance.setInputs?.({ volumeMode: "Delta Profile", rowSize: 1 }); expect(data.history).toBe(original); expect(data.style?.volumeMode).toBe("delta");
  h.receive({ ...tick("wrong", 180006, 100, 100, "buy"), symbol: "OTHER" }); await vi.advanceTimersByTimeAsync(50); expect(data.history!.coverage.trades).toBe(6); h.instance.stop();
});
it("isolates two overlay owners and fences suspended/stopped callbacks", async () => {
  vi.useFakeTimers(); const a = harness(), b = harness("visible"), old = a.oldReceiver()!;
  expect(a.data()!.history).not.toBe(b.data()!.history);
  a.instance.suspend?.(); expect(a.data()).toBeNull(); old(tick("obsolete", 180005, 105, 99, "buy")); await vi.advanceTimersByTimeAsync(50); expect(a.data()).toBeNull();
  a.instance.resume?.(); expect(a.data()!.history!.coverage.trades).toBe(5); expect(a.releases[0]).toHaveBeenCalledTimes(1);
  old(tick("old-after-resume", 180006, 105, 99, "buy")); expect(a.data()!.history!.coverage.trades).toBe(5);
  a.instance.stop(); b.instance.stop(); expect(a.data()).toBeNull(); expect(b.data()).toBeNull(); expect(b.archiveReleases[0]).toHaveBeenCalled();
});
it("rebuilds on archived-source revisions and real Replay backseeks without live subscription", () => {
  const h = harness("bar", false); expect(h.releases).toHaveLength(0); expect(h.data()!.history!.coverage.trades).toBe(2);
  h.seek(240000); expect(h.data()!.history!.coverage.trades).toBe(5);
  h.seek(60000); expect(h.data()!.history!.coverage.trades).toBe(2);
  h.replace([tick("replacement", 1, 105, 4, "sell")]); expect(h.data()!.history!.read({ step: 1, ratio: 3 })[0].delta).toBe(-4); h.instance.stop();
});
it("detaches the previous market before observing a changed native context", () => {
  const h = harness(), old = h.oldReceiver()!; (h.context as { symbol: string }).symbol = "OTHER"; h.instance.onBars();
  expect(h.releases[0]).toHaveBeenCalledTimes(1); old(tick("old-market", 180005, 100, 100, "buy")); expect(h.data()!.identity?.symbol).toBe("OTHER"); expect(h.data()!.history!.coverage.trades).toBe(0); h.instance.stop();
});
it("reports missing Replay executions without falling back to live or candle-only splits", () => {
  const read = vi.fn(() => trades), instance = footprintOverlayDescriptor("bar", read, () => () => {}).create(), values: unknown[] = [];
  const context = { id: "missing", symbol: "KRK:BTC/USD", timeframe: "1m", live: false, bars: () => args().bars, emit() {}, pushData(value: unknown) { values.push(value); }, setStatus() {} } as unknown as NativeIndicatorContext;
  instance.start(context, {}); const data = values.at(-1) as FootprintOverlayChannel; expect(read).not.toHaveBeenCalled(); expect(data.history).toBeUndefined(); expect(data.message).toContain("Replay needs"); instance.stop();
});
it("selects Data-window surfaces only by native id, source and completed Replay identity", () => {
  const token = Symbol(), data = channel("bar"), bars = data.history.read({ step: 1, ratio: 3 });
  publishFootprintSurface("primary:a", token, { overlayTitle: "Footprint", symbol: "KRK:BTC/USD", timeframe: "1m", epoch: 1, sourceStamp: "a", bars, simulated: false, dropped: 0 });
  const context = { symbol: "KRK:BTC/USD", timeframe: "1m", epoch: 1, sourceStamp: "a", replay: false };
  expect(readFootprintOverlaySurfaces("primary", context, 0, ["a", "a", "other"])).toMatchObject([{ id: "a", status: "ready", title: "Footprint" }]);
  expect(readFootprintOverlaySurfaces("secondary", context, 0, ["a"])).toEqual([]);
  expect(readFootprintOverlaySurfaces("primary", { ...context, sourceStamp: "b" }, 0, ["a"])[0].status).toBe("unavailable");
  expect(readFootprintOverlaySurfaces("primary", { ...context, replay: true, replayThrough: 60000 }, 0, ["a"])[0].status).toBe("replay");
  clearFootprintSurface("primary:a", token);
});
