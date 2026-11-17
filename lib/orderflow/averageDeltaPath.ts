import type { Tick } from "@/types/trading";
import { validTradeCount } from "@/lib/market/tradeCounts";

interface State { buy: number; sell: number; buys: number; sells: number; high: number; low: number; known: boolean }
const empty = (): State => ({ buy: 0, sell: 0, buys: 0, sells: 0, high: 0, low: 0, known: true });
const meanDelta = (s: State) => (s.buys ? s.buy / s.buys : 0) - (s.sells ? s.sell / s.sells : 0);
const order = (a: Tick, b: Tick) => a.time - b.time || (a.seq ?? Number.MAX_VALUE) - (b.seq ?? Number.MAX_VALUE) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function apply(state: State, tick: Tick) {
  if (tick.side === "buy") state.buy += tick.quantity; else state.sell += tick.quantity;
  if (validTradeCount(tick.tradeCount)) {
    if (tick.side === "buy") state.buys += tick.tradeCount; else state.sells += tick.tradeCount;
  } else state.known = false;
  if (![state.buys, state.sells, state.buys + state.sells].every(Number.isSafeInteger)) state.known = false;
  if (state.known) { const value = meanDelta(state); state.high = Math.max(state.high, value); state.low = Math.min(state.low, value); }
}
/** Means are non-additive. Keep the ordered suffix and seal only prefixes whose
 * duplicate IDs have expired. Wicks describe observed execution/aggregate
 * prefixes; constituent-print excursions inside aggregates cannot be inferred. */
export class AverageDeltaPath {
  private prefix = empty();
  private pending: Tick[] = [];
  private sorted = true;
  private floor = -Infinity;
  private cached?: ReturnType<AverageDeltaPath["calculate"]>;
  add(tick: Tick) {
    if (tick.time < this.floor) throw new Error("Average delta received an execution before its sealed timestamp.");
    this.pending.push({ ...tick }); this.sorted = false; this.cached = undefined;
  }
  private sort() { if (!this.sorted) { this.pending.sort(order); this.sorted = true; } }
  sealBefore(time: number) {
    this.sort(); let count = 0;
    while (count < this.pending.length && this.pending[count].time < time) apply(this.prefix, this.pending[count++]);
    if (count) { this.pending.splice(0, count); this.cached = undefined; }
    this.floor = Math.max(this.floor, time);
  }
  private calculate() {
    this.sort(); const state = { ...this.prefix };
    for (const tick of this.pending) apply(state, tick);
    const volume = state.buy + state.sell;
    if (!Number.isFinite(volume)) throw new Error("Average delta quantity exceeds supported precision.");
    return { total: state.known ? meanDelta(state) : NaN, high: state.known ? state.high : NaN,
      low: state.known ? state.low : NaN, volume, known: state.known };
  }
  read() { return this.cached ??= this.calculate(); }
}
