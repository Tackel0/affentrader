import type { Tick, VolumeProfileRow } from "@/types/trading";
import { priceStep } from "./math";
import type { SessionWindow } from "./sessionCalendar";
import type { VolumeProfilePreferences } from "./volumeProfileSettings";
import { executionPriceGrid, type ExecutionPriceRow } from "./priceGrid";
import { profileTradingCalendar } from "./profileTradingHours";
import { bucketStart, nextBucket, parseInterval } from "@/lib/market/intervals";
import { findVolumeNodes, type VolumeNode } from "./volumeNodes";

export const MAX_PROFILE_ROWS = 2000, MAX_PROFILE_TRADES = 100000;
export interface VolumeValueArea { poc: number; low: number; high: number; volume: number; total: number }
export interface DevelopingProfilePoint { time: number; through: number; poc: number; val: number; vah: number; volume: number; executions: number }
export interface SessionVolumeProfile extends SessionWindow {
  rows: VolumeProfileRow[]; step: number; valueArea: VolumeValueArea;
  firstTrade: number; lastTrade: number; tradeCount: number;
  rowGrid?: readonly ExecutionPriceRow[];
  developing?: DevelopingProfilePoint[];
  nodes?: VolumeNode[];
}
export interface VolumeProfileModel {
  sessions: SessionVolumeProfile[]; source: "exchange" | "simulation"; discarded: number;
  retained: number; firstTrade: number | null; lastTrade: number | null;
}
/** TradingView's published adjacent-row rule: stop before exceeding the remaining target;
 * ties prefer the nearest row to POC, then the upper row. A POC alone can exceed the target. */
export function volumeValueArea(rows: readonly VolumeProfileRow[], percent: number): VolumeValueArea | null {
  const total = rows.reduce((sum, row) => sum + row.total, 0); if (!(total > 0) || !Number.isFinite(total)) return null;
  const maximum = Math.max(...rows.map(row => row.total)), center = (rows.length - 1) / 2;
  const poc = rows.reduce((best, row, index) => row.total === maximum &&
    (best < 0 || Math.abs(index - center) < Math.abs(best - center)) ? index : best, -1);
  let low = poc, high = poc, volume = rows[poc].total;
  const target = total * Math.max(1, Math.min(100, percent)) / 100;
  while (volume < target && (low > 0 || high < rows.length - 1)) {
    const below = low > 0 ? rows[low - 1].total : -1, above = high < rows.length - 1 ? rows[high + 1].total : -1;
    const upper = above > below || above === below && high + 1 - poc <= poc - (low - 1);
    const amount = upper ? above : below;
    if (volume + amount > target + Number.EPSILON * total * 8) break;
    if (upper) high++; else low--;
    volume += amount;
  }
  return { poc, low, high, volume, total };
}
function validTrade(trade: Tick) {
  return typeof trade.id === "string" && trade.id.length > 0 && Number.isFinite(trade.time) && Math.abs(trade.time) < 8640000000000000 &&
    Number.isFinite(trade.price) && trade.price > 0 && Number.isFinite(trade.quantity) && trade.quantity > 0 &&
    (trade.side === "buy" || trade.side === "sell") && typeof trade.simulated === "boolean";
}
export function buildSessionVolumeProfiles(trades: readonly Tick[], style: VolumeProfilePreferences, symbol: string,
  calendar = profileTradingCalendar(style, symbol), timeframe?: string): VolumeProfileModel {
  const developing = style.showDevelopingPoc || style.showDevelopingValueArea;
  if (developing && (!timeframe || !parseInterval(timeframe) || parseInterval(timeframe)!.unit === "T"))
    throw new Error("Developing session profiles require a time-based chart interval.");
  if (trades.length > MAX_PROFILE_TRADES) throw new Error("Volume profile exceeds 100,000 retained trades. Shorten the source window.");
  const eligible = trades.filter(validTrade).sort((a, b) => a.time - b.time);
  const simulated = eligible.at(-1)?.simulated ?? false, seen = new Set<string>();
  const selected = eligible.filter(trade => {
    if (trade.simulated !== simulated || seen.has(trade.id)) return false;
    seen.add(trade.id); return true;
  });
  const model: VolumeProfileModel = { sessions: [], source: simulated ? "simulation" : "exchange", discarded: trades.length - selected.length,
    retained: selected.length, firstTrade: selected[0]?.time ?? null, lastTrade: selected.at(-1)?.time ?? null };
  const groups = new Map<number, { window: SessionWindow; trades: Tick[] }>();
  for (const trade of selected) {
    const window = calendar.at(trade.time); if (!window) continue;
    let group = groups.get(window.start); if (!group) { group = { window, trades: [] }; groups.set(window.start, group); }
    group.trades.push(trade);
  }
  let totalRows = 0;
  for (const { window, trades: source } of groups.values()) {
    let low = Infinity, high = -Infinity;
    for (const trade of source) { low = Math.min(low, trade.price); high = Math.max(high, trade.price); }
    const base = priceStep(high), step = style.rowSize || executionPriceGrid(base).row(Math.max(1, Math.ceil((high - low) / style.rows / base))).lower;
    const grid = executionPriceGrid(step), first = grid.index(low), last = grid.index(high);
    const length = last - first + 1;
    if (length > MAX_PROFILE_ROWS || totalRows + length > 100000) throw new Error("Volume profile exceeds 2,000 rows per session or 100,000 loaded rows. Increase the row size.");
    const rowGrid = Array.from({ length }, (_, index) => grid.row(first + index));
    const rows: VolumeProfileRow[] = rowGrid.map(row => ({ price: row.lower, buy: 0, sell: 0, total: 0 }));
    const points: DevelopingProfilePoint[] | undefined = developing ? [] : undefined;
    for (let index = 0; index < source.length; index++) {
      const trade = source[index];
      const row = rows[grid.index(trade.price) - first]; row[trade.side] += trade.quantity; row.total += trade.quantity;
      if (!Number.isFinite(row.total)) throw new Error("Volume profile quantity exceeds supported precision.");
      // Like Vela, prefixes share the currently observed session grid. Later
      // extrema can rebin earlier points; no later execution volume enters them.
      if (points) {
        const time = bucketStart(timeframe!, trade.time);
        if (source[index + 1] && bucketStart(timeframe!, source[index + 1].time) === time) continue;
        const area = volumeValueArea(rows, style.valueAreaPercent);
        if (!area) throw new Error("Volume profile total exceeds supported precision.");
        points.push({ time: Math.max(window.start, time), through: Math.min(window.end, nextBucket(timeframe!, time)),
          poc: rowGrid[area.poc].center, val: rowGrid[area.low].lower, vah: rowGrid[area.high].upper,
          volume: area.total, executions: index + 1 });
      }
    }
    const valueArea = volumeValueArea(rows, style.valueAreaPercent);
    if (!valueArea) throw new Error("Volume profile total exceeds supported precision.");
    totalRows += rows.length;
    const nodes = findVolumeNodes(rows);
    model.sessions.push({ ...window, rows, rowGrid, step, valueArea, firstTrade: source[0].time, lastTrade: source.at(-1)!.time, tradeCount: source.length,
      ...(points ? { developing: points } : {}), ...(nodes.length ? { nodes } : {}) });
  }
  return model;
}
