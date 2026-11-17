import { describe, expect, it, vi } from "vitest";
import type { MarketDataFeed, OHLCV } from "@luxalgo/vela";
import { trackChartFeed } from "@/lib/chart/feedSettlement";
import { frameRecentView } from "@/lib/chart/recentNavigation";

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const market = { symbol: "HL:BTC", timeframe: "1m" };
const bar = (time: number): OHLCV => ({ time, open: 100, high: 101, low: 99, close: 100, volume: 1 });
function setup() {
  const repair = deferred<ReturnType<typeof bar>[]>();
  const source: MarketDataFeed = { load: async () => [bar(0)], loadRange: () => repair.promise, subscribe: () => () => {} };
  const tracked = trackChartFeed(source), setVisibleRange = vi.fn();
  let bars = [bar(0), bar(60000)];
  const chart = { market, historyComplete: vi.fn(async () => {}), replay: { state: { active: false, cursorTime: null } }, setVisibleRange } as unknown as Parameters<typeof frameRecentView>[0];
  const read = () => ({ bars, timeframe: "1m", chartType: "candles" as const, width: 800 });
  return { repair, source, tracked, chart, setVisibleRange, read, write: (next: typeof bars) => { bars = next; } };
}

describe("settled native chart navigation", () => {
  it("waits for a Replay-exit healer although initial historyComplete already resolved, then reads fresh bars", async () => {
    const s = setup(), order: string[] = [];
    // Native Vela installs its consumer before emitting replay:end; the provider and native arrays differ until this resolves.
    const native = s.tracked.feed.loadRange!(market, { from: 60000 }).then(bars => { order.push("native apply"); s.write(bars); });
    const navigating = frameRecentView(s.chart, { valid: () => true, settled: s.tracked.settled,
      read: () => { order.push("frame read"); return s.read(); } });
    await Promise.resolve(); expect(s.chart.historyComplete).toHaveBeenCalled(); expect(s.setVisibleRange).not.toHaveBeenCalled();
    s.repair.resolve([bar(0), bar(60000), bar(120000), bar(180000)]);
    await native; expect(await navigating).toBe(true);
    expect(order).toEqual(["native apply", "frame read"]);
    expect(s.setVisibleRange).toHaveBeenCalledExactlyOnceWith({ from: 0, to: 180000 });
  });
  it("fences an older automatic return when a later Reset/date/market action supersedes it", async () => {
    const s = setup(); let revision = 1;
    const native = s.tracked.feed.loadRange!(market, { from: 60000 }).then(s.write);
    const first = frameRecentView(s.chart, { valid: () => revision === 1, settled: s.tracked.settled, read: s.read });
    revision = 2;
    const last = frameRecentView(s.chart, { valid: () => revision === 2, settled: s.tracked.settled, read: s.read });
    s.repair.resolve([bar(0), bar(60000), bar(120000)]); await native;
    expect(await first).toBe(false); expect(await last).toBe(true);
    expect(s.setVisibleRange).toHaveBeenCalledExactlyOnceWith({ from: 0, to: 120000 });
  });
  it("does not frame after ownership/generation invalidation while the repair is outstanding", async () => {
    const s = setup(); let valid = true;
    void s.tracked.feed.loadRange!(market, { from: 60000 });
    const navigation = frameRecentView(s.chart, { valid: () => valid, settled: s.tracked.settled, read: s.read });
    await Promise.resolve(); valid = false; s.repair.resolve([bar(0)]);
    expect(await navigation).toBe(false); expect(s.setVisibleRange).not.toHaveBeenCalled();
  });
  it("ignores unrelated markets and waits for a second same-market request started by a completion", async () => {
    const s = setup(), second = deferred<ReturnType<typeof bar>[]>(); let calls = 0;
    s.source.loadRange = () => ++calls === 1 ? s.repair.promise : second.promise;
    const one = s.tracked.feed.loadRange!(market, { from: 60000 });
    const cascade = one.then(() => s.tracked.feed.loadRange!(market, { from: 120000 }));
    expect(await s.tracked.settled({ ...market, symbol: "HL:ETH" })).toBe(true);
    let done = false; const wait = s.tracked.settled(market).then(value => { done = true; return value; });
    s.repair.resolve([bar(0)]); await one; await Promise.resolve(); expect(done).toBe(false);
    second.resolve([bar(60000)]); await cascade; expect(await wait).toBe(true);
  });
  it("retains feed rejection semantics and releases waits immediately when the chart is disposed", async () => {
    const s = setup();
    const request = s.tracked.feed.loadRange!(market, { from: 60000 });
    const failed = expect(request).rejects.toThrow("offline"), wait = s.tracked.settled(market);
    s.repair.reject(new Error("offline")); await failed; expect(await wait).toBe(true);
    const again = setup(); void again.tracked.feed.loadRange!(market, { from: 60000 });
    const navigation = frameRecentView(again.chart, { valid: () => true, settled: again.tracked.settled, read: again.read });
    await Promise.resolve(); again.tracked.close(); expect(await navigation).toBe(false); expect(again.setVisibleRange).not.toHaveBeenCalled();
    again.repair.resolve([]);
  });
  it("preserves feed capabilities, receivers and progressive completion rather than buffering live ticks", async () => {
    const progress = deferred<ReturnType<typeof bar>[] | null>(), onBar = vi.fn(), unsubscribe = vi.fn();
    const source = { label: "feed", load: vi.fn(async function(this: { label: string }) { expect(this.label).toBe("feed"); return [bar(0)]; }),
      loadProgressive: vi.fn(function(this: { label: string }) { expect(this.label).toBe("feed"); return progress.promise; }),
      subscribe: vi.fn((_cfg, callback) => { callback(bar(60000)); return unsubscribe; }),
      symbolInfo: vi.fn(() => undefined), destroy: vi.fn() };
    const tracked = trackChartFeed(source), stop = tracked.feed.subscribe(market, onBar);
    expect(onBar).toHaveBeenCalledWith(bar(60000)); stop(); expect(unsubscribe).toHaveBeenCalledOnce();
    expect(tracked.feed.loadRange).toBeUndefined(); expect(await tracked.feed.load(market)).toEqual([bar(0)]);
    const request = tracked.feed.loadProgressive!(market, () => {}), wait = tracked.settled(market);
    progress.resolve(null); expect(await request).toBeNull(); expect(await wait).toBe(true);
    tracked.feed.destroy?.(); expect(source.destroy).toHaveBeenCalledOnce();
  });
  it("frames only the revealed Replay prefix without waiting for live repairs or exposing future bars", async () => {
    const s = setup(); s.write([bar(0), bar(60000), bar(120000), bar(180000)]);
    Object.assign(s.chart.replay.state, { active: true, cursorTime: 60000 });
    const settled = vi.fn(s.tracked.settled);
    expect(await frameRecentView(s.chart, { valid: () => true, settled, read: s.read })).toBe(true);
    expect(settled).not.toHaveBeenCalled(); expect(s.setVisibleRange).toHaveBeenCalledExactlyOnceWith({ from: 0, to: 60000 });
  });
  it("uses Footprint padding after restoration and rejects empty history instead of inventing a window", async () => {
    const s = setup(); s.write([bar(0), bar(60000)]);
    expect(await frameRecentView(s.chart, { valid: () => true, settled: s.tracked.settled, read: () => ({ ...s.read(), chartType: "footprint", width: 375 }) })).toBe(true);
    expect(s.setVisibleRange).toHaveBeenCalledExactlyOnceWith({ from: -33000, to: 99000 });
    s.write([]); await expect(frameRecentView(s.chart, { valid: () => true, settled: s.tracked.settled, read: s.read })).rejects.toThrow("Load chart history");
  });
  it("frames complete loaded TPO sessions while retaining the revealed Replay cutoff", async () => {
    const s = setup(), day = 86400000; s.write([bar(0), bar(day), bar(2 * day), bar(3 * day)]);
    Object.assign(s.chart.replay.state, { active: true, cursorTime: 2 * day });
    expect(await frameRecentView(s.chart, { valid: () => true, settled: s.tracked.settled,
      read: () => ({ ...s.read(), chartType: "tpo" }) })).toBe(true);
    expect(s.setVisibleRange).toHaveBeenCalledExactlyOnceWith({ from: 0, to: 2 * day + 30 * 60000 });
  });
});
