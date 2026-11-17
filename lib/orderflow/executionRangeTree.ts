import type { Tick } from "@/types/trading";
import type { EstimatedProfile } from "./fixedProfileModel";
import { canonicalDecimal } from "./priceGrid";
import { rangePriceGrid } from "./rangePriceGrid";
import { priceStep } from "./math";
import { volumeValueArea } from "./volumeProfileModel";
/** Price-indexed prefix sums. Future prices reserve empty tree slots only; the
 * grid uses active extrema and canonical decimal sums make prefix results causal
 * even when a future quantity changes the common decimal exponent. */
export class ExecutionRangeTree {
  private prices: number[]; private indices: Map<number, number>; private size = 1;
  private buy: bigint[]; private sell: bigint[]; private exponent: number;
  private min = Infinity; private max = -Infinity; private revision = 0;
  private cached?: { key: string; profile: EstimatedProfile };
  constructor(trades: readonly Tick[]) {
    this.prices = [...new Set(trades.map(tick => tick.price))].sort((a, b) => a - b);
    this.indices = new Map(this.prices.map((price, index) => [price, index]));
    while (this.size < this.prices.length) this.size *= 2;
    this.buy = Array<bigint>(this.size * 2).fill(0n); this.sell = Array<bigint>(this.size * 2).fill(0n);
    this.exponent = trades.reduce((min, tick) => Math.min(min, canonicalDecimal(tick.quantity).exponent), 0);
  }
  private number(value: bigint) { const result = Number(`${value}e${this.exponent}`); if (!Number.isFinite(result)) throw new Error("Execution range quantity exceeds supported precision."); return result; }
  add(tick: Tick) {
    const index = this.indices.get(tick.price); if (index === undefined) throw new Error("Execution price is missing from the range snapshot.");
    const decimal = canonicalDecimal(tick.quantity), amount = decimal.coefficient * 10n ** BigInt(decimal.exponent - this.exponent);
    const target = tick.side === "buy" ? this.buy : this.sell;
    let node = this.size + index; target[node] += amount;
    while (node > 1) { node = Math.floor(node / 2); target[node] = target[node * 2] + target[node * 2 + 1]; }
    this.min = Math.min(this.min, tick.price); this.max = Math.max(this.max, tick.price); this.revision++;
  }
  get totals() { return { buys: this.number(this.buy[1]), sells: this.number(this.sell[1]), total: this.number(this.buy[1] + this.sell[1]), delta: this.number(this.buy[1] - this.sell[1]) }; }
  profile(rows: number, percent: number): EstimatedProfile | null {
    if (!this.revision) return null;
    const key = `${this.revision}:${rows}:${percent}`; if (this.cached?.key === key) return this.cached.profile;
    let min = this.min, max = this.max; const n = min === max ? 1 : rows;
    if (min === max) { const half = priceStep(min) / 2; min -= half; max += half; }
    const grid = rangePriceGrid(min, max, n), buys = Array<bigint>(n).fill(0n), sells = Array<bigint>(n).fill(0n);
    const row = (index: number) => { const price = this.prices[Math.min(index, this.prices.length - 1)]; return grid.allocation(price, price).first; };
    const visit = (node: number, low: number, high: number) => {
      if (this.buy[node] === 0n && this.sell[node] === 0n) return;
      const first = row(low), last = row(high);
      if (first === last) { buys[first] += this.buy[node]; sells[first] += this.sell[node]; return; }
      const middle = Math.floor((low + high) / 2); visit(node * 2, low, middle); visit(node * 2 + 1, middle + 1, high);
    };
    visit(1, 0, this.size - 1);
    const output = grid.edges.slice(0, -1).map((price, index) => ({ price, up: this.number(buys[index]), down: this.number(sells[index]) }));
    const area = volumeValueArea(output.map(row => ({ price: row.price, buy: row.up, sell: row.down, total: row.up + row.down })), Math.max(1, percent));
    if (!area || Math.abs(area.total - this.totals.total) > this.totals.total * 1e-10) throw new Error("Execution range profile lost supported quantity precision.");
    const profile = { rows: output, rowH: (max - min) / n, min, edges: grid.edges, centers: grid.centers, maxTotal: output[area.poc].up + output[area.poc].down,
      poc: area.poc, vaFrom: percent === 0 ? area.poc : area.low, vaTo: percent === 0 ? area.poc : area.high };
    this.cached = { key, profile }; return profile;
  }
}
