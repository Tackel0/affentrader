import type { OrderBook } from "@/types/trading";
import { providerOf } from "@/lib/symbolId";
import { DepthHeatmapCollection, defaultDepthHeatmap, MAX_DEPTH_HOLD_MS } from "./depthHeatmap";

const settings = defaultDepthHeatmap();
const MAX_MARKETS = 4;
export const REPLAY_DEPTH_RETENTION_MS = settings.retentionMinutes * 60000;

/** Opt-in session storage of observed top levels. Each market retains up to 600 samples. */
export class ReplayDepth {
  private markets = new Map<string, DepthHeatmapCollection>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private statusRevision = 0;
  private error = "";
  private activeMarket: string | null = null;
  get recording() { return this.activeMarket; }
  set recording(symbol: string | null) {
    if (this.activeMarket === symbol) return;
    this.activeMarket = symbol;
    this.statusRevision++;
    this.changed();
  }
  get storageError() { return this.error; }
  set storageError(error: string) {
    if (this.error === error) return;
    this.error = error;
    this.statusRevision++;
    this.changed();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getRevision = () => this.revision;
  getStatusRevision = () => this.statusRevision;

  private changed() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }

  accept(book: OrderBook, receivedAt: number) {
    if (book.symbol !== this.recording) return;
    return this.restore(book, receivedAt);
  }

  restore(book: OrderBook, receivedAt: number) {
    if (!["binance", "hyperliquid", "kraken"].includes(providerOf(book.symbol))) return;
    const collection = this.markets.get(book.symbol) ?? new DepthHeatmapCollection(book.symbol);
    if (!collection.add(book, receivedAt, settings)) return;
    this.markets.delete(book.symbol);
    this.markets.set(book.symbol, collection);
    if (this.markets.size > MAX_MARKETS) this.markets.delete(this.markets.keys().next().value!);
    const accepted = collection.latest();
    this.changed();
    return accepted;
  }

  before(symbol: string, through: number, now: number) {
    if (!Number.isSafeInteger(through) || through > now) return undefined;
    const columns = this.markets.get(symbol)?.read(now, settings);
    if (!columns) return undefined;
    for (let i = columns.length - 1; i >= 0; i--) {
      const column = columns[i];
      if (column.observedAt >= through || column.exchangeTime >= through) continue;
      if (through - column.observedAt > MAX_DEPTH_HOLD_MS || through - column.exchangeTime > 5000) return undefined;
      return column;
    }
  }

  window(symbol: string, through: number, now: number, retentionMinutes: number) {
    if (!Number.isSafeInteger(through) || through > now) return [];
    const from = through - retentionMinutes * 60000;
    return this.markets.get(symbol)?.read(now, settings).filter(column =>
      column.observedAt >= from && column.observedAt < through && column.exchangeTime < through
    ) ?? [];
  }
}

export const replayDepth = new ReplayDepth();
