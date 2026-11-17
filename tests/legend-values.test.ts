import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeRenderer } from "@luxalgo/vela";
import { createChartReadoutStore, indicatorLegendValues, type ChartReadout, type DataWindowView } from "@/lib/chart/dataWindow";
const row = (value: string) => ({ label: "EMA", value, color: "#2962ff" });
const view = (): DataWindowView => ({ symbol: "HL:BTC", timeframe: "5m", zone: "UTC", replay: false, recovering: false, error: null,
  indicatorIds: { app20: "native20", app50: "native50" }, status: "ready", readout: { date: "2026-10-27", time: "12:00", ohlc: null,
    groups: [{ id: "native50", name: "EMA", rows: [row("data-only 50")], legendRows: [row("150.1234")] },
      { id: "native20", name: "EMA", rows: [row("data-only 20")], legendRows: [row("120.5678")] }] } });
afterEach(() => vi.useRealTimers());
describe("instance-safe native legend values", () => {
  it("matches duplicate titles by handle id even when their native order changes", () => {
    const current = view(); expect(indicatorLegendValues(current)).toMatchObject({ app20: [row("120.5678")], app50: [row("150.1234")] });
    current.readout!.groups.reverse(); expect(indicatorLegendValues(current).app20).toEqual([row("120.5678")]);
  });
  it("never substitutes data-window-only plots, titles or old handles for missing legend rows", () => {
    const current = view(); current.readout!.groups[1].legendRows = [];
    expect(indicatorLegendValues(current).app20).toBeUndefined();
    current.indicatorIds!.app50 = "replaced-native50";
    expect(Object.keys(indicatorLegendValues(current))).toEqual([]);
    expect(indicatorLegendValues(current).toString).toBeUndefined();
  });
  it.each(["loading", "recovering", "error", "unavailable"] as const)("withholds stale values during %s", status => {
    expect(Object.keys(indicatorLegendValues({ ...view(), status }))).toEqual([]);
  });
  it("retains per-plot formatting/colors and multiple plots in a single instance", () => {
    const current = view(); current.readout!.groups[1].legendRows = [row("52.3456"), { label: "Signal", value: "−0.000012", color: "#f23645" }];
    expect(indicatorLegendValues(current).app20).toEqual(current.readout!.groups[1].legendRows);
  });
  it("extends the actual native group method with stable ids and separate surface values", () => {
    const models = [{ id: "native20" }, { id: "native50" }, { id: "legend-only" }];
    const target = { scene: { indicators: new Map(models.map(model => [model.id, model])) }, modelTitle: () => "Same title",
      readoutRowsFor: (model: { id: string }, _index: number, _pane: unknown, surface: string) => model.id === "legend-only" && surface === "dataWindow" ? [] : [row(`${model.id}:${surface}`)] };
    const method = (NativeRenderer.prototype as unknown as { dataWindowGroups(index: number, pane: null): ChartReadout["groups"] }).dataWindowGroups;
    const groups = method.call(target, 1, null);
    expect(groups.map(group => group.id)).toEqual(["native20", "native50", "legend-only"]);
    expect(groups[0]).toMatchObject({ rows: [row("native20:dataWindow")], legendRows: [row("native20:legend")] });
    expect(groups[2]).toMatchObject({ rows: [], legendRows: [row("legend-only:legend")] });
  });
});

describe("shared native readout subscription", () => {
  function setup() {
    vi.useFakeTimers();
    const state = view(), callbacks: Array<(chart: Parameters<Parameters<typeof createChartReadoutStore>[0]>[0] extends (chart: infer C) => void ? C : never) => void> = [];
    const native = { market: { symbol: "HL:BTC", timeframe: "5m" }, renderer: { dataWindowReadout: () => state.readout,
      onCrosshairMove: () => vi.fn(), onConfigChanged: () => vi.fn() }, on: () => vi.fn() };
    const offChart = vi.fn(), offHost = vi.fn(), hostSubscribe = vi.fn(() => offHost);
    const subscribe = vi.fn((callback: (chart: typeof native | null) => void) => { callbacks.push(callback as never); callback(native); return offChart; });
    const store = createChartReadoutStore(subscribe as unknown as Parameters<typeof createChartReadoutStore>[0], { read: () => state, subscribe: hostSubscribe });
    return { store, state, subscribe, callbacks, native, offChart, offHost, hostSubscribe };
  }
  it("uses one binding for two surfaces and retains it until the last surface detaches", () => {
    const host = setup(), first = vi.fn(), second = vi.fn();
    const offFirst = host.store.subscribe(first), offSecond = host.store.subscribe(second);
    expect(host.subscribe).toHaveBeenCalledTimes(1); expect(host.hostSubscribe).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(1);
    offFirst(); expect(host.offChart).not.toHaveBeenCalled();
    offSecond(); expect(host.offChart).toHaveBeenCalledTimes(1); expect(host.offHost).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    expect(host.store.getSnapshot()).toBeNull(); expect(host.store.getServerSnapshot()).toBeNull();
  });
  it("publishes late handle-id mappings even if the native values did not change", async () => {
    const host = setup(); host.state.indicatorIds = {}; const off = host.store.subscribe(vi.fn());
    expect(Object.keys(indicatorLegendValues(host.store.getSnapshot()))).toEqual([]);
    host.state.indicatorIds = { app20: "native20" }; await vi.advanceTimersByTimeAsync(250);
    expect(indicatorLegendValues(host.store.getSnapshot()).app20).toEqual([row("120.5678")]); off();
  });
  it("keeps each legend snapshot stable when the data window or a different indicator changes", async () => {
    const host = setup(), off = host.store.subscribe(vi.fn());
    try {
      const first = host.store.getLegendRows("app20"), second = host.store.getLegendRows("app50");
      host.state.readout!.time = "12:05";
      host.state.readout!.groups[0].legendRows = [row("155.0000")];
      await vi.advanceTimersByTimeAsync(250);
      expect(host.store.getSnapshot()?.readout?.time).toBe("12:05");
      expect(host.store.getLegendRows("app20")).toBe(first);
      expect(host.store.getLegendRows("app50")).not.toBe(second);
      expect(host.store.getLegendRows("app50")).toEqual([row("155.0000")]);
    } finally { off(); }
    expect(host.store.getLegendRows("app20")).toBeUndefined();
  });
  it("fences obsolete chart callbacks across teardown and reattachment", () => {
    const host = setup(); const off = host.store.subscribe(vi.fn()), stale = host.callbacks[0]; off();
    const offNext = host.store.subscribe(vi.fn()); const snapshot = host.store.getSnapshot(); stale(null);
    expect(host.store.getSnapshot()).toBe(snapshot); expect(vi.getTimerCount()).toBe(1); offNext();
  });
  it("owns duplicate callback registrations independently and makes disposal idempotent", () => {
    const host = setup(), listener = vi.fn(), first = host.store.subscribe(listener), second = host.store.subscribe(listener);
    first(); first(); expect(vi.getTimerCount()).toBe(1); second(); expect(vi.getTimerCount()).toBe(0);
  });
});
