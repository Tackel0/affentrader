import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { archiveCsv, archiveUtcInput, parseArchiveUtcInput, isArchivableTrade, TradeArchiveDb } from "@/lib/orderflow/tradeArchive";
import { TradeRecorder, type RecorderStatus } from "@/lib/orderflow/tradeRecorder";
import type { Tick } from "@/types/trading";
import type { TradeArchiveWrite } from "@/types/tradeArchive";
import { ArchiveQuantities } from "@/lib/orderflow/archiveQuantities";
const now = 1_800_000_000_000, databases: TradeArchiveDb[] = [];
const tick = (id: number, patch: Partial<Tick> = {}): Tick => ({ id: `BTC-${id}`, symbol: "HL:BTC", time: now - 10_000 + id, price: 100 + id / 100, quantity: 2, side: id % 2 ? "buy" : "sell", simulated: false, seq: id, ...patch });
const query = { symbol: "HL:BTC", from: now - 20_000, to: now + 1 };
const database = (name = "archive-test", capacity = 250_000, retention = 7 * 86_400_000) => { const db = new TradeArchiveDb(name, capacity, retention, () => now); databases.push(db); return db; };
beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange); });
afterEach(async () => { for (const db of databases) await db.close(); databases.length = 0; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("durable classified trade archive", () => {
  it("round-trips millisecond UTC interval bounds and rejects normalized invalid calendar dates", () => {
    expect(parseArchiveUtcInput(archiveUtcInput(tick(1).time))).toBe(tick(1).time);
    expect(parseArchiveUtcInput("2026-11-01T12:30:00.1")).toBe(Date.parse("2026-11-01T12:30:00.100Z"));
    expect(parseArchiveUtcInput("2026-11-01T12:30")).toBe(Date.parse("2026-11-01T12:30:00Z"));
    for (const invalid of ["2026-02-30T12:30", "2026-11-01T25:00", "2026-11-01T12:30Z", "bad"]) expect(Number.isNaN(parseArchiveUtcInput(invalid))).toBe(true);
  });
  it("commits immutable source records and restores their exact sides/quantities through a new database connection", async () => {
    const first = database(); expect(await first.append([tick(2), tick(1)])).toMatchObject({ added: 2, count: 2 }); await first.close();
    const result = await database().read(query);
    expect(result.trades).toEqual([tick(1), tick(2)]); expect(result).toMatchObject({ buyVolume: "2", sellVolume: "2", coverage: "observed-only", first: tick(1).time, last: tick(2).time });
  });
  it("deduplicates repeated events and concurrent tab writers without conflating identical IDs in different markets", async () => {
    const first = database(), second = database();
    const results = await Promise.all([first.append([tick(1), tick(1)]), second.append([tick(1)])]);
    expect(results.reduce((sum, result) => sum + result.added, 0)).toBe(1); expect(results.reduce((sum, result) => sum + result.duplicates, 0)).toBe(2);
    await second.append([tick(1, { symbol: "BTCUSDT" })]); const stats = await first.stats(); expect(stats.count).toBe(2); expect(stats.symbols).toHaveLength(2);
  });
  it("rolls back every insertion in a conflicting batch and keeps the previous committed record intact", async () => {
    const db = database(); await db.append([tick(1)]);
    await expect(db.append([tick(2), tick(1, { quantity: 9 })])).rejects.toThrow(/Conflicting/);
    expect((await db.read(query)).trades).toEqual([tick(1)]);
    await expect(db.append([tick(3), tick(3, { side: "sell" })])).rejects.toThrow(/Conflicting/);
    expect((await db.stats()).count).toBe(1);
  });
  it("applies a half-open exact-time range, including all same-millisecond execution IDs", async () => {
    const db = database(); await db.append([tick(1), tick(2, { time: tick(1).time }), tick(3)]);
    const result = await db.read({ ...query, from: tick(1).time, to: tick(3).time }); expect(result.trades.map(trade => trade.id)).toEqual(["BTC-1", "BTC-2"]);
    await expect(db.read({ ...query, from: query.to })).rejects.toThrow(/valid start/);
  });
  it("expires records by event time and evicts the oldest globally, while retaining the exact cutoff", async () => {
    const db = database("bounded", 3, 1000);
    const result = await db.append([tick(1, { time: now - 1001 }), tick(2, { time: now - 1000 }), tick(3, { time: now - 3 }), tick(4, { time: now - 2 }), tick(5, { time: now - 1 })]);
    expect(result).toMatchObject({ added: 3, expired: 1, evicted: 1, count: 3 });
    expect((await db.read(query)).trades.map(trade => trade.id)).toEqual(["BTC-3", "BTC-4", "BTC-5"]);
    const cutoff = database("cutoff", 3, 1000); await cutoff.append([tick(2, { time: now - 1000 })]); expect((await cutoff.stats()).count).toBe(1);
  });
  it("enforces expiry during paused reads without depending on incoming market ticks", async () => {
    let clock = now; const db = new TradeArchiveDb("clock", 10, 1000, () => clock); databases.push(db);
    await db.append([tick(1, { time: now })]); clock += 1001;
    expect((await db.stats()).count).toBe(0); expect((await db.read({ ...query, to: now + 2000 })).trades).toEqual([]);
  });
  it("excludes simulation, unclassified providers, malformed values and unsafe IDs before writing any row", async () => {
    const db = database();
    for (const patch of [{ simulated: true }, { symbol: "IEX:AAPL" }, { symbol: "YF:AAPL" }, { price: NaN }, { quantity: 0 }, { id: "=HYPERLINK()" }, { seq: -1 }, { time: now + 60_001 }, { time: now - 0.5 }]) {
      await expect(db.append([tick(1, patch)])).rejects.toThrow(/valid real/);
    }
    expect(isArchivableTrade(tick(1, { symbol: "HL:xyz:TSLA", id: "xyz:TSLA-12" }))).toBe(true); expect((await db.stats()).count).toBe(0);
  });
  it("rejects overlarge batches and selections instead of silently returning partial exports", async () => {
    const db = database(); await expect(db.append(Array.from({ length: 1001 }, (_, index) => tick(index)))).rejects.toThrow(/1,000/);
    await db.append([tick(1), tick(2)]); await expect(db.read(query, 1)).rejects.toThrow(/no partial export/);
    expect((await db.read(query)).trades).toHaveLength(2);
  });
  it("exports every selected row with canonical clocks, source identity and observed-only coverage", async () => {
    const db = database(); await db.append([tick(1), tick(2)]); const result = await db.read(query), csv = archiveCsv(result);
    expect(csv.split("\r\n")).toHaveLength(3); expect(csv).toContain('"HL:BTC","BTC-1"'); expect(csv).toContain(new Date(tick(1).time).toISOString()); expect(csv).toContain('"observed-only"');
    expect(csv).toContain("exchange_sequence"); expect(csv).toContain('"BTC-1","1"');
  });
  it("sums canonical decimal quantities and delta without binary residue, rounding or numeric overflow", async () => {
    const db = database(); await db.append([tick(1, { quantity: 0.1 }), tick(3, { quantity: 0.2 }), tick(2, { quantity: 0.2 })]);
    expect(await db.read(query)).toMatchObject({ buyVolume: "0.3", sellVolume: "0.2", delta: "0.1" });
    const quantities = new ArchiveQuantities(); quantities.add({ quantity: 1e-8, side: "buy" }); quantities.add({ quantity: 2e-8, side: "sell" }); expect(quantities.read()).toMatchObject({ delta: "-0.00000001" });
    const overflow = new ArchiveQuantities(); overflow.add({ quantity: 1e308, side: "buy" }); overflow.add({ quantity: 1e308, side: "buy" }); expect(overflow.read().buyVolume).toBe(`2${"0".repeat(308)}`);
    const mixed = new ArchiveQuantities(); mixed.add({ quantity: 1e20, side: "buy" }); mixed.add({ quantity: 0.1, side: "buy" }); expect(mixed.read().buyVolume).toBe("100000000000000000000.1");
  });
  it("reports unavailable storage and can retry after the browser API becomes available", async () => {
    const db = database(); vi.stubGlobal("indexedDB", undefined); await expect(db.stats()).rejects.toThrow(/unavailable/);
    vi.stubGlobal("indexedDB", new IDBFactory()); await db.append([tick(1)]); expect((await db.stats()).count).toBe(1);
  });
  it("cancels obsolete interval reads without yielding partial records or changing committed data", async () => {
    const db = database(); await db.append(Array.from({ length: 1000 }, (_, index) => tick(index)));
    const controller = new AbortController(), pending = db.read(query, 250_000, controller.signal), rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    setTimeout(() => controller.abort(), 0); await rejected;
    await expect(db.read(query, 250_000, AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" }); expect((await db.read(query)).trades).toHaveLength(1000);
  });
  it("fails closed for missing time indexes and corrupt selected records without claiming a partial export", async () => {
    const db = database(); await db.append([tick(1)]);
    const request = indexedDB.open("archive-test", 1), raw = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const put = (value: unknown) => new Promise<void>((resolve, reject) => { const tx = raw.transaction("trades", "readwrite"); tx.objectStore("trades").put(value); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    await put({ key: "orphan", tick: { symbol: "HL:BTC" } }); await expect(db.read(query)).rejects.toThrow(/indexes are incomplete/); await expect(db.stats()).rejects.toThrow(/index|Corrupt/);
    const clear = raw.transaction("trades", "readwrite"); clear.objectStore("trades").delete("orphan"); await new Promise<void>(resolve => { clear.oncomplete = () => resolve(); });
    await put({ key: "HL:BTC\0BTC-1", tick: tick(1, { side: "unknown" as Tick["side"] }) }); await expect(db.read(query)).rejects.toThrow(/Corrupt/); raw.close();
  });
});

const saved = (count: number): TradeArchiveWrite => ({ added: count, duplicates: 0, expired: 0, evicted: 0, count });
describe("bounded trade recording queue", () => {
  it("serializes commits in bounded batches and includes arrivals during a pending transaction", async () => {
    let finish: (value: TradeArchiveWrite) => void = () => {};
    const sink = { append: vi.fn().mockImplementationOnce(() => new Promise<TradeArchiveWrite>(done => { finish = done; })).mockResolvedValue(saved(1)) }, states: RecorderStatus[] = [];
    const recorder = new TradeRecorder(sink, status => states.push(status)); recorder.start(); recorder.accept(tick(1)); const work = recorder.flush(); await Promise.resolve();
    recorder.accept(tick(2)); expect(states.at(-1)?.committed).toBe(0); finish(saved(1)); await work;
    expect(sink.append).toHaveBeenCalledTimes(2); expect(states.at(-1)).toMatchObject({ committed: 2, pending: 0, writing: false });
  });
  it("keeps failed observations pending, pauses recording and retries them without counting failed writes", async () => {
    const sink = { append: vi.fn().mockRejectedValueOnce(new Error("quota reached")).mockResolvedValue(saved(1)) }, states: RecorderStatus[] = [];
    const recorder = new TradeRecorder(sink, status => states.push(status)); recorder.start(); recorder.accept(tick(1)); await recorder.flush();
    expect(states.at(-1)).toMatchObject({ recording: false, pending: 1, committed: 0, error: "quota reached" }); expect(recorder.accept(tick(2))).toBe(false);
    recorder.start(); await recorder.flush(); expect(states.at(-1)).toMatchObject({ recording: true, pending: 0, committed: 1, error: "" });
  });
  it("pauses with a visible gap when the bounded pending queue fills, while preserving already queued records", async () => {
    const states: RecorderStatus[] = [], sink = { append: vi.fn(async (_trades: readonly Tick[]) => saved(2)) }, recorder = new TradeRecorder(sink, status => states.push(status), 2);
    recorder.start(); recorder.accept(tick(1)); recorder.accept(tick(2)); expect(recorder.accept(tick(3))).toBe(false);
    expect(states.at(-1)).toMatchObject({ recording: false, pending: 2 }); expect(states.at(-1)?.error).toContain("not recorded"); await recorder.flush(); expect(sink.append.mock.calls[0][0]).toHaveLength(2);
  });
  it("ignores non-recordable source ticks and drains on pause without allowing new trades", async () => {
    const sink = { append: vi.fn(async () => saved(1)) }, states: RecorderStatus[] = [], recorder = new TradeRecorder(sink, status => states.push(status));
    expect(recorder.accept(tick(1))).toBe(false); recorder.start(); expect(recorder.accept(tick(2, { simulated: true }))).toBe(false);
    recorder.accept(tick(1)); await recorder.pause(); expect(recorder.accept(tick(3))).toBe(false); expect(states.at(-1)).toMatchObject({ recording: false, pending: 0, committed: 1 });
  });
  it("drains a burst larger than one storage batch with exactly 1,000/1,000/5 executions", async () => {
    let total = 0; const states: RecorderStatus[] = [], sink = { append: vi.fn(async (trades: readonly Tick[]) => ({ ...saved(trades.length), count: total += trades.length })) }, recorder = new TradeRecorder(sink, state => states.push(state));
    recorder.start(); for (let index = 0; index < 2005; index++) recorder.accept(tick(index)); await recorder.pause();
    expect(sink.append.mock.calls.map(([trades]) => trades.length)).toEqual([1000, 1000, 5]); expect(states.at(-1)).toMatchObject({ pending: 0, committed: 2005, retained: 2005 });
  });
  it("starts a full write batch before the partial-batch timer expires", async () => {
    vi.useFakeTimers();
    const sink = { append: vi.fn(async (trades: readonly Tick[]) => saved(trades.length)) };
    const recorder = new TradeRecorder(sink, () => {});
    try {
      recorder.start();
      for (let index = 0; index < 999; index++) recorder.accept(tick(index));
      await vi.advanceTimersByTimeAsync(100);
      expect(sink.append).not.toHaveBeenCalled();
      const before = Date.now();
      recorder.accept(tick(999));
      await Promise.resolve();
      expect(sink.append).toHaveBeenCalledOnce();
      expect(sink.append.mock.calls[0][0]).toHaveLength(1000);
      expect(Date.now()).toBe(before);
      await recorder.pause();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
