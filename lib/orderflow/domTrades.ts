import type { Tick } from "@/types/trading";
import { ladderGrid } from "./depthLadder";

export interface DomExecutionRow { bought: number; sold: number; delta: number; volume: number; last: number | null; lastSide?: "buy" | "sell" }
interface CollectedPrice { bought: number; sold: number; boughtQuote: number; soldQuote: number; latest: Tick }
const newer = (a: Tick, b: Tick) => a.time - b.time || (a.seq ?? 0) - (b.seq ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Panel-session executions only. Does not hydrate from retained tape/history. */
export class DomTrades {
  private prices = new Map<number, CollectedPrice>();
  private seen = new Map<string, Tick>();
  private grouped: { step: number; rows: Map<number, CollectedPrice> } | null = null;
  error = "";
  since: number;
  constructor(readonly symbol: string, since: number, private limits = { ids: 100000, prices: 20000 }) { this.since = since; }
  reset(since: number) { this.since = since; this.prices.clear(); this.seen.clear(); this.grouped = null; this.error = ""; }
  get observations() { return this.seen.size; }
  add(trade: Tick, receivedAt: number): boolean {
    if (this.error || !Number.isSafeInteger(receivedAt) || trade.symbol !== this.symbol || trade.simulated !== false || typeof trade.id !== "string" || !trade.id ||
      !Number.isSafeInteger(trade.time) || trade.time < this.since || trade.time > receivedAt + 1000 ||
      !Number.isFinite(trade.price) || trade.price <= 0 || !Number.isFinite(trade.quantity) || trade.quantity <= 0 ||
      !["buy", "sell"].includes(trade.side)) return false;
    const previous = this.seen.get(trade.id);
    if (previous) {
      if (previous.time !== trade.time || previous.price !== trade.price || previous.quantity !== trade.quantity || previous.side !== trade.side)
        this.error = "Conflicting execution identity. Reset DOM trade counting to restart.";
      return false;
    }
    if (this.seen.size >= this.limits.ids || !this.prices.has(trade.price) && this.prices.size >= this.limits.prices) {
      this.error = "DOM trade counting capacity reached. Reset to start a new collected interval."; return false;
    }
    const snapshot = { ...trade }, old = this.prices.get(trade.price);
    const next: CollectedPrice = old ? { ...old } : { bought: 0, sold: 0, boughtQuote: 0, soldQuote: 0, latest: snapshot };
    if (trade.side === "buy") { next.bought += trade.quantity; next.boughtQuote += trade.quantity * trade.price; }
    else { next.sold += trade.quantity; next.soldQuote += trade.quantity * trade.price; }
    if (![next.bought, next.sold, next.boughtQuote, next.soldQuote, next.bought + next.sold, next.boughtQuote + next.soldQuote].every(Number.isFinite)) {
      this.error = "DOM execution quantities exceed supported precision. Reset to restart."; return false;
    }
    if (newer(snapshot, next.latest) > 0) next.latest = snapshot;
    this.prices.set(trade.price, next); this.seen.set(trade.id, snapshot); this.grouped = null; return true;
  }
  private groupRows(step: number): Map<number, CollectedPrice> {
    if (this.grouped?.step === step) return this.grouped.rows;
    const grid = ladderGrid(step);
    const grouped = new Map<number, CollectedPrice>();
    for (const [price, raw] of this.prices) {
      const key = grid.price(price), row = grouped.get(key);
      if (!row) grouped.set(key, { ...raw });
      else {
        row.bought += raw.bought; row.sold += raw.sold; row.boughtQuote += raw.boughtQuote; row.soldQuote += raw.soldQuote;
        if (newer(raw.latest, row.latest) > 0) row.latest = raw.latest;
      }
    }
    this.grouped = { step, rows: grouped };
    return grouped;
  }
  rows(step: number, unit: "base" | "quote", now: number): ReadonlyMap<number, DomExecutionRow> {
    if (this.error || !this.prices.size) return new Map();
    const result = new Map<number, DomExecutionRow>();
    for (const [price, row] of this.groupRows(step)) {
      const bought = unit === "base" ? row.bought : row.boughtQuote, sold = unit === "base" ? row.sold : row.soldQuote;
      const last = now >= row.latest.time && now - row.latest.time < 5000 ? row.latest.quantity * (unit === "base" ? 1 : row.latest.price) : null;
      if (![bought, sold, bought + sold, bought - sold].every(Number.isFinite)) throw new Error("Grouped DOM executions exceed supported precision.");
      result.set(price, { bought, sold, delta: bought - sold, volume: bought + sold, last, ...(last === null ? {} : { lastSide: row.latest.side }) });
    }
    return result;
  }
}
