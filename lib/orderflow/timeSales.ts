import type { Tick, TimeSalesFilters, TimeSalesSnapshot } from "@/types/trading";
import { providerOf } from "@/lib/symbolId";
import { ArchiveQuantities } from "./archiveQuantities";
import { canonicalDecimal } from "./priceGrid";
import { validTradeCount } from "@/lib/market/tradeCounts";
import { validDomHighlight, type DomHighlight } from "./domLargeOrders";

/** The tape is newest first. A recorded book only has context from earlier executions. */
export function bookLastTrade(trades: readonly Readonly<Tick>[], before = Infinity) {
  const index = trades.findIndex(trade => trade.time < before);
  if (index < 0) return undefined;
  const trade = trades[index], previous = trades[index + 1];
  return { price: trade.price, direction: previous ? Math.sign(trade.price - previous.price) : null };
}

export function countNewRetainedTrades(frozen: TimeSalesSnapshot, current: TimeSalesSnapshot): number {
  const frozenIds = new Set(frozen.trades.map(trade => trade.id));
  return current.trades.reduce((count, trade) => count + Number(!frozenIds.has(trade.id)), 0);
}

export function timeSalesHighlight(trades: readonly Readonly<Tick>[], settings: DomHighlight) {
  if (!validDomHighlight(settings)) return null;
  let large: number;
  if (settings.mode === "fixed") large = settings.value;
  else {
    if (trades.length < 30) return null;
    large = trades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0) / trades.length * settings.multiplier;
  }
  return Number.isFinite(large) && large > 0 ? { large, block: 5 * large } : null;
}
const LIMIT = 5000;
const immutableTapeRows = new WeakMap<Readonly<Tick>, Readonly<Tick> | null>();

function tapeRow(trade: Readonly<Tick>): Readonly<Tick> | null {
  const cached = immutableTapeRows.get(trade);
  if (cached !== undefined) return cached;
  const valid = typeof trade.id === "string" && !!trade.id && Number.isSafeInteger(trade.time) &&
    Math.abs(trade.time) < 8640000000000000 && Number.isFinite(trade.price) && trade.price > 0 &&
    Number.isFinite(trade.quantity) && trade.quantity > 0 && (trade.side === "buy" || trade.side === "sell");
  const row = valid ? Object.freeze({ id: trade.id, symbol: trade.symbol, time: trade.time, price: trade.price,
    quantity: trade.quantity, side: trade.side, simulated: trade.simulated,
    ...(Number.isSafeInteger(trade.seq) ? { seq: trade.seq } : {}),
    ...(validTradeCount(trade.tradeCount) ? { tradeCount: trade.tradeCount } : {}) }) : null;
  if (Object.isFrozen(trade)) immutableTapeRows.set(trade, row);
  return row;
}

function newestFirst(a: Readonly<Tick>, b: Readonly<Tick>) {
  return b.time - a.time || (b.seq ?? -Number.MAX_VALUE) - (a.seq ?? -Number.MAX_VALUE) ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

export function validTapeFilters(filters: TimeSalesFilters): boolean {
  return ["all", "buy", "sell"].includes(filters.side) && ["quantity", "price-times-quantity"].includes(filters.unit) && Number.isFinite(filters.minimum) && filters.minimum >= 0 &&
    (filters.maximumValue === undefined || Number.isFinite(filters.maximumValue) && filters.maximumValue >= 0 &&
      (filters.maximumValue === 0 || filters.unit !== "price-times-quantity" || filters.maximumValue >= filters.minimum));
}
/** A frozen copy of this market/source's bounded rolling tape, never a full session. */
export function captureTimeSales(trades: readonly Tick[], context: { symbol: string; simulated: boolean; replay: boolean }, capturedAt = Date.now()): TimeSalesSnapshot {
  if (!Number.isSafeInteger(capturedAt) || Math.abs(capturedAt) >= 8640000000000000) throw new Error("Invalid tape capture time.");
  if (context.replay) return Object.freeze({ symbol: context.symbol, simulated: context.simulated, capturedAt, trades: Object.freeze([]), rejected: 0 });
  if (trades.length > LIMIT) throw new Error("Time & sales exceeds the 5,000-observation rolling buffer.");
  if (!context.simulated && !["binance", "hyperliquid", "kraken"].includes(providerOf(context.symbol)))
    return Object.freeze({ symbol: context.symbol, simulated: false, capturedAt, trades: Object.freeze([]), rejected: trades.length });
  const ids = new Set<string>(), accepted: Readonly<Tick>[] = [];
  let rejected = 0, ordered = true, previous: Readonly<Tick> | undefined;
  for (const trade of trades) {
    if (trade.symbol !== context.symbol || trade.simulated !== context.simulated || ids.has(trade.id) || trade.time > capturedAt + 1000) {
      rejected++;
      continue;
    }
    const row = tapeRow(trade);
    if (!row) { rejected++; continue; }
    if (ordered && previous && newestFirst(previous, row) > 0) ordered = false;
    previous = row;
    ids.add(row.id);
    accepted.push(row);
  }
  if (!ordered) accepted.sort(newestFirst);
  return Object.freeze({ symbol: context.symbol, simulated: context.simulated, capturedAt, trades: Object.freeze(accepted), rejected });
}
/** Explicit archived input only. This entry point never accepts a live fallback. */
export function captureRecordedTimeSales(input: { trades: readonly Tick[]; through: number; label: string }, symbol: string, capturedAt = Date.now()): TimeSalesSnapshot {
  if (!Number.isSafeInteger(capturedAt) || Math.abs(capturedAt) >= 8640000000000000 || !Number.isSafeInteger(input.through) || input.through < 0 || input.through >= 8640000000000000)
    throw new Error("The completed Replay boundary is unavailable.");
  if (!["binance", "hyperliquid", "kraken"].includes(providerOf(symbol))) throw new Error("Recorded tape requires a classified exchange source.");
  if (input.trades.length > 100000) throw new Error("Recorded tape exceeds the 100,000-execution archive limit. Choose a shorter archive selection.");
  const ids = new Set<string>(), accepted: Readonly<Tick>[] = [];
  for (const trade of input.trades) {
    const row = tapeRow(trade);
    if (!row || row.symbol !== symbol || row.simulated !== false || ids.has(row.id) ||
      row.time < 0 || row.time >= input.through || row.time > capturedAt + 1000)
      throw new Error("Recorded tape contains an invalid, duplicate, mixed-source or unrevealed execution.");
    ids.add(row.id);
    accepted.push(row);
  }
  accepted.sort(newestFirst);
  return Object.freeze({ symbol, simulated: false, capturedAt, trades: Object.freeze(accepted), rejected: 0, replayThrough: input.through, coverage: input.label });
}
export function filterTimeSales(snapshot: TimeSalesSnapshot, filters: TimeSalesFilters) {
  if (!validTapeFilters(filters)) throw new Error("Choose valid nonnegative trade size limits.");
  const minimum = filters.unit === "price-times-quantity" && filters.minimum > 0 ? canonicalDecimal(filters.minimum) : null;
  const maximum = filters.maximumValue ? canonicalDecimal(filters.maximumValue) : null;
  return snapshot.trades.filter(trade => {
    if (filters.side !== "all" && trade.side !== filters.side || filters.unit === "quantity" && trade.quantity < filters.minimum) return false;
    if (!minimum && !maximum) return true;
    const price = canonicalDecimal(trade.price), quantity = canonicalDecimal(trade.quantity);
    const coefficient = price.coefficient * quantity.coefficient, exponent = price.exponent + quantity.exponent;
    const compare = (bound: ReturnType<typeof canonicalDecimal>) => {
      const scale = Math.min(exponent, bound.exponent);
      return coefficient * 10n ** BigInt(exponent - scale) - bound.coefficient * 10n ** BigInt(bound.exponent - scale);
    };
    return (!minimum || compare(minimum) >= 0n) && (!maximum || compare(maximum) <= 0n);
  });
}
export function combineTapeRows(trades: readonly Readonly<Tick>[], included?: ReadonlySet<Readonly<Tick>>) {
  const rows: (Tick & { observations: number; earliest: number })[] = [];
  let adjacent = false;
  for (const trade of trades) {
    if (included && !included.has(trade)) {
      adjacent = false;
      continue;
    }
    const last = adjacent ? rows.at(-1) : undefined;
    adjacent = true;
    const maxGap = !trade.simulated && providerOf(trade.symbol) === "binance" ? 0 : 10;
    if (last && last.symbol === trade.symbol && last.simulated === trade.simulated && last.side === trade.side && last.price === trade.price && trade.time <= last.earliest && last.time - trade.time <= maxGap && Number.isFinite(last.quantity + trade.quantity)) {
      last.quantity += trade.quantity;
      last.observations++;
      last.earliest = trade.time;
      const count = validTradeCount(last.tradeCount) && validTradeCount(trade.tradeCount) ? last.tradeCount + trade.tradeCount : undefined;
      last.tradeCount = validTradeCount(count) ? count : undefined;
    } else rows.push({ ...trade, observations: 1, earliest: trade.time });
  }
  return rows;
}

export function timeSalesPage<T extends Readonly<Tick>>(trades: readonly T[], page: number) {
  if (!Number.isInteger(page) || page < 0) throw new Error("Invalid time & sales page.");
  const pages = Math.max(1, Math.ceil(trades.length / 100)), current = Math.min(page, pages - 1);
  return { page: current, pages, trades: trades.slice(current * 100, current * 100 + 100) };
}
export function timeSalesTotals(trades: readonly Readonly<Tick>[]) {
  const quantities = new ArchiveQuantities();
  let buys = 0;
  let buyValue = 0, sellValue = 0;
  for (const trade of trades) {
    quantities.add(trade);
    const value = trade.price * trade.quantity;
    if (trade.side === "buy") {
      buys++;
      buyValue += value;
    } else {
      sellValue += value;
    }
  }
  const volumes = quantities.read();
  const average = (value: number, quantity: string) => {
    const result = value / Number(quantity);
    return Number.isFinite(result) && result > 0 ? result : null;
  };
  return { ...volumes, buys, sells: trades.length - buys,
    buyAverage: average(buyValue, volumes.buyVolume), sellAverage: average(sellValue, volumes.sellVolume) };
}

/** Tape snapshots are sorted newest first. Anchor to the latest observed trade. */
export function timeSalesMinuteBalance(snapshot: TimeSalesSnapshot) {
  const through = snapshot.trades[0]?.time;
  if (through === undefined) return null;
  let buy = 0, sell = 0;
  for (const trade of snapshot.trades) {
    if (trade.time < through - 60_000) break;
    const value = trade.price * trade.quantity;
    if (trade.side === "buy") buy += value;
    else sell += value;
  }
  const total = buy + sell;
  return Number.isFinite(total) && total > 0 ? { through, buy, sell, buyShare: buy / total } : null;
}
export function timeSalesCsv(snapshot: TimeSalesSnapshot, filters: TimeSalesFilters): string {
  const rows = filterTimeSales(snapshot, filters);
  const cell = (value: string | number | boolean) => `"${String(value).replaceAll('"', '""')}"`;
  const prefix = [snapshot.symbol, new Date(snapshot.capturedAt).toISOString(), snapshot.simulated, filters.side, filters.minimum, filters.unit];
  const source = [snapshot.replayThrough !== undefined, snapshot.replayThrough === undefined ? "" : new Date(snapshot.replayThrough).toISOString(), snapshot.coverage ?? "Retained live observations only; missing history unknown"];
  return [["symbol", "captured_utc", "simulated", "side_filter", "minimum_size", "size_unit", "id", "execution_utc", "price", "quantity", "aggressor", "sequence", "recorded_replay", "replay_before_utc", "source_coverage", "maximum_trade_value", "underlying_trade_count"].map(cell).join(","),
    ...rows.map(trade => [...prefix, trade.id, new Date(trade.time).toISOString(), trade.price, trade.quantity, trade.side, trade.seq ?? "", ...source, filters.maximumValue || "", validTradeCount(trade.tradeCount) ? trade.tradeCount : ""].map(cell).join(","))].join("\r\n");
}
