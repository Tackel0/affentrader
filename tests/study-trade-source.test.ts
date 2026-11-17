import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, NativeIndicatorOutput } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import type { TradeArchiveRead } from "@/types/tradeArchive";
import { StudyTradeSource } from "@/lib/orderflow/studyTradeSource";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import { cvdDescriptor, type CvdNotice } from "@/lib/orderflow/cvdIndicator";
import { sessionProfileDescriptor } from "@/lib/orderflow/volumeProfileIndicator";
import type { VolumeProfileChannel } from "@/lib/orderflow/volumeProfileRenderer";
const base = Date.UTC(2026, 10, 1, 12), symbol = "HL:BTC";
const tick = (id: string, offset: number, quantity = 1, side: Tick["side"] = "buy", patch: Partial<Tick> = {}): Tick => ({ id, time: base + offset, symbol, quantity, side, price: 100, simulated: false, ...patch });
const snapshot = (trades: Tick[]): TradeArchiveRead => ({ selection: { symbol: trades[0]?.symbol ?? symbol, from: base, to: base + 600_000 }, trades, buyVolume: "0", sellVolume: "0", delta: "0", first: trades[0]?.time ?? null, last: trades.at(-1)?.time ?? null, coverage: "observed-only" });
const bars = [0, 60_000, 120_000, 180_000].map(offset => ({ time: base + offset, open: 100, high: 101, low: 99, close: 100, volume: 10 }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("explicit archived executions for native studies", () => {
  it("atomically loads copied fields, orders equal times by sequence/ID and deduplicates live overlap", () => {
    const source = new StudyTradeSource(), a = tick("a", 1, 2, "buy", { seq: 2 }), b = tick("b", 1, 1, "sell", { seq: 1 });
    const input = snapshot([a, b]); source.install(input, [a, tick("live", 2)]);
    input.trades[0].quantity = 99; input.selection.from = 0;
    const live = [tick("live", 2), { ...b }, tick("a", 1, 2, "buy", { seq: 2 })];
    expect(source.read(symbol, live).map(t => [t.id, t.quantity])).toEqual([["b", 1], ["a", 2], ["live", 1]]);
    expect(source.read(symbol, live)).toBe(source.read(symbol, live));
    expect(source.loaded()[0]).toMatchObject({ count: 2, selection: { from: base } });
    source.loaded()[0].selection.from = 42; expect(source.loaded()[0].selection.from).toBe(base);
    expect(Object.isFrozen(source.read(symbol, live))).toBe(true);
    expect(Object.isFrozen(source.read(symbol, live)[0])).toBe(true);
  });
  it("retains a working selection on invalid replacement, duplicate IDs, wrong source, range or capacity", () => {
    const source = new StudyTradeSource(); source.install(snapshot([tick("old", 1)]));
    for (const invalid of [snapshot([]), snapshot([tick("dup", 1), tick("dup", 2)]), snapshot([tick("sim", 1, 1, "buy", { simulated: true })]), snapshot([tick("outside", -1)])]) expect(() => source.install(invalid)).toThrow();
    const wrong = snapshot([tick("wrong", 1)]); wrong.selection.symbol = "HL:ETH"; expect(() => source.install(wrong)).toThrow();
    expect(() => source.install(snapshot(Array.from({ length: 100001 }, (_, i) => tick(String(i), i))))).toThrow(/100,000/);
    expect(source.read(symbol, []).map(t => t.id)).toEqual(["old"]); expect(source.revision(symbol)).toBe(1);
  });
  it("rejects conflicts and live-overlap capacity before replacing the previous selection", () => {
    const source = new StudyTradeSource(); source.install(snapshot([tick("old", 1)]));
    expect(() => source.install(snapshot([tick("same", 1)]), [tick("same", 1, 9)])).toThrow(/conflict/);
    const max = snapshot(Array.from({ length: 100000 }, (_, i) => tick(String(i), i)));
    expect(() => source.install(max, [tick("extra", 1)])).toThrow(/100,000/);
    expect(source.read(symbol, []).map(t => t.id)).toEqual(["old"]);
  });
  it("does not mix symbols, live simulations or unrelated legacy live feeds", () => {
    const source = new StudyTradeSource(); source.install(snapshot([tick("a", 1)]));
    const eth = [tick("a", 2, 5, "sell", { symbol: "HL:ETH" })]; expect(source.read("HL:ETH", eth)).toBe(eth);
    const simulated = [tick("a", 1, 20, "buy", { simulated: true })];
    expect(source.read(symbol, simulated)).toBe(simulated); expect(source.label(symbol, simulated)).toBe("");
    expect(source.read(symbol, []).map(t => t.quantity)).toEqual([1]);
    const legacy = [tick("legacy", 0, 1, "buy", { time: 0 })]; expect(new StudyTradeSource().read(symbol, legacy)).toBe(legacy);
  });
  it("latches a live conflict, notifies only its market and recovers explicitly on removal", () => {
    const source = new StudyTradeSource(), changed = vi.fn(), other = vi.fn(), broken = () => { throw new Error("disposed renderer"); };
    source.subscribe(symbol, broken); const off = source.subscribe(symbol, changed); source.subscribe("HL:ETH", other);
    source.install(snapshot([tick("a", 1)])); source.observe(tick("a", 1, 9)); source.observe(tick("a", 1, 9));
    expect(changed).toHaveBeenCalledTimes(2); expect(other).not.toHaveBeenCalled(); expect(() => source.read(symbol, [])).toThrow(/conflict/);
    source.clear(symbol); expect(source.read(symbol, [])).toEqual([]); expect(source.loaded()).toEqual([]); expect(changed).toHaveBeenCalledTimes(3);
    off(); source.clear(symbol); expect(changed).toHaveBeenCalledTimes(3);
  });
  it("restores actual Footprint row quantities without synthesizing empty historical bars", () => {
    const source = new StudyTradeSource(); source.install(snapshot([tick("buy", 1, 3), tick("sell", 1, 1, "sell"), tick("later", 120001, 2)]));
    const history = new FootprintHistory("1m"); history.add(source.read(symbol, [tick("sell", 1, 1, "sell"), tick("live", 120002, 4, "sell")]));
    const rows = history.read({ step: 1, ratio: 3 });
    expect(rows.map(row => [row.time, row.volume, row.delta])).toEqual([[base, 4, 2], [base + 120000, 6, -2]]);
    expect(history.coverage).toMatchObject({ trades: 4, bars: 2, simulated: false });
  });
  it("rebuilds a running CVD on load/remove and continues live without counting the overlap twice", () => {
    vi.useFakeTimers(); const source = new StudyTradeSource(); let live = [tick("live", 60001, 2)]; let receive: ((tick: Tick) => void) | undefined;
    const outputs: NativeIndicatorOutput[] = [], notices: Array<CvdNotice | null> = [];
    const descriptor = cvdDescriptor(() => source.read(symbol, live), (_symbol, next) => { receive = next; return () => { receive = undefined; }; }, {
      revision: s => source.revision(s), subscribe: (s, changed) => source.subscribe(s, changed), label: s => source.label(s, live),
    });
    const instance = descriptor.create(), context = { symbol, timeframe: "1m", live: true, bars: () => bars, emit: (v: NativeIndicatorOutput) => outputs.push(v), pushData: (v: CvdNotice | null) => notices.push(v), setStatus: vi.fn() } as unknown as NativeIndicatorContext;
    const values = () => { const series = outputs.at(-1)?.series?.[0]; return series && "points" in series ? series.points.map(p => p.value) : []; };
    instance.start(context, { anchor: "Session", plot: "Line" }); expect(values()).toEqual([null, 2, 2, 2]);
    source.install(snapshot([tick("old", 1, 3, "sell"), live[0]]), live); expect(values()).toEqual([-3, -1, -1, -1]); expect(notices.at(-1)?.message).toContain("2 archived");
    const next = tick("next", 120001, 4); live = [next, ...live]; receive!(next); vi.runAllTimers(); expect(values()).toEqual([-3, -1, 3, 3]);
    source.clear(symbol); expect(values()).toEqual([null, 2, 6, 6]); expect(notices.at(-1)?.message).not.toContain("archived");
    instance.suspend(); const count = outputs.length; source.install(snapshot([tick("hidden", 1, 8)])); expect(outputs).toHaveLength(count);
    instance.resume(); expect(values()).toEqual([8, 10, 14, 14]); instance.stop(); source.clear(symbol); expect(receive).toBeUndefined();
  });
  it("rebuilds a running session profile, preserves its market epoch and clears failed archived reads", () => {
    const source = new StudyTradeSource(); const live = [tick("live", 60001, 2)]; let channel: VolumeProfileChannel | null = null;
    const instance = sessionProfileDescriptor(() => source.read(symbol, live), () => () => {}, undefined, () => 7, {
      revision: s => source.revision(s), subscribe: (s, changed) => source.subscribe(s, changed), label: s => source.label(s, live),
    }).create();
    instance.start({ id: "svp", symbol, timeframe: "1m", live: true, bars: () => bars, emit: vi.fn(), pushData: (v: VolumeProfileChannel | null) => { channel = v; }, setStatus: vi.fn() } as unknown as NativeIndicatorContext, {});
    const get = () => channel as VolumeProfileChannel | null;
    expect(get()?.current?.model?.retained).toBe(1);
    source.install(snapshot([tick("old", 1, 3, "sell"), live[0]]), live);
    expect(get()?.current?.model?.retained).toBe(2); expect(get()?.context?.epoch).toBe(7); expect(get()?.current?.sourceLabel).toContain("2 archived");
    expect(get()?.current?.model?.sessions[0].valueArea.total).toBe(5);
    source.observe(tick("old", 1, 99)); expect(get()?.current?.message).toContain("conflict"); expect(get()?.current?.model).toBeUndefined();
    source.clear(symbol); expect(get()?.current?.model?.retained).toBe(1); expect(get()?.current?.sourceLabel).toBe("");
    instance.stop(); expect(get()).toBeNull();
  });
  it("keeps native Replay unavailable even with an installed archive", () => {
    const source = new StudyTradeSource(); source.install(snapshot([tick("future", 120001, 100)]));
    const outputs: NativeIndicatorOutput[] = [], notices: Array<CvdNotice | null> = [];
    const cvd = cvdDescriptor(() => source.read(symbol, []), () => () => {}).create();
    cvd.start({ symbol, timeframe: "1m", live: false, bars: () => bars.slice(0, 1), emit: (v: NativeIndicatorOutput) => outputs.push(v), pushData: (v: CvdNotice | null) => notices.push(v), setStatus: vi.fn() } as unknown as NativeIndicatorContext, {});
    const series = outputs.at(-1)?.series?.[0]; expect(series && "bars" in series ? series.bars.map(bar => Number.isFinite(bar.close) ? bar.close : null) : []).toEqual([null]); expect(notices.at(-1)?.message).toContain("Replay"); cvd.stop();
  });
  it("merges 100,000 archived and overlapping buffered executions without truncation or changing source order", () => {
    const source = new StudyTradeSource(), history = Array.from({ length: 99000 }, (_, i) => tick(String(i), i));
    const live = Array.from({ length: 2000 }, (_, i) => tick(String(98000 + i), 98000 + i)).reverse();
    source.install(snapshot(history), live); const restored = source.read(symbol, live);
    expect(restored).toHaveLength(100000); expect(new Set(restored.map(t => t.id)).size).toBe(100000);
    expect(restored[0].id).toBe("0"); expect(restored.at(-1)?.id).toBe("99999"); expect(live[0].id).toBe("99999");
    expect(() => source.read(symbol, [tick("overflow", 100001), ...live])).toThrow(/100,000/);
  });
  it("cancels an obsolete background profile when an archive replaces its input", () => {
    const source = new StudyTradeSource(), live = [tick("live", 2)];
    const jobs = { submit: vi.fn(), cancel: vi.fn() }; let channel: VolumeProfileChannel | null = null;
    const instance = sessionProfileDescriptor(() => source.read(symbol, live), () => () => {}, jobs, () => 0, {
      revision: s => source.revision(s), subscribe: (s, changed) => source.subscribe(s, changed),
    }).create();
    instance.start({ id: "svp", symbol, timeframe: "1m", live: true, bars: () => bars, emit: vi.fn(), pushData: (v: VolumeProfileChannel | null) => { channel = v; }, setStatus: vi.fn() } as unknown as NativeIndicatorContext, {});
    source.install(snapshot(Array.from({ length: 10001 }, (_, i) => tick(String(i), i + 100))));
    expect(jobs.submit).toHaveBeenCalledTimes(1); const obsolete = jobs.submit.mock.calls[0][4] as (result: { error: string }) => void;
    source.clear(symbol); const get = () => channel as VolumeProfileChannel | null;
    expect(get()?.current?.model?.retained).toBe(1); obsolete({ error: "obsolete worker failure" });
    expect(get()?.current?.model?.retained).toBe(1); expect(get()?.current?.message).toBeUndefined(); expect(jobs.cancel).toHaveBeenCalled(); instance.stop();
  });
});
