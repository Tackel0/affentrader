import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, NativeIndicatorOutput, ReplayState } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import type { TradeArchiveRead } from "@/types/tradeArchive";
import { StudyTradeSource, type StudyArchiveOptions } from "@/lib/orderflow/studyTradeSource";
import { bindReplayClock, completedReplayBoundary, nativeReplayBoundary } from "@/lib/chart/replayClock";
import { cvdDescriptor, type CvdNotice } from "@/lib/orderflow/cvdIndicator";
import { sessionProfileDescriptor } from "@/lib/orderflow/volumeProfileIndicator";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import { publishFootprintSurface, clearFootprintSurface, readFootprintSurface } from "@/lib/orderflow/footprintReadout";
import { publishSessionProfileSurface, clearSessionProfileSurface, readSessionProfileSurfaces } from "@/lib/orderflow/sessionProfileReadout";
import type { VolumeProfileChannel } from "@/lib/orderflow/volumeProfileRenderer";
const base = Date.UTC(2026, 10, 1, 12), minute = 60000, symbol = "HL:BTC";
const tick = (id: string, offset: number, quantity: number, side: Tick["side"] = "buy"): Tick => ({ id, symbol, time: base + offset, price: 100 + offset / 60000, quantity, side, simulated: false });
const snapshot = (trades: Tick[]): TradeArchiveRead => ({ selection: { symbol, from: base, to: base + 10 * minute }, trades, first: trades[0]?.time ?? null, last: trades.at(-1)?.time ?? null, buyVolume: "0", sellVolume: "0", delta: "0", coverage: "observed-only" });
const allBars = [0, minute, 2 * minute, 3 * minute].map(offset => ({ time: base + offset, open: 100, high: 102, low: 99, close: 101, volume: 100 }));
const replayState = (cursor = base): ReplayState => ({ active: true, playing: false, cursorTime: cursor, nextTime: cursor + minute, remaining: 3, intervalMs: 1000 });
const fixtures = [tick("first", 1, 4), tick("sell", 2, 1, "sell"), tick("edge", minute, 10, "sell"), tick("future", 2 * minute, 1e6)];
const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach(off => off()); vi.restoreAllMocks(); });

function environment(trades = fixtures) {
  const source = new StudyTradeSource(); source.install(snapshot(trades)); let bars = allBars.slice(0, 1);
  const chart = { data: {}, market: { symbol, timeframe: "1m" }, replay: { state: replayState() } };
  cleanups.push(bindReplayClock(chart as unknown as Parameters<typeof bindReplayClock>[0]));
  const outputs: NativeIndicatorOutput[] = [], notices: Array<CvdNotice | null> = [], channels: Array<VolumeProfileChannel | null> = [];
  const context = { id: "study", symbol, timeframe: "1m", live: false, data: chart.data, bars: () => bars, emit: (out: NativeIndicatorOutput) => outputs.push(out), pushData: (out: CvdNotice | VolumeProfileChannel | null) => { notices.push(out as CvdNotice); channels.push(out as VolumeProfileChannel); }, setStatus: vi.fn() } as unknown as NativeIndicatorContext;
  const options: StudyArchiveOptions = { revision: s => source.revision(s), subscribe: (s, changed) => source.subscribe(s, changed), replay: ctx => source.replay(ctx.symbol, nativeReplayBoundary(ctx)) };
  return { source, chart, context, options, outputs, notices, channel: () => channels.at(-1),
    seek(count: number, forming = false) { bars = allBars.slice(0, count); chart.replay.state = { ...replayState(bars.at(-1)!.time), ...(forming ? { nextTime: bars.at(-1)!.time } : {}) }; },
  };
}
const points = (out: NativeIndicatorOutput | undefined) => {
  const series = out?.series?.[0];
  if (series && "points" in series) return series.points.map(point => point.value);
  return series && "bars" in series ? series.bars.map(bar => Number.isFinite(bar.close) ? bar.close : null) : [];
};

describe("recorded orderflow follows the owning Replay clock", () => {
  it("uses exclusive completed candle boundaries and withholds forming candles", () => {
    expect(completedReplayBoundary(replayState(), "1m")).toBe(base + minute);
    expect(completedReplayBoundary({ ...replayState(), nextTime: base }, "1m")).toBe(base);
    expect(completedReplayBoundary({ ...replayState(), active: false }, "1m")).toBeNull();
    expect(completedReplayBoundary({ ...replayState(), cursorTime: null }, "1m")).toBeNull();
    expect(completedReplayBoundary(replayState(), "100T")).toBeNull();
    expect(completedReplayBoundary({ ...replayState(), nextTime: base - 1 }, "1m")).toBeNull();
    expect(completedReplayBoundary({ ...replayState(Date.UTC(2026, 1, 1)) }, "1M")).toBe(Date.UTC(2026, 2, 1));
  });
  it("binds identical-symbol chart cells independently and refuses stale/unbound contexts", () => {
    const a = environment(), b = environment(); b.seek(2);
    expect(nativeReplayBoundary(a.context)).toBe(base + minute); expect(nativeReplayBoundary(b.context)).toBe(base + 2 * minute);
    expect(nativeReplayBoundary({ ...a.context, data: {} as NativeIndicatorContext["data"] })).toBeNull();
    a.chart.market.symbol = "HL:ETH"; expect(nativeReplayBoundary(a.context)).toBeNull(); a.chart.market.symbol = symbol;
    a.chart.replay.state.cursorTime = base + minute; expect(nativeReplayBoundary(a.context)).toBeNull();
    const stop = bindReplayClock(a.chart as unknown as Parameters<typeof bindReplayClock>[0]); stop(); expect(nativeReplayBoundary(a.context)).toBeNull();
  });
  it("returns only archived prefixes, including neither the exact edge nor buffered future trades", () => {
    const env = environment(), first = env.source.replay(symbol, base + minute)!;
    expect(first.trades.map(t => t.id)).toEqual(["first", "sell"]); expect(first.label).toContain("2 archived observations");
    expect(Object.isFrozen(first)).toBe(true); expect(Object.isFrozen(first.trades)).toBe(true);
    expect(env.source.replay(symbol, base + minute)).toBe(first);
    expect(env.source.replay(symbol, base)?.trades).toEqual([]); expect(env.source.replay(symbol, null)).toBeUndefined();
    expect(env.source.replay("HL:ETH", base + minute)).toBeUndefined();
    env.source.observe({ ...fixtures[0], quantity: 999 }); expect(() => env.source.read(symbol, [])).toThrow(/conflict/);
    expect(env.source.replay(symbol, base + minute)?.trades[0].quantity).toBe(4);
  });
  it("rebuilds CVD for forward/backward seeks without live reads or subscriptions", () => {
    const env = environment(), liveRead = vi.fn(() => [tick("live", 1, 1e9)]), liveSubscribe = vi.fn(() => () => {});
    const instance = cvdDescriptor(liveRead, liveSubscribe, env.options).create(); instance.start(env.context, {});
    expect(points(env.outputs.at(-1))).toEqual([3]); expect(env.notices.at(-1)?.message).toContain("2 archived observations");
    env.seek(2); instance.onBars(); expect(points(env.outputs.at(-1))).toEqual([3, -7]);
    env.seek(1); instance.onBars(); expect(points(env.outputs.at(-1))).toEqual([3]);
    expect(liveRead).not.toHaveBeenCalled(); expect(liveSubscribe).not.toHaveBeenCalled();
    env.seek(3); instance.onBars(); expect(points(env.outputs.at(-1))).toEqual([3, -7, 999993]);
    env.seek(1); instance.onBars(); expect(points(env.outputs.at(-1))).toEqual([3]); instance.stop();
  });
  it("leaves the forming CVD slot null and restores quantities only when it completes", () => {
    const env = environment(); env.seek(2, true);
    const instance = cvdDescriptor(() => [], () => () => {}, env.options).create(); instance.start(env.context, {});
    expect(points(env.outputs.at(-1))).toEqual([3, null]);
    env.seek(2); instance.onBars(); expect(points(env.outputs.at(-1))).toEqual([3, -7]); instance.stop();
  });
  it.each([false, true])("reveals Average-mode recorded prefixes without future or live quantities (bar-only=%s)", barOnly => {
    const recorded = fixtures.map((t, i) => ({ ...t, tradeCount: i === 0 ? 4 : i === 2 ? 2 : 1 }));
    const env = environment(recorded), liveRead = vi.fn(() => [tick("live", 1, 1e9)]), liveSubscribe = vi.fn(() => () => {});
    const instance = cvdDescriptor(liveRead, liveSubscribe, env.options, barOnly).create();
    instance.start(env.context, { mode: "Average", plot: "Area" });
    expect(points(env.outputs.at(-1))).toEqual([0]);
    env.seek(2, true); instance.onBars(); expect(points(env.outputs.at(-1))).toEqual([0, null]);
    env.seek(2); instance.onBars(); expect(points(env.outputs.at(-1))).toEqual([0, -5]);
    env.seek(1); instance.onBars(); expect(points(env.outputs.at(-1))).toEqual([0]);
    expect(liveRead).not.toHaveBeenCalled(); expect(liveSubscribe).not.toHaveBeenCalled(); instance.stop();
  });
  it("clears CVD when the selected archive is removed and observes a replacement while paused", () => {
    const env = environment(), instance = cvdDescriptor(() => [], () => () => {}, env.options).create(); instance.start(env.context, {});
    env.source.clear(symbol); expect(points(env.outputs.at(-1))).toEqual([null]); expect(env.notices.at(-1)?.message).toContain("Replay");
    env.source.install(snapshot([tick("replacement", 2, 9)])); expect(points(env.outputs.at(-1))).toEqual([9]);
    instance.suspend(); const count = env.outputs.length; env.source.clear(symbol); expect(env.outputs).toHaveLength(count);
    instance.resume(); expect(points(env.outputs.at(-1))).toEqual([null]); instance.stop();
  });
  it("withholds all plots without the owning public clock, even when an archive is loaded", () => {
    const env = environment(), context = { ...env.context, data: {} as NativeIndicatorContext["data"] };
    const instance = cvdDescriptor(() => fixtures, () => () => {}, env.options).create(); instance.start(context, {});
    expect(points(env.outputs.at(-1))).toEqual([null]); expect(env.notices.at(-1)?.message).toContain("completed-bar clock"); instance.stop();
  });
  it.each(["Line", "Area", "Histogram", "Candles"])("overwrites stale %s slots and readout aliases when archived quantities become unavailable", plot => {
    const env = environment(), instance = cvdDescriptor(() => [], () => () => {}, env.options).create(); instance.start(env.context, { plot });
    const ids = env.outputs.at(-1)!.series!.map(series => series.id);
    env.source.clear(symbol); const cleared = env.outputs.at(-1)!.series!;
    expect(cleared.map(series => series.id)).toEqual(ids); expect(cleared.length).toBe(plot === "Candles" ? 5 : 1);
    for (const series of cleared) {
      if ("points" in series) expect(series.points.map(point => point.value)).toEqual([null]);
      if ("bars" in series) expect(series.bars.every(bar => !Number.isFinite(bar.open) && !Number.isFinite(bar.high) && !Number.isFinite(bar.low) && !Number.isFinite(bar.close))).toBe(true);
    }
    instance.stop();
  });
  it("builds Footprint bars from the revealed archive prefix without future rows or zero-filled gaps", () => {
    const env = environment(); const history = new FootprintHistory("1m"); history.add(env.source.replay(symbol, base + minute)!.trades);
    const bars = history.read({ step: 1, ratio: 3 }); expect(bars.map(bar => [bar.time, bar.delta, bar.volume])).toEqual([[base, 3, 5]]);
    const token = Symbol("replay"); cleanups.push(() => clearFootprintSurface("replay-test", token));
    publishFootprintSurface("replay-test", token, { symbol, timeframe: "1m", epoch: 0, bars, simulated: false, dropped: 0, replayThrough: base + minute });
    const context = { symbol, timeframe: "1m", epoch: 0, replay: true, replayThrough: base + minute };
    expect(readFootprintSurface("replay-test", context, base).rows.find(row => row.label === "Delta (Ask − Bid)")?.value).toBe("3");
    expect(readFootprintSurface("replay-test", context, base + minute).status).toBe("replay");
    expect(readFootprintSurface("replay-test", { ...context, replayThrough: base }, base).rows).toEqual([]);
    expect(readFootprintSurface("replay-test", { ...context, replay: false }, base).rows).toEqual([]);
  });
  it("rebuilds SVP POC/value-area quantities at each cutoff without consulting live executions", () => {
    const env = environment(), liveRead = vi.fn(() => [tick("live", 1, 1e9)]), subscribe = vi.fn(() => () => {});
    const instance = sessionProfileDescriptor(liveRead, subscribe, undefined, () => 7, env.options).create(); instance.start(env.context, {});
    const current = () => env.channel()?.current?.model;
    expect(current()?.retained).toBe(2); expect(current()?.sessions[0].valueArea.total).toBe(5);
    expect(env.channel()?.context).toMatchObject({ epoch: 7, live: false, replayThrough: base + minute });
    env.seek(2); instance.onBars(); expect(current()?.retained).toBe(3); expect(current()?.sessions[0].valueArea.total).toBe(15);
    env.seek(1); instance.onBars(); expect(current()?.retained).toBe(2); expect(current()?.lastTrade).toBe(base + 2);
    expect(liveRead).not.toHaveBeenCalled(); expect(subscribe).not.toHaveBeenCalled(); instance.stop();
  });
  it("never presents a stale profile after a backward seek or an obsolete background result", () => {
    const env = environment(Array.from({ length: 10001 }, (_, i) => tick(String(i), i + minute, 1)));
    env.seek(2); const jobs = { submit: vi.fn(), cancel: vi.fn() };
    const instance = sessionProfileDescriptor(() => [], () => () => {}, jobs, () => 0, env.options).create(); instance.start(env.context, {});
    expect(jobs.submit).toHaveBeenCalledTimes(1); const obsolete = jobs.submit.mock.calls[0][4] as (result: { error: string }) => void;
    env.seek(1); instance.onBars(); expect(env.channel()?.current?.model?.retained).toBe(0);
    obsolete({ error: "future worker result" }); expect(env.channel()?.current?.model?.retained).toBe(0); expect(env.channel()?.current?.message).not.toContain("future worker"); instance.stop();
  });
  it("marks replay profile readouts with the exact current boundary and hides stale/live mismatches", () => {
    const env = environment(), instance = sessionProfileDescriptor(() => [], () => () => {}, undefined, () => 0, env.options).create(); instance.start(env.context, {});
    const channel = env.channel()!, token = Symbol("readout"); cleanups.push(() => clearSessionProfileSurface("replay-readout", token));
    publishSessionProfileSurface("replay-readout", token, { context: channel.context!, payload: channel.current! });
    const context = { symbol, timeframe: "1m", epoch: 0, replay: true, replayThrough: base + minute };
    const result = readSessionProfileSurfaces("replay-readout", context, base, ["study"])[0];
    expect(result.status).toBe("ready"); expect(result.message).toContain("Replay boundary"); expect(result.rows.find(row => row.label === "Session collected volume")?.value).toBe("5");
    expect(readSessionProfileSurfaces("replay-readout", { ...context, replayThrough: base }, base, ["study"])[0].rows).toEqual([]);
    expect(readSessionProfileSurfaces("replay-readout", { ...context, replay: false }, base, ["study"])[0].rows).toEqual([]); instance.stop();
  });
});
