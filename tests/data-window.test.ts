import { afterEach, describe, expect, it, vi } from "vitest";
import type { CrosshairEvent, DataWindowReadout } from "@luxalgo/vela";
import { bindDataWindow, type DataWindowContext, type DataWindowView } from "@/lib/chart/dataWindow";
import { publishFootprintSurface, clearFootprintSurface } from "@/lib/orderflow/footprintReadout";
import { clearDepthSurface, publishDepthSurface } from '@/lib/orderflow/depthHeatmapReadout';
afterEach(() => vi.useRealTimers());
function setup() {
  vi.useFakeTimers();
  let context: DataWindowContext = { symbol: "HL:BTC", timeframe: "5m", zone: "UTC", replay: false, recovering: false, error: null };
  let readout: DataWindowReadout | null = { date: "2026-10-27", time: "12:35", ohlc: { o: "80,000.00", h: "80,100.00", l: "79,900.00", c: "80,050.00", vol: "1.25K", up: true },
    groups: [{ name: "RSI (14)", rows: [{ label: "RSI", value: "52.3456", color: "#2962ff" }] }] };
  const events = new Map<string, () => void>(); let crosshair: ((event?: CrosshairEvent) => void) | undefined, hostListener: (() => void) | undefined, config: (() => void) | undefined;
  const market = { symbol: "HL:BTC", timeframe: "5m" };
  const read = vi.fn(() => readout), publish = vi.fn<(view: DataWindowView) => void>();
  const chart = { market, renderer: { dataWindowReadout: read,
    onCrosshairMove(fn: (event?: CrosshairEvent) => void) { crosshair = fn; return () => { crosshair = undefined; }; },
    onConfigChanged(fn: () => void) { config = fn; return () => { config = undefined; }; } },
    on(event: string, fn: () => void) { events.set(event, fn); return () => { events.delete(event); }; } };
  const dispose = bindDataWindow(chart as unknown as Parameters<typeof bindDataWindow>[0], { read: () => context,
    subscribe(fn) { hostListener = fn; return () => { hostListener = undefined; }; } }, publish);
  return { chart, market, read, publish, dispose, events, view: () => publish.mock.calls.at(-1)![0],
    context: (patch: Partial<DataWindowContext>) => { context = { ...context, ...patch }; hostListener?.(); },
    readout: (next: DataWindowReadout | null) => { readout = next; }, currentReadout: () => readout!,
    crosshair: (event?: CrosshairEvent) => crosshair?.(event), config: () => config?.() };
}
describe("native data-window lifecycle", () => {
  it("refreshes collected Footprint fields for the exact native selected candle and removes stale source/Replay values", async () => {
    const owner = Symbol("readout-test"), host = setup();
    try {
      host.readout({ ...host.currentReadout(), ...{ barTime: 0 } });
      host.context({ chartType: "footprint", marketEpoch: 2 });
      publishFootprintSurface("primary", owner, { symbol: "HL:BTC", timeframe: "5m", epoch: 2, simulated: false, dropped: 0,
        bars: [{ time: 0, volume: 4, delta: 2, poc: 100, levels: [{ price: 100, upperPrice: 101, buyVolume: 3, sellVolume: 1, imbalance: null }] }] });
      await vi.advanceTimersByTimeAsync(250); expect(host.view().footprint?.status).toBe("ready");
      host.readout({ ...host.currentReadout(), ...{ barTime: 300000 } }); host.crosshair(); await vi.runAllTicks();
      expect(host.view().footprint).toMatchObject({ status: "empty", rows: [] });
      host.context({ replay: true }); await vi.runAllTicks(); expect(host.view().footprint).toMatchObject({ status: "replay", rows: [] });
      host.context({ replay: false, marketEpoch: 3 }); await vi.runAllTicks(); expect(host.view().footprint?.status).toBe("unavailable");
      host.context({ chartType: "candles" }); await vi.runAllTicks(); expect(host.view().footprint).toBeUndefined();
    } finally { clearFootprintSurface("primary", owner); host.dispose(); }
  });
  it("copies native pane-formatted values without reformatting or sharing mutable rows", () => {
    const host = setup();
    expect(host.view()).toMatchObject({ status: "ready", readout: { ohlc: { c: "80,050.00", vol: "1.25K" }, groups: [{ rows: [{ value: "52.3456" }] }] } });
    host.currentReadout().groups[0].rows[0].value = "9.8765";
    expect(host.view().readout!.groups[0].rows[0].value).toBe("52.3456");
    host.dispose();
  });
  it("coalesces crosshair/context callbacks after the renderer has updated and suppresses identical publications", async () => {
    const host = setup(); host.crosshair(); host.crosshair(); host.config();
    host.readout({ ...host.currentReadout(), time: "11:25" });
    await vi.runAllTicks(); expect(host.view().readout!.time).toBe("11:25");
    expect(host.publish).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000); expect(host.publish).toHaveBeenCalledTimes(2);
    host.dispose();
  });
  it("reads once per browser frame and cancels a pending read on disposal", () => {
    let scheduled: FrameRequestCallback | undefined;
    const request = vi.fn((callback: FrameRequestCallback) => { scheduled = callback; return 7; });
    const cancel = vi.fn(() => { scheduled = undefined; });
    vi.stubGlobal("requestAnimationFrame", request);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const host = setup();
    try {
      host.crosshair(); host.crosshair(); host.config();
      vi.advanceTimersByTime(500);
      expect(request).toHaveBeenCalledOnce();
      expect(host.read).toHaveBeenCalledOnce();
      scheduled?.(0);
      expect(host.read).toHaveBeenCalledTimes(2);
      host.crosshair();
    } finally { host.dispose(); vi.unstubAllGlobals(); }
    expect(cancel).toHaveBeenCalledExactlyOnceWith(7);
    expect(scheduled).toBeUndefined();
  });
  it("suspends reads and timers while hidden and picks up settled chart state on return", () => {
    const page = Object.assign(new EventTarget(), { hidden: false });
    const setHidden = (hidden: boolean) => {
      page.hidden = hidden;
      page.dispatchEvent(new Event("visibilitychange"));
    };
    let scheduled: FrameRequestCallback | undefined;
    const request = vi.fn((callback: FrameRequestCallback) => { scheduled = callback; return 7; });
    const cancel = vi.fn(() => { scheduled = undefined; });
    vi.stubGlobal("document", page);
    vi.stubGlobal("requestAnimationFrame", request);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const host = setup();
    try {
      host.events.get("bar")!();
      setHidden(true);
      expect(cancel).toHaveBeenCalledExactlyOnceWith(7);
      expect(vi.getTimerCount()).toBe(0);
      host.events.get("load:start")!();
      host.events.get("load:end")!();
      host.context({ zone: "Europe/Berlin" });
      host.crosshair();
      host.readout({ ...host.currentReadout(), time: "14:35" });
      vi.advanceTimersByTime(1000);
      expect(host.read).toHaveBeenCalledOnce();
      expect(request).toHaveBeenCalledOnce();

      setHidden(false);
      expect(vi.getTimerCount()).toBe(1);
      expect(request).toHaveBeenCalledTimes(2);
      scheduled?.(0);
      expect(host.view()).toMatchObject({ zone: "Europe/Berlin", status: "ready", readout: { time: "14:35" } });
      host.readout({ ...host.currentReadout(), time: "14:40" });
      vi.advanceTimersByTime(250);
      expect(host.view().readout?.time).toBe("14:40");

      host.dispose();
      setHidden(true);
      setHidden(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { host.dispose(); vi.unstubAllGlobals(); }
  });
  it("hides the old market throughout loading, mismatched identity, errors and live recovery", async () => {
    const host = setup(); host.events.get("load:start")!(); await vi.runAllTicks();
    expect(host.view()).toMatchObject({ status: "loading", readout: null });
    host.context({ symbol: "HL:ETH" }); host.events.get("load:end")!(); await vi.runAllTicks();
    expect(host.view().readout).toBeNull();
    host.market.symbol = "HL:ETH"; host.context({ recovering: true }); await vi.runAllTicks();
    expect(host.view()).toMatchObject({ symbol: "HL:ETH", status: "recovering", readout: null });
    host.context({ recovering: false, error: "Provider history failed" }); await vi.runAllTicks();
    expect(host.view()).toMatchObject({ status: "error", readout: null });
    host.context({ error: null }); await vi.runAllTicks(); expect(host.view().status).toBe("ready");
    host.dispose();
  });
  it("reads the native Replay surface independently of live recovery and refreshes after native plot settling", async () => {
    const host = setup(); host.context({ replay: true, recovering: true });
    host.readout({ ...host.currentReadout(), date: "2026-10-25", time: "01:30" });
    host.events.get("replay:start")!(); await vi.runAllTicks();
    expect(host.view()).toMatchObject({ replay: true, status: "ready", readout: { date: "2026-10-25", time: "01:30" } });
    host.events.get("bar")!(); await vi.runAllTicks();
    host.readout({ ...host.currentReadout(), groups: [{ name: "EMA", rows: [{ label: "EMA", value: "80,124.37", color: "#2962ff" }] }] });
    await vi.advanceTimersByTimeAsync(250);
    expect(host.view().readout!.groups[0].rows[0].value).toBe("80,124.37"); host.dispose();
  });
  it("repulls the native zone formatting and treats empty/unready surfaces as unavailable", async () => {
    const host = setup(); host.context({ zone: "Europe/Berlin" });
    host.readout({ ...host.currentReadout(), time: "13:35" }); host.config(); await vi.runAllTicks();
    expect(host.view()).toMatchObject({ zone: "Europe/Berlin", readout: { time: "13:35" } });
    host.readout({ date: "", time: "", ohlc: null, groups: [] }); host.crosshair(); await vi.runAllTicks();
    expect(host.view()).toMatchObject({ status: "unavailable", readout: null }); host.dispose();
  });
  it("detaches every listener and timer and rejects already queued or stale callbacks", async () => {
    const host = setup(); const stale = host.events.get("bar")!;
    host.crosshair(); const before = host.publish.mock.calls.length; host.dispose();
    stale(); host.context({ symbol: "HL:ETH" }); await vi.runAllTicks(); await vi.advanceTimersByTimeAsync(2000);
    expect(host.publish).toHaveBeenCalledTimes(before); expect(host.events.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});

it("requires a fresh crosshair after the depth source changes within the same candle", async () => {
  const host = setup();
  const owner = { now: 2000, message: "" };
  const cursor: CrosshairEvent = {
    time: 1000, price: 100, paneKind: "price", values: new Map(),
    ohlc: { time: 0, open: 100, high: 101, low: 99, close: 100, volume: 4 },
  };
  const changeSource = (source: string, bid: number) => {
    host.context({ depthSource: source });
    publishDepthSurface("primary", {
      owner,
      identity: { symbol: "HL:BTC", timeframe: "5m", live: true, source, replayThrough: null },
      cells: [{ from: 1000, to: 2000, lower: 100, upper: 101, bid, ask: 0 }],
    });
  };
  try {
    host.readout({ ...host.currentReadout(), ...{ barTime: 0 } });
    changeSource("first", 2);
    host.crosshair(cursor);
    await vi.runAllTicks();
    expect(host.view().depth?.bid).toBe(2);

    changeSource("second", 5);
    await vi.runAllTicks();
    expect(host.view().depth).toBeUndefined();

    host.crosshair(cursor);
    await vi.runAllTicks();
    expect(host.view().depth?.bid).toBe(5);
  } finally {
    clearDepthSurface("primary", owner);
    host.dispose();
  }
});
