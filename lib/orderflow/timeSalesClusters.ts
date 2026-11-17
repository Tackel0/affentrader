import type { TimeSalesCluster, TimeSalesClusterInterval, TimeSalesFilters, TimeSalesSnapshot } from "@/types/trading";
import { ArchiveQuantities } from "./archiveQuantities";
import { filterTimeSales } from "./timeSales";
import { validTradeCount } from "@/lib/market/tradeCounts";

/** UTC time groups of already captured observations, never reconstructed orders. */
export function clusterTimeSales(snapshot: TimeSalesSnapshot, filters: TimeSalesFilters, interval: TimeSalesClusterInterval): readonly TimeSalesCluster[] {
  if (interval !== 1000 && interval !== 60000) throw new Error("Choose one-second or one-minute tape clusters.");
  if (snapshot.trades.length > 100000) throw new Error("Tape clusters exceed the 100,000-observation limit.");
  const groups = new Map<number, { quantities: ArchiveQuantities; first: number; last: number; count: number; buys: number; sells: number; low: number; high: number; value: number; underlying: number | null }>();
  for (const trade of filterTimeSales(snapshot, filters)) {
    const start = Math.floor(trade.time / interval) * interval;
    if (!Number.isSafeInteger(start) || Math.abs(start) >= 8640000000000000 || Math.abs(start + interval) > 8640000000000000)
      throw new Error("Tape cluster time is outside the supported UTC range.");
    let group = groups.get(start);
    if (!group) {
      group = { quantities: new ArchiveQuantities(), first: trade.time, last: trade.time, count: 0, buys: 0, sells: 0, low: trade.price, high: trade.price, value: 0, underlying: 0 };
      groups.set(start, group);
    }
    group.quantities.add(trade); group.count++;
    group.value += trade.price * trade.quantity;
    if (group.underlying !== null) {
      const sum = validTradeCount(trade.tradeCount) ? group.underlying + trade.tradeCount : null;
      group.underlying = validTradeCount(sum) ? sum : null;
    }
    if (trade.side === "buy") group.buys++; else group.sells++;
    group.first = Math.min(group.first, trade.time); group.last = Math.max(group.last, trade.time);
    group.low = Math.min(group.low, trade.price); group.high = Math.max(group.high, trade.price);
  }
  return Object.freeze([...groups].sort(([a], [b]) => b - a).map(([start, group]) => {
    const quantities = group.quantities.read();
    const weightedPrice = group.value / (Number(quantities.buyVolume) + Number(quantities.sellVolume));
    return Object.freeze({ start, end: start + interval, first: group.first, last: group.last, count: group.count, buys: group.buys, sells: group.sells,
      buyQuantity: quantities.buyVolume, sellQuantity: quantities.sellVolume, delta: quantities.delta, low: group.low, high: group.high,
      weightedPrice: Number.isFinite(weightedPrice) && weightedPrice > 0 ? weightedPrice : null, underlyingTradeCount: group.underlying });
  }));
}

export function timeSalesClusterPage(rows: readonly TimeSalesCluster[], page: number) {
  if (!Number.isInteger(page) || page < 0) throw new Error("Invalid tape cluster page.");
  const pages = Math.max(1, Math.ceil(rows.length / 100)), current = Math.min(page, pages - 1);
  return { page: current, pages, rows: rows.slice(current * 100, current * 100 + 100) };
}

export function timeSalesClustersCsv(snapshot: TimeSalesSnapshot, filters: TimeSalesFilters, interval: TimeSalesClusterInterval): string {
  const rows = clusterTimeSales(snapshot, filters, interval);
  const cell = (value: string | number | boolean) => `"${String(value).replaceAll('"', '""')}"`;
  const iso = (time: number) => new Date(time).toISOString();
  const prefix = [snapshot.symbol, iso(snapshot.capturedAt), snapshot.simulated, filters.side, filters.minimum, filters.unit, interval];
  const source = [snapshot.replayThrough !== undefined, snapshot.replayThrough === undefined ? "" : iso(snapshot.replayThrough), snapshot.coverage ?? "Retained live observations only; missing history unknown"];
  return [["symbol", "captured_utc", "simulated", "execution_side_filter", "execution_minimum_size", "execution_size_unit", "interval_ms", "window_start_utc", "window_end_utc", "first_execution_utc", "last_execution_utc", "execution_count", "buy_count", "sell_count", "buy_quantity", "sell_quantity", "delta", "low", "high", "recorded_replay", "replay_before_utc", "source_coverage", "maximum_trade_value", "weighted_price", "underlying_trade_count"].map(cell).join(","),
    ...rows.map(row => [...prefix, iso(row.start), iso(row.end), iso(row.first), iso(row.last), row.count, row.buys, row.sells, row.buyQuantity, row.sellQuantity, row.delta, row.low, row.high, ...source, filters.maximumValue || "", row.weightedPrice ?? "", row.underlyingTradeCount ?? ""].map(cell).join(","))].join("\r\n");
}
