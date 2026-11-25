import type { OHLCV } from "@/types/trading";
import type { StrategyReport, StrategyTrade } from "@/types/strategy";
import { intervalMs, nextBucket } from "@/lib/market/intervals";

/** A finer interval to check fills against (at most a quarter of the bar). */
export function lowerInterval(timeframe: string): string | null {
  const ms = intervalMs(timeframe);
  if (ms >= 86_400_000) return "1h";
  if (ms >= 4 * 3_600_000) return "15m";
  if (ms >= 3_600_000) return "5m";
  if (ms >= 300_000) return "1m";
  if (ms >= 60_000) return "1s";
  return null;
}

export interface TradeAudit {
  tradeId: string;
  /** The entry price was traded inside the entry bar. */
  entryTouched: boolean;
  /** The exit price was traded inside the exit bar (closed trades). */
  exitTouched: boolean | null;
  /** First lower-interval time the entry price traded. */
  entryTime: number | null;
  exitTime: number | null;
  /** Best and worst unrealized move between the verified entry and exit, in price units. */
  favorable: number | null;
  adverse: number | null;
}

export interface AuditSummary {
  interval: string;
  audited: number;
  entriesVerified: number;
  exitsVerified: number;
  /** Trades whose entry or exit price never traded in its bar at this resolution. */
  unverified: string[];
  results: TradeAudit[];
}

export type LowerLoader = (from: number, to: number) => Promise<OHLCV[]>;

function firstTouch(bars: readonly OHLCV[], price: number): OHLCV | undefined {
  return bars.find((b) => b.low <= price + 1e-9 && b.high >= price - 1e-9);
}

/**
 * Re-examine every closed trade at a finer resolution: confirm the entry and
 * exit prices really traded inside their bars and measure the move between
 * them without the bar-level assumptions. It does not change the report.
 */
export async function auditTrades(
  report: StrategyReport,
  load: LowerLoader,
  options: { limit?: number } = {},
): Promise<AuditSummary> {
  const interval = lowerInterval(report.market.timeframe);
  if (!interval) throw new Error("This interval is already the finest available.");
  const barEnd = (start: number) => nextBucket(report.market.timeframe, start);
  const trades: StrategyTrade[] = report.trades.filter((t) => !t.open).slice(-(options.limit ?? 150));
  const results = new Array<TradeAudit>(trades.length);
  let next = 0;
  const worker = async () => {
    while (next < trades.length) {
      const index = next++;
      results[index] = await audit(trades[index]);
    }
  };
  async function audit(t: StrategyTrade): Promise<TradeAudit> {
    const entryEnd = barEnd(t.entryTime);
    const exitBarStart = t.exitTime ?? t.entryTime;
    const exitEnd = barEnd(exitBarStart);
    const lower = await load(t.entryTime, exitEnd);
    const inEntryBar = lower.filter((b) => b.time >= t.entryTime && b.time < entryEnd);
    const entry = firstTouch(inEntryBar, t.entryPrice);
    const exitMinTime = entry ? Math.max(exitBarStart, entry.time) : exitBarStart;
    const inExitBar = lower.filter((b) => b.time >= exitMinTime && b.time < exitEnd);
    const exit = t.exitPrice === null ? undefined : firstTouch(inExitBar, t.exitPrice);
    let favorable: number | null = null;
    let adverse: number | null = null;
    if (entry) {
      const path = lower.filter(
        (b) => b.time >= entry.time && (exit ? b.time <= exit.time : true),
      );
      if (path.length) {
        const high = Math.max(...path.map((b) => b.high));
        const low = Math.min(...path.map((b) => b.low));
        favorable = t.side === "long" ? high - t.entryPrice : t.entryPrice - low;
        adverse = t.side === "long" ? t.entryPrice - low : high - t.entryPrice;
      }
    }
    return {
      tradeId: t.id,
      entryTouched: Boolean(entry),
      exitTouched: t.exitPrice === null ? null : Boolean(exit),
      entryTime: entry?.time ?? null,
      exitTime: exit?.time ?? null,
      favorable,
      adverse,
    };
  }
  // Candles for different trades are independent, so several load at once.
  await Promise.all(Array.from({ length: Math.min(6, trades.length) }, worker));
  return {
    interval,
    audited: results.length,
    entriesVerified: results.filter((r) => r.entryTouched).length,
    exitsVerified: results.filter((r) => r.exitTouched).length,
    unverified: results.filter((r) => !r.entryTouched || r.exitTouched === false).map((r) => r.tradeId),
    results,
  };
}
