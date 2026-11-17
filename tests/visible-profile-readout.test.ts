import { afterEach, describe, expect, it, vi } from "vitest";
import type { OHLCV, Tick } from "@/types/trading";
import { clearVisibleProfileSurface, publishVisibleProfileSurface, readVisibleProfileSurfaces, visibleProfileStyleKey, type VisibleProfileSurface } from "@/lib/orderflow/visibleProfileReadout";
import { defaultVisibleProfile } from "@/lib/orderflow/visibleProfile";
import { ExecutionRangeProfileCache } from "@/lib/orderflow/executionRangeProfile";
import { FixedProfileCache } from "@/lib/orderflow/fixedProfileModel";
import { bindDataWindow, type DataWindowView } from "@/lib/chart/dataWindow";

const owner = Symbol("owner"), replacement = Symbol("replacement");
const bars: OHLCV[] = [{ time: 0, open: 100, high: 104, low: 100, close: 104, volume: 100 }, { time: 60000, open: 104, high: 104, low: 100, close: 100, volume: 200 }];
const trades: Tick[] = [
  { id: "a", symbol: "BTCUSDT", time: 1, price: 100, quantity: .1, side: "buy", simulated: false },
  { id: "b", symbol: "BTCUSDT", time: 60001, price: 102, quantity: .2, side: "sell", simulated: false },
];
const style = { ...defaultVisibleProfile(), rows: 4, valueAreaPct: 70, volumeSource: "Classified executions" as const };
const result = new ExecutionRangeProfileCache().read(bars, { rows: 4, valueAreaPct: 70, developing: false }, trades, "1m")!;
const surface: VisibleProfileSurface = { id: "native-a", symbol: "BINANCE:BTCUSDT", timeframe: "1m", epoch: 2, replay: false,
  sourceStamp: "source1", viewport: { from: 0, to: 60000 }, first: 0, last: 60000, style, result, message: "partial coverage; gaps unknown" };
const context = () => ({ symbol: surface.symbol, timeframe: "1m", epoch: 2, replay: false, sourceStamp: "source1", viewport: { from: 0, to: 60000 }, styles: { "native-a": visibleProfileStyleKey(style) } });
const read = (patch: Partial<ReturnType<typeof context>> = {}, ids = ["native-a"]) => readVisibleProfileSurfaces("primary", { ...context(), ...patch }, ids);
const values = () => Object.fromEntries(read()[0].rows.map(row => [row.label, row.value]));
afterEach(() => { clearVisibleProfileSurface("primary", owner); clearVisibleProfileSurface("primary", replacement); clearVisibleProfileSurface("satellite", owner); vi.useRealTimers(); });
describe("painted Visible Range Profile inspection", () => {
  it("reports observed totals and exact model row bounds, not candle volume", () => {
    publishVisibleProfileSurface("primary", owner, surface);
    expect(values()).toMatchObject({ "Observed executions": "2", "Ask volume (buys)": "0.1", "Bid volume (sells)": "0.2", "Observed volume": "0.3", "Delta (Ask − Bid)": "-0.1",
      "POC row [lower, upper)": "[101.5, 102)", "POC price": "101.75", "Value area volume": "0.2", "First included candle (UTC)": "1970-01-01T00:00:00.000Z", "Last included candle (UTC)": "1970-01-01T00:01:00.000Z" });
    expect(read()[0].message).toContain("not crosshair-candle"); expect(read()[0].message).toContain("gaps remain unknown");
  });
  it("keeps OHLCV estimates separate from aggressor quantities", () => {
    const estimated = { ...style, volumeSource: "OHLCV estimate" as const }, model = new FixedProfileCache().read(bars, { rows: 4, valueAreaPct: 70, developing: false });
    publishVisibleProfileSurface("primary", owner, { ...surface, style: estimated, result: model });
    const view = read({ styles: { "native-a": visibleProfileStyleKey(estimated) } })[0], rows = Object.fromEntries(view.rows.map(row => [row.label, row.value]));
    expect(rows["Estimated candle volume"]).toBe("300"); expect(rows).not.toHaveProperty("Ask volume (buys)"); expect(rows).not.toHaveProperty("Delta (Ask − Bid)"); expect(view.message).toContain("not aggressor side");
  });
  it("suppresses binary sum residue without rounding narrow price bounds", () => {
    publishVisibleProfileSurface("primary", owner, { ...surface, result: { ...result, profile: { ...result.profile, vaFrom: 0, vaTo: 3,
      centers: [100.00000000001, 100.00000000002, 100.00000000003, 100.00000000004] } } });
    expect(values()["Value area volume"]).toBe("0.3"); expect(values()["POC price"]).toBe("100.00000000004");
  });
  it("fences changed viewport, settings, source generation and owning market", () => {
    publishVisibleProfileSurface("primary", owner, surface);
    for (const patch of [{ viewport: { from: 60000, to: 60000 } }, { sourceStamp: "new-archive" }, { styles: {} }, { viewport: null }])
      expect(read(patch as Partial<ReturnType<typeof context>>)[0]).toMatchObject({ status: "waiting", rows: [] });
    expect(read({ symbol: "HL:BTC" })).toEqual([]); expect(read({ timeframe: "5m" })).toEqual([]); expect(read({ epoch: 3 })).toEqual([]);
  });
  it("requires the painted completed Replay boundary and excludes live snapshots", () => {
    const replay = { ...context(), replay: true, replayThrough: 120000 };
    publishVisibleProfileSurface("primary", owner, surface);
    expect(readVisibleProfileSurfaces("primary", replay, ["native-a"])[0].status).toBe("waiting");
    publishVisibleProfileSurface("primary", owner, { ...surface, replay: true, replayThrough: 120000 });
    expect(readVisibleProfileSurfaces("primary", replay, ["native-a"])[0]).toMatchObject({ status: "ready", message: expect.stringContaining("REPLAY") });
    for (const cutoff of [60000, null]) expect(readVisibleProfileSurfaces("primary", { ...replay, replayThrough: cutoff }, ["native-a"])[0]).toMatchObject({ status: "waiting", rows: [] });
    expect(read()[0].status).toBe("waiting");
  });
  it("clears numeric rows while calculating, missing or failed, and labels simulation", () => {
    for (const [message, pending, status] of [["Calculating classified profile", true, "waiting"], ["No observed classified executions", false, "empty"], ["Unavailable: capacity", false, "unavailable"]] as const) {
      publishVisibleProfileSurface("primary", owner, { ...surface, result: null, message, pending });
      expect(read()[0]).toMatchObject({ status, rows: [], message });
    }
    publishVisibleProfileSurface("primary", owner, { ...surface, style: undefined, result: undefined, message: "Unavailable: invalid settings" });
    expect(read({ styles: { "native-a": "invalid" } })[0]).toMatchObject({ status: "unavailable", rows: [] });
    publishVisibleProfileSurface("primary", owner, { ...surface, result: { ...result, simulated: true } }); expect(read()[0].message).toContain("SIMULATED");
  });
  it("isolates duplicate studies, cells, hidden handles and old lifecycle cleanup", () => {
    publishVisibleProfileSurface("primary", owner, surface); publishVisibleProfileSurface("primary", replacement, { ...surface, message: "replacement" });
    clearVisibleProfileSurface("primary", owner); expect(read()[0].message).toContain("replacement");
    publishVisibleProfileSurface("satellite", owner, { ...surface, id: "native-b" });
    expect(read({}, [])).toEqual([]); expect(read({}, ["native-b"])).toEqual([]);
    clearVisibleProfileSurface("primary", replacement); expect(read()).toEqual([]);
  });
  it("refreshes the shared Data window with painted results and removes values when panned before repaint", () => {
    vi.useFakeTimers(); publishVisibleProfileSurface("primary", owner, surface);
    let viewport = surface.viewport; const views: DataWindowView[] = [];
    const dispose = bindDataWindow({ market: { symbol: surface.symbol, timeframe: "1m" }, getVisibleRange: () => viewport,
      renderer: { dataWindowReadout: () => ({ date: "1970-01-01", time: "00:01", ohlc: { o: "104", h: "104", l: "100", c: "100", up: false }, groups: [], barTime: 60000 }),
        onCrosshairMove: () => () => {}, onConfigChanged: () => () => {} }, on: () => () => {} } as unknown as Parameters<typeof bindDataWindow>[0], {
      read: () => ({ ...context(), marketEpoch: 2, zone: "UTC", recovering: false, error: null, indicatorIds: { app: "native-a" }, profileSourceStamp: "source1", visibleProfileStyles: context().styles }), subscribe: () => () => {},
    }, view => views.push(view));
    expect(views.at(-1)?.visibleProfiles?.[0].status).toBe("ready");
    viewport = { from: 60000, to: 60000 }; vi.advanceTimersByTime(250); expect(views.at(-1)?.visibleProfiles?.[0]).toMatchObject({ status: "waiting", rows: [] });
    publishVisibleProfileSurface("primary", owner, { ...surface, viewport }); vi.advanceTimersByTime(250); expect(views.at(-1)?.visibleProfiles?.[0].status).toBe("ready"); dispose();
  });
});
