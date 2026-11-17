import type { OrderBook } from "@/types/trading";
import { canonicalDecimal, executionPriceGrid } from "./priceGrid";
export interface LadderRow { price: number; bid: number; ask: number; omittedAbove?: string }
const MAX_LEVELS = 1000, MAX_SPREAD_ROWS = 100;
type ObservedLevels = { readonly bids: readonly OrderBook["bids"][number][]; readonly asks: readonly OrderBook["asks"][number][] };
export function validateDepthLevels(book: ObservedLevels) {
  if (book.bids.length > MAX_LEVELS || book.asks.length > MAX_LEVELS) throw new Error("Depth snapshot exceeds 1,000 levels per side.");
  for (const [levels, bid] of [[book.bids, true], [book.asks, false]] as const)
    if (!levels.every((level, i) => Number.isFinite(level.price) && level.price > 0 && Number.isFinite(level.quantity) && level.quantity > 0 && (!i || (bid ? level.price < levels[i - 1].price : level.price > levels[i - 1].price)))) throw new Error("Depth snapshot has invalid or unordered levels.");
}
function validate(book: ObservedLevels) {
  validateDepthLevels(book);
  if (book.bids.length && book.asks.length && book.bids[0].price >= book.asks[0].price) throw new Error("Depth snapshot is crossed or locked.");
}
export { validate as validateDepthBook };
/** Observed spacing is not verified exchange tick-size metadata. */
export function bookTick(book: ObservedLevels): number {
  validate(book);
  const prices = [...book.bids, ...book.asks].map(level => canonicalDecimal(level.price)); if (prices.length < 2) return .01;
  const exponent = Math.min(...prices.map(value => value.exponent));
  const values = prices.map(value => value.coefficient * 10n ** BigInt(value.exponent - exponent)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  let spacing: bigint | undefined;
  for (let i = 1; i < values.length; i++) { const gap = values[i] - values[i - 1]; if (gap > 0n && (spacing === undefined || gap < spacing)) spacing = gap; }
  return spacing === undefined ? .01 : Number(`${spacing}e${exponent}`);
}
type LadderSide = "bid" | "ask" | "nearest";
export function ladderGrid(step: number) {
  const grid = executionPriceGrid(step), unit = canonicalDecimal(step);
  const index = (price: number, side: LadderSide = "nearest"): number => {
    if (!Number.isFinite(price) || price <= 0) throw new Error("A ladder price must be positive and finite.");
    const lower = grid.index(price);
    if (side === "bid") return lower;
    const value = canonicalDecimal(price), exponent = Math.min(value.exponent, unit.exponent);
    const numerator = value.coefficient * 10n ** BigInt(value.exponent - exponent);
    const denominator = unit.coefficient * 10n ** BigInt(unit.exponent - exponent);
    if (side === "ask") return numerator % denominator === 0n ? lower : lower + 1;
    const midpoint = (2n * BigInt(lower) + 1n) * denominator;
    return 2n * numerator >= midpoint ? lower + 1 : lower;
  };
  return { index, row: grid.row, price: (price: number, side?: LadderSide) => grid.row(index(price, side)).lower };
}
export function ladderIndex(price: number, step: number, side?: LadderSide) { return ladderGrid(step).index(price, side); }
export function ladderPrice(price: number, step: number, side?: LadderSide) { return ladderGrid(step).price(price, side); }
export function groupedLadderStep(spacing: number, group: number) {
  if (!Number.isInteger(group) || group < 1 || group > 100) throw new Error("Choose a grouping multiplier from 1 to 100.");
  const unit = canonicalDecimal(spacing), value = Number(`${unit.coefficient * BigInt(group)}e${unit.exponent}`);
  if (!Number.isFinite(value) || value <= 0) throw new Error("The grouped price spacing is unavailable."); return value;
}
/** Floor bids and ceil asks exactly. Compress a wide spread instead of allocating
 * its potentially billions of empty rows; omitted prices carry an explicit marker. */
export function buildLadder(book: OrderBook, step: number, levels: number): LadderRow[] {
  if (!Number.isInteger(levels) || levels < 1 || levels > 100) throw new Error("Choose 1–100 ladder rows per side.");
  const grid = ladderGrid(step); validate(book); if (!book.bids.length || !book.asks.length) return [];
  const exponent = Math.min(...[...book.bids, ...book.asks].map(level => canonicalDecimal(level.quantity).exponent));
  const collect = (input: OrderBook["bids"], side: "bid" | "ask") => {
    const rows = new Map<number, bigint>();
    for (const level of input) { const index = grid.index(level.price, side), quantity = canonicalDecimal(level.quantity); rows.set(index, (rows.get(index) ?? 0n) + quantity.coefficient * 10n ** BigInt(quantity.exponent - exponent)); }
    return rows;
  };
  const bids = collect(book.bids, "bid"), asks = collect(book.asks, "ask"), bid = Math.max(...bids.keys()), ask = Math.min(...asks.keys());
  if (bid <= 0) throw new Error("This grouping produces a nonpositive bid price. Reduce the grouping multiplier.");
  const gap = BigInt(ask) - BigInt(bid) - 1n, compressed = gap > BigInt(MAX_SPREAD_ROWS);
  const indices: number[] = [];
  for (let i = levels - 1; i >= 0; i--) indices.push(ask + i);
  if (!compressed) for (let i = ask - 1; i > bid; i--) indices.push(i);
  for (let i = 0; i < levels; i++) indices.push(bid - i);
  const quantity = (value: bigint | undefined) => { const result = value === undefined ? 0 : Number(`${value}e${exponent}`); if (!Number.isFinite(result)) throw new Error("Grouped depth quantity exceeds supported precision."); return result; };
  return indices.map(index => ({ price: grid.row(index).lower, bid: quantity(bids.get(index)), ask: quantity(asks.get(index)), ...(compressed && index === bid ? { omittedAbove: String(gap) } : {}) })).filter(row => row.price > 0);
}
export function depthTimestampStatus(time: number, now: number): string | null {
  return !Number.isSafeInteger(time) || !Number.isFinite(now) || now - time > 5000 || time > now + 1000
    ? "Order book is stale or its timestamp is invalid. Waiting for fresh depth." : null;
}

export function depthBookStatus(book: OrderBook | null, context: { symbol: string; replay: boolean; simulation: boolean; now: number }): string | null {
  if (context.replay) return "Replay depth unavailable: no recorded order-book snapshots. Live depth is excluded.";
  if (context.simulation) return "Simulation supplies no real order book.";
  if (!book || book.symbol !== context.symbol || book.simulated) return "Waiting for matching live level-2 depth. This source may supply no order book.";
  const timing = depthTimestampStatus(book.time, context.now);
  if (timing) return timing;
  try { validate(book); } catch (error) { return error instanceof Error ? error.message : "Invalid order book."; }
  return book.bids.length && book.asks.length ? null : "Waiting for both sides of the order book.";
}

/** Stable contiguous viewport, independent of which levels currently have orders.
 * A wide spread never expands the allocation; quantities are observed levels only. */
export function centeredLadder(book:OrderBook, step:number, center:number, halfRows:number,count=2*halfRows+1):LadderRow[] {
  if (!Number.isSafeInteger(center) || center < 1 || !Number.isInteger(halfRows) || halfRows < 0 || halfRows > 50 || !Number.isSafeInteger(center+halfRows) || !Number.isInteger(count) || count<1 || count>101 || Math.floor(count/2)!==halfRows) throw new Error("Invalid DOM viewport.");
  validate(book); const grid=ladderGrid(step);
  if (!book.bids.length || !book.asks.length) return [];
  const exponent=Math.min(...[...book.bids,...book.asks].map(level=>canonicalDecimal(level.quantity).exponent));
  const collect=(levels:OrderBook["bids"], side:"bid"|"ask") => {
    const output=new Map<number,bigint>();
    for(const level of levels){const index=grid.index(level.price,side), q=canonicalDecimal(level.quantity);output.set(index,(output.get(index)??0n)+q.coefficient*10n**BigInt(q.exponent-exponent));}
    return output;
  };
  const bids=collect(book.bids,"bid"),asks=collect(book.asks,"ask");
  const quantity=(value:bigint|undefined)=>{const n=value===undefined?0:Number(`${value}e${exponent}`);if(!Number.isFinite(n))throw new Error("Grouped DOM quantity exceeds supported precision.");return n;};
  return Array.from({length:count},(_,i)=>center+halfRows-i).filter(index=>index>0)
    .map(index=>({price:grid.row(index).lower,bid:quantity(bids.get(index)),ask:quantity(asks.get(index))}));
}
