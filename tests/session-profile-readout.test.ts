import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeIndicatorContext } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { clearSessionProfileSurface, publishSessionProfileSurface, readSessionProfileSurfaces } from "@/lib/orderflow/sessionProfileReadout";
import { defaultVolumeProfile } from "@/lib/orderflow/volumeProfileSettings";
import { buildSessionVolumeProfiles } from "@/lib/orderflow/volumeProfileModel";
import { sessionProfileDescriptor } from "@/lib/orderflow/volumeProfileIndicator";
import type { VolumeProfileChannel } from "@/lib/orderflow/volumeProfileRenderer";
import { bindDataWindow, type ChartReadout, type DataWindowView } from "@/lib/chart/dataWindow";

const owner = Symbol("profile"), other = Symbol("second"), ctx = { symbol: "HL:BTC", timeframe: "5m", epoch: 4, replay: false };
const start = Date.UTC(2026, 9, 29), style = { ...defaultVolumeProfile(), rowSize: .1 };
const trade = (id: string, price: number, quantity: number, side: Tick["side"], time = start): Tick => ({ id, symbol: ctx.symbol, price, quantity, side, time, simulated: false });
const trades = [trade("a", .3, 3, "buy"), trade("b", .2, 1, "sell", start + 60000)];
const model = buildSessionVolumeProfiles(trades, style, ctx.symbol);
const context = { id: "native-svp", symbol: ctx.symbol, timeframe: ctx.timeframe, epoch: ctx.epoch, live: true };
function publish(cell = "primary", token = owner) { publishSessionProfileSurface(cell, token, { context, payload: { model, style } }); }
const read = (time = start) => readSessionProfileSurfaces("primary", ctx, time, [context.id])[0];
const rows = (time = start) => Object.fromEntries(read(time).rows.map(row => [row.label, row.value]));
afterEach(() => { for (const cell of ["primary", "cell-2"]) for (const token of [owner, other]) clearSessionProfileSurface(cell, token); });

describe("collected Session Volume Profile data-window readouts", () => {
  it("reports actual whole-session quantities and canonical POC/value-area bounds", () => {
    publish(); expect(read().status).toBe("ready"); expect(read().message).toContain("including trades after the selected candle");
    expect(rows()).toMatchObject({ "Collected executions": "2", "Ask volume (buys)": "3", "Bid volume (sells)": "1", "Session collected volume": "4",
      "Session delta (Ask − Bid)": "2", "Session delta %": "50%", "POC row [lower, upper)": "[0.3, 0.4)", "POC price": "0.35", "Price rows": "2",
      "Session start": "2026-10-29 00:00:00 UTC", "Last collected execution": "2026-10-29 00:01:00 UTC" });
    expect(rows(start + 3600000)).toEqual(rows());
  });
  it("uses inclusive session starts and exclusive ends, with absent history distinct from zero", () => {
    publish(); expect(read(start - 1)).toMatchObject({ status: "empty", rows: [] }); expect(read(start + 86400000)).toMatchObject({ status: "empty", rows: [] });
    expect(readSessionProfileSurfaces("primary", ctx, undefined, [context.id])[0]).toMatchObject({ status: "unavailable", rows: [] });
  });
  it("selects multiple studies by stable handle IDs and isolates their own grid/settings", () => {
    expect(sessionProfileDescriptor(() => trades).multiInstance).toBe(true);
    publish(); const secondStyle = { ...style, rowSize: .2 };
    publishSessionProfileSurface("primary", other, { context: { ...context, id: "second" }, payload: { style: secondStyle, model: buildSessionVolumeProfiles(trades, secondStyle, ctx.symbol) } });
    const result = readSessionProfileSurfaces("primary", ctx, start, ["second", context.id]); expect(result.map(value => value.id)).toEqual(["second", context.id]);
    expect(result[0].rows.find(row => row.label.startsWith("POC row"))?.value).toBe("[0.2, 0.4)");
    expect(readSessionProfileSurfaces("primary", ctx, start, [])).toEqual([]);
  });
  it("fences market, interval, source generation, Replay and cells without removing newer owners", () => {
    publish("cell-2"); expect(read()).toBeUndefined(); publish();
    for (const change of [{ symbol: "HL:ETH" }, { timeframe: "1m" }, { epoch: 5 }]) expect(readSessionProfileSurfaces("primary", { ...ctx, ...change }, start, [context.id])).toEqual([]);
    expect(readSessionProfileSurfaces("primary", { ...ctx, replay: true }, start, [context.id])[0]).toMatchObject({ status: "replay", rows: [] });
    publish("primary", other); clearSessionProfileSurface("primary", owner); expect(read().status).toBe("ready"); clearSessionProfileSurface("primary", other); expect(read()).toBeUndefined();
  });
  it("distinguishes pending/error payloads and labels the exact completed snapshot while updating", () => {
    publishSessionProfileSurface("primary", owner, { context, payload: { style, pending: true, message: "Calculating session profile" } });
    expect(read()).toMatchObject({ status: "pending", rows: [] });
    publishSessionProfileSurface("primary", owner, { context, payload: { style, message: "SVP unavailable: row capacity" } });
    expect(read()).toMatchObject({ status: "unavailable", rows: [], message: "SVP unavailable: row capacity" });
    publishSessionProfileSurface("primary", owner, { context, payload: { style, model, pending: true } }); expect(read().message).toContain("updating"); expect(rows()["Collected executions"]).toBe("2");
  });
  it("preserves tiny quantities and narrow high-price boundaries without zero-width formatting", () => {
    const tiny = [trade("tiny", 100000.000001, 1e-12, "sell")], settings = { ...style, rowSize: .0000001 };
    publishSessionProfileSurface("primary", owner, { context, payload: { style: settings, model: buildSessionVolumeProfiles(tiny.map(value => ({ ...value, simulated: true })), settings, ctx.symbol) } });
    expect(rows()["POC row [lower, upper)"]).toBe("[100000.000001, 100000.0000011)"); expect(rows()["Bid volume (sells)"]).toBe("0.000000000001"); expect(read().message).toContain("SIMULATED");
  });
  it("resets same-source collected history when the host source epoch changes and publishes its identity", () => {
    let epoch = 4, tape = trades; const channels: VolumeProfileChannel[] = [];
    const instance = sessionProfileDescriptor(() => tape, undefined, undefined, () => epoch).create();
    const native = { id: context.id, symbol: ctx.symbol, timeframe: ctx.timeframe, live: true, emit() {}, pushData(value: VolumeProfileChannel) { if (value) channels.push(value); }, setStatus() {} } as unknown as NativeIndicatorContext;
    instance.start(native, style); expect(channels.at(-1)?.context).toEqual(context);
    expect(channels.at(-1)?.current?.model?.retained).toBe(2); tape = [trade("fresh", .5, 9, "buy")]; epoch++;
    instance.onBars(); expect(channels.at(-1)?.current?.model?.retained).toBe(1); expect(channels.at(-1)?.context?.epoch).toBe(5); instance.stop();
  });
  it("binds native raw selected time and active IDs, clears during recovery and releases polling", async () => {
    vi.useFakeTimers(); try {
      publish(); const events = new Map<string, () => void>(), views: DataWindowView[] = [];
      const current: ChartReadout = { date: "2026-10-29", time: "00:00", barTime: start, ohlc: { o: ".3", h: ".3", l: ".2", c: ".2", up: false }, groups: [] };
      let recovering = false;
      const off = bindDataWindow({ market: { symbol: ctx.symbol, timeframe: ctx.timeframe }, renderer: { dataWindowReadout: () => current,
        onCrosshairMove: (callback: () => void) => { events.set("crosshair", callback); return () => events.delete("crosshair"); }, onConfigChanged: () => () => {} },
        on: (name: string, callback: () => void) => { events.set(name, callback); return () => events.delete(name); } } as never,
        { read: () => ({ ...ctx, marketEpoch: 4, zone: "UTC", recovering, error: null, indicatorIds: { userStudy: context.id } }), subscribe: () => () => {} }, view => views.push(view));
      expect(views.at(-1)?.sessionProfiles?.[0].status).toBe("ready"); current.barTime = start - 1; events.get("crosshair")!(); await Promise.resolve();
      expect(views.at(-1)?.sessionProfiles?.[0].status).toBe("empty"); recovering = true; vi.advanceTimersByTime(250); expect(views.at(-1)?.sessionProfiles).toBeUndefined();
      off(); expect(events.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
