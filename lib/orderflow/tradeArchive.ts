import type { Tick } from "@/types/trading";
import type { TradeArchiveRead, TradeArchiveRecord, TradeArchiveSelection, TradeArchiveStats, TradeArchiveWrite } from "@/types/tradeArchive";
import { isSymbolId, providerOf } from "@/lib/symbolId";
import { ArchiveQuantities } from "./archiveQuantities";
import { validTradeCount } from "@/lib/market/tradeCounts";
export const ARCHIVE_MAX_TRADES = 250_000;
export const ARCHIVE_RETENTION_MS = 7 * 86_400_000;
export const ARCHIVE_BATCH = 1000;
const NAME = "affentrader-classified-trades-v1";
export const archiveUtcInput = (time: number) => new Date(time).toISOString().slice(0, 23);
export function parseArchiveUtcInput(value: string): number {
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d)(?::(\d\d)(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return NaN;
  const canonical = `${match[1]}:${match[2] ?? "00"}.${(match[3] ?? "").padEnd(3, "0")}`, time = Date.parse(`${canonical}Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 23) === canonical ? time : NaN;
}
export function isArchivableTrade(value: unknown): value is Tick {
  if (!value || typeof value !== "object") return false;
  const tick = value as Tick;
  return isSymbolId(tick.symbol) && ["binance", "hyperliquid", "kraken"].includes(providerOf(tick.symbol)) && tick.simulated === false &&
    typeof tick.id === "string" && /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,255}$/.test(tick.id) && Number.isSafeInteger(tick.time) && tick.time > 0 && tick.time < 8.64e15 &&
    Number.isFinite(tick.price) && tick.price > 0 && Number.isFinite(tick.quantity) && tick.quantity > 0 && (tick.side === "buy" || tick.side === "sell") &&
    (tick.seq === undefined || Number.isSafeInteger(tick.seq) && tick.seq >= 0) &&
    (tick.tradeCount === undefined || validTradeCount(tick.tradeCount));
}
const keyOf = (tick: Tick) => `${tick.symbol}\0${tick.id}`;
const sameTrade = (a: Tick, b: Tick) => a.symbol === b.symbol && a.id === b.id && a.time === b.time && a.price === b.price && a.quantity === b.quantity && a.side === b.side && a.simulated === b.simulated && a.seq === b.seq
  && (a.tradeCount === undefined || b.tradeCount === undefined || a.tradeCount === b.tradeCount);
function cleanTick(tick: Tick): Tick { return { id: tick.id, symbol: tick.symbol, time: tick.time, price: tick.price, quantity: tick.quantity, side: tick.side, simulated: false,
  ...(tick.seq === undefined ? {} : { seq: tick.seq }), ...(tick.tradeCount === undefined ? {} : { tradeCount: tick.tradeCount }) }; }
export class TradeArchiveDb {
  private opened?: Promise<IDBDatabase>;
  constructor(private name = NAME, private capacity = ARCHIVE_MAX_TRADES, private retention = ARCHIVE_RETENTION_MS, private now = Date.now) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > ARCHIVE_MAX_TRADES || !Number.isFinite(retention) || retention <= 0) throw new Error("Invalid trade archive policy.");
  }
  private open(): Promise<IDBDatabase> {
    if (!this.opened) this.opened = new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest; let blocked = false;
      try { request = indexedDB.open(this.name, 1); } catch { reject(new Error("Local trade storage is unavailable in this browser.")); return; }
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("trades", { keyPath: "key" });
        store.createIndex("time", "tick.time"); store.createIndex("symbol", "tick.symbol"); store.createIndex("symbolTime", ["tick.symbol", "tick.time", "key"]);
      };
      request.onerror = () => { this.opened = undefined; reject(new Error("Local trade storage could not be opened.")); };
      request.onblocked = () => { blocked = true; reject(new Error("Close older Affentrader tabs to open the trade archive.")); };
      request.onsuccess = () => { const db = request.result; if (blocked) { db.close(); return; } db.onversionchange = () => { db.close(); this.opened = undefined; }; resolve(db); };
    });
    const pending = this.opened; void pending.catch(() => { if (this.opened === pending) this.opened = undefined; });
    return this.opened;
  }
  private transaction(db: IDBDatabase): IDBTransaction {
    try { return db.transaction("trades", "readwrite", { durability: "strict" }); }
    catch (error) { if (!(error instanceof TypeError)) throw error; return db.transaction("trades", "readwrite"); }
  }
  async append(input: readonly Tick[]): Promise<TradeArchiveWrite> {
    if (input.length > ARCHIVE_BATCH) throw new Error("Trade archive batches are limited to 1,000 executions.");
    const now = this.now(), unique = new Map<string, Tick>(); let repeated = 0;
    for (const tick of input) {
      if (!isArchivableTrade(tick) || tick.time > now + 60_000) throw new Error("Only valid real Binance, Kraken or Hyperliquid classified executions can be recorded.");
      const key = keyOf(tick), previous = unique.get(key);
      if (previous && !sameTrade(previous, tick)) throw new Error("Conflicting execution IDs; the archive batch was not saved.");
      if (previous) repeated++; else unique.set(key, cleanTick(tick));
    }
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.transaction(db), store = tx.objectStore("trades"), result = { added: 0, duplicates: repeated, expired: 0, evicted: 0, count: 0 };
      let issue: string | undefined, remaining = unique.size; const addedKeys = new Set<string>();
      const fail = (message: string) => { issue = message; tx.abort(); };
      const prune = () => {
        const count = store.count(); count.onsuccess = () => {
          let excess = Math.max(0, count.result - this.capacity); result.count = count.result;
          const cursor = store.index("time").openCursor(); cursor.onsuccess = () => {
            const entry = cursor.result; if (!entry) return;
            const expired = Number(entry.key) < now - this.retention;
            if (!expired && excess <= 0) return;
            if (typeof entry.primaryKey === "string" && addedKeys.delete(entry.primaryKey)) result.added--;
            entry.delete(); result.count--; if (expired) result.expired++; else result.evicted++; if (excess > 0) excess--; entry.continue();
          };
        };
      };
      for (const [key, tick] of unique) {
        const get = store.get(key); get.onsuccess = () => {
          const existing = get.result as TradeArchiveRecord | undefined;
          if (existing) {
            if (!isArchivableTrade(existing.tick) || !sameTrade(existing.tick, tick)) { fail("Conflicting or corrupt stored execution; no batch changes were committed."); return; }
            result.duplicates++;
          } else { store.put({ key, tick, recordedAt: now } satisfies TradeArchiveRecord); addedKeys.add(key); result.added++; }
          if (--remaining === 0) prune();
        };
      }
      if (!remaining) prune();
      tx.onabort = tx.onerror = () => reject(new Error(issue ?? "Trade storage failed or its quota was reached. The batch was not committed."));
      tx.oncomplete = () => resolve(result);
    });
  }
  async stats(): Promise<TradeArchiveStats> {
    await this.append([]); // Apply the disclosed rolling retention even while recording is paused.
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("trades", "readonly"), store = tx.objectStore("trades"), total = store.count(), indexed = store.index("symbolTime").count(), cursor = store.index("symbol").openKeyCursor(undefined, "nextunique"), symbols = new Map<string, { symbol: string; count: number; first: number; last: number }>();
      const result: TradeArchiveStats = { count: 0, first: null, last: null, symbols: [] }; let issue: string | undefined;
      cursor.onsuccess = () => {
        const entry = cursor.result; if (!entry) return;
        const symbol = entry.key;
        if (typeof symbol !== "string" || !isSymbolId(symbol) || !["binance", "hyperliquid", "kraken"].includes(providerOf(symbol))) { issue = "Corrupt trade archive market. Data was retained for inspection."; tx.abort(); return; }
        const summary = { symbol, count: 0, first: 0, last: 0 }; symbols.set(symbol, summary);
        const count = store.index("symbol").count(symbol); count.onsuccess = () => { summary.count = count.result; };
        const bounds = IDBKeyRange.bound([symbol, 0, ""], [symbol, 8.64e15, "\uffff"]);
        for (const direction of ["next", "prev"] as const) {
          const edge = store.index("symbolTime").openKeyCursor(bounds, direction); edge.onsuccess = () => {
            const key = edge.result?.key;
            if (!Array.isArray(key) || typeof key[1] !== "number" || !Number.isFinite(key[1])) { issue = "Corrupt trade archive time index."; tx.abort(); return; }
            summary[direction === "next" ? "first" : "last"] = key[1];
          };
        }
        entry.continue();
      };
      tx.onabort = tx.onerror = () => reject(new Error(issue ?? "Trade archive statistics could not be read."));
      tx.oncomplete = () => {
        result.symbols = [...symbols.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
        result.count = result.symbols.reduce((sum, item) => sum + item.count, 0);
        if (result.count !== total.result || total.result !== indexed.result) { reject(new Error("Trade archive indexes are incomplete. No summary was returned.")); return; }
        for (const summary of result.symbols) { result.first = Math.min(result.first ?? summary.first, summary.first); result.last = Math.max(result.last ?? summary.last, summary.last); }
        resolve(result);
      };
    });
  }
  async read(selection: TradeArchiveSelection, limit = ARCHIVE_MAX_TRADES, signal?: AbortSignal): Promise<TradeArchiveRead> {
    if (!isSymbolId(selection.symbol) || !["binance", "hyperliquid", "kraken"].includes(providerOf(selection.symbol)) || !Number.isFinite(selection.from) || !Number.isFinite(selection.to) || selection.from >= selection.to || !Number.isInteger(limit) || limit < 1 || limit > ARCHIVE_MAX_TRADES) throw new Error("Choose a supported market and a valid start/end time.");
    signal?.throwIfAborted(); await this.append([]);
    const db = await this.open();
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("trades", "readonly"), range = IDBKeyRange.bound([selection.symbol, selection.from, ""], [selection.symbol, selection.to, ""], false, true), store = tx.objectStore("trades");
      const total = store.count(), indexed = store.index("symbolTime").count();
      const cursor = store.index("symbolTime").openCursor(range), quantities = new ArchiveQuantities(), result: TradeArchiveRead = { selection: { ...selection }, trades: [], buyVolume: "0", sellVolume: "0", delta: "0", first: null, last: null, coverage: "observed-only" }; let issue: string | undefined;
      const cancel = () => { try { tx.abort(); } catch { /* A completed/aborted transaction has already settled its result. */ } }; signal?.addEventListener("abort", cancel, { once: true });
      cursor.onsuccess = () => {
        const entry = cursor.result; if (!entry) return;
        const record = entry.value as TradeArchiveRecord;
        if (!isArchivableTrade(record.tick) || record.key !== keyOf(record.tick)) { issue = "Corrupt trade archive record; no partial result was returned."; tx.abort(); return; }
        if (result.trades.length >= limit) { issue = "The selection exceeds the read limit. Narrow its time range; no partial export was returned."; tx.abort(); return; }
        const tick = cleanTick(record.tick); result.trades.push(tick); result.first ??= tick.time; result.last = tick.time;
        quantities.add(tick); entry.continue();
      };
      tx.onabort = tx.onerror = () => { signal?.removeEventListener("abort", cancel); reject(signal?.aborted ? new DOMException("Archive read cancelled.", "AbortError") : new Error(issue ?? "Trade archive could not be read.")); }; tx.oncomplete = () => {
        signal?.removeEventListener("abort", cancel);
        if (total.result !== indexed.result) { reject(new Error("Trade archive indexes are incomplete; no partial result was returned.")); return; }
        try { Object.assign(result, quantities.read()); resolve(result); } catch (error) { reject(error); }
      };
    });
  }
  async close() { const opened = this.opened; this.opened = undefined; if (opened) await opened.then(db => db.close(), () => {}); }
}
export const tradeArchiveDb = new TradeArchiveDb();
export function archiveCsv(snapshot: TradeArchiveRead): string {
  const cell = (value: unknown) => `"${String(value).replace(/"/g, '""')}"`;
  return ["symbol,id,exchange_sequence,time_utc,price,quantity,aggressor_side,coverage,trade_count", ...snapshot.trades.map(tick => [tick.symbol, tick.id, tick.seq ?? "", new Date(tick.time).toISOString(), tick.price, tick.quantity, tick.side, "observed-only", tick.tradeCount ?? ""].map(cell).join(","))].join("\r\n");
}
