import type { MarketSessionWindows } from "@/lib/market/sessionWindows";
import type { YahooChart } from "@/lib/market/yahoo";
import type { NoiseDayBar } from "@/lib/terminal/noiseMeter";
import type { OHLCV } from "@/types/trading";

export function formatSessionDate(ms: number, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(ms);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* fallback to UTC */
  }
  return new Date(ms).toISOString().slice(0, 10);
}

function roundPrice(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/**
 * Determines whether today's regular exchange session has already closed, based on
 * Yahoo's source-resolved trading-period windows (`sessions.regular`).
 * Never guesses closing times when session metadata is absent.
 */
export function isTodayRegularClosed(
  todaySession: string,
  timezone: string,
  sessions: MarketSessionWindows | undefined,
  latestIntradayTime: number | undefined,
  now: number,
): boolean {
  const todayRegular = sessions?.regular.find(
    ([start, end]) =>
      formatSessionDate(start, timezone) === todaySession ||
      formatSessionDate(end - 1, timezone) === todaySession,
  );
  if (!todayRegular) return false;
  if (now >= todayRegular[1]) return true;
  if (typeof latestIntradayTime === "number" && Number.isFinite(latestIntradayTime) && latestIntradayTime >= todayRegular[1]) {
    return true;
  }
  return false;
}

/**
 * Normalizes daily OHLCV bars into chronological completed sessions plus an optional
 * in-progress `todayBar`. When `promoteToday` is true (regular session has closed),
 * today's finalized daily bar is promoted into `completed` so streaks, patterns, and
 * after-hours anchors immediately reflect today's official regular close.
 */
export function normalizeNoiseDailyBars(
  bars: readonly OHLCV[],
  timezone: string,
  now: number,
  options?: { promoteToday?: boolean },
): { completed: NoiseDayBar[]; todayBar: NoiseDayBar | null; promotedToday: boolean } {
  const todaySession = formatSessionDate(now, timezone);
  const promoteToday = options?.promoteToday === true;
  const bySession = new Map<string, NoiseDayBar>();
  let todayBar: NoiseDayBar | null = null;
  let promotedToday = false;

  for (const bar of bars) {
    if (!Number.isFinite(bar.time) || bar.time <= 0) continue;
    if (![bar.open, bar.high, bar.low, bar.close].every((n) => Number.isFinite(n) && n > 0)) continue;
    const session = formatSessionDate(bar.time, timezone);
    const open = roundPrice(bar.open);
    const close = roundPrice(bar.close);
    const high = roundPrice(Math.max(bar.high, open, close));
    const low = roundPrice(Math.min(bar.low, open, close));
    const volume = Number.isFinite(bar.volume) && bar.volume >= 0 ? Math.round(bar.volume) : 0;
    const clean: NoiseDayBar = { session, open, high, low, close, volume };
    if (session > todaySession) continue;
    if (session === todaySession) {
      if (promoteToday) {
        bySession.set(session, clean);
        promotedToday = true;
      } else {
        todayBar = clean;
      }
      continue;
    }
    bySession.set(session, clean);
  }

  const completed = [...bySession.values()].sort((a, b) => a.session.localeCompare(b.session));
  return { completed, todayBar, promotedToday };
}

export function resolveLiveQuote(
  daily: YahooChart,
  intraday: YahooChart | null,
  completed: readonly NoiseDayBar[],
  todayBar: NoiseDayBar | null,
  now: number,
  timezone = daily.meta.timezone || "America/New_York",
): {
  prevClose: number;
  lastPrice: number;
  liveGapPct: number;
  liveTodayReturnPct: number;
  priceSource: "premarket" | "afterhours" | "regular" | "last-close";
} {
  const lastCompleted = completed.at(-1);
  const lastCompletedSession = lastCompleted?.session ?? "";
  const prevClose =
    lastCompleted?.close ??
    (Number.isFinite(daily.meta.previousClose) ? daily.meta.previousClose : daily.meta.price);
  if (!(prevClose > 0)) {
    return { prevClose: 0, lastPrice: 0, liveGapPct: 0, liveTodayReturnPct: 0, priceSource: "last-close" };
  }

  const latestIntraday = intraday?.bars.at(-1);
  const computeTodayReturn = (fallbackGap: number): number => {
    if (todayBar && todayBar.close > 0) {
      return Math.round(((todayBar.close - prevClose) / prevClose) * 10000) / 100;
    }
    if (latestIntraday && Number.isFinite(latestIntraday.close) && latestIntraday.close > 0) {
      return Math.round(((latestIntraday.close - prevClose) / prevClose) * 10000) / 100;
    }
    return fallbackGap;
  };

  const sessions = intraday?.meta.sessions ?? daily.meta.sessions;
  const inTupleWindow = (list?: ReadonlyArray<readonly [number, number]>, t = now) =>
    Boolean(list?.some(([start, end]) => t >= start && t <= end));

  if (latestIntraday && Number.isFinite(latestIntraday.close) && latestIntraday.close > 0) {
    const barTime = latestIntraday.time;
    const barSession = formatSessionDate(barTime, timezone);
    const matchedExtended = sessions?.extended.find(([start, end]) => barTime >= start && barTime <= end);
    const matchingRegular = matchedExtended
      ? sessions?.regular.find(([rStart, rEnd]) => rStart >= matchedExtended[0] && rEnd <= matchedExtended[1])
      : undefined;

    if (
      matchedExtended &&
      matchingRegular &&
      barTime < matchingRegular[0] &&
      barSession > lastCompletedSession
    ) {
      const gap = Math.round(((latestIntraday.close - prevClose) / prevClose) * 10000) / 100;
      return {
        prevClose: roundPrice(prevClose),
        lastPrice: roundPrice(latestIntraday.close),
        liveGapPct: gap,
        liveTodayReturnPct: computeTodayReturn(gap),
        priceSource: "premarket",
      };
    }
    if (
      matchedExtended &&
      matchingRegular &&
      barTime >= matchingRegular[1] &&
      barSession >= lastCompletedSession
    ) {
      const anchor = todayBar?.close ?? prevClose;
      const gap = Math.round(((latestIntraday.close - anchor) / anchor) * 10000) / 100;
      return {
        prevClose: roundPrice(anchor),
        lastPrice: roundPrice(latestIntraday.close),
        liveGapPct: gap,
        liveTodayReturnPct: todayBar ? computeTodayReturn(gap) : gap,
        priceSource: "afterhours",
      };
    }
  }

  if (todayBar && todayBar.open > 0) {
    const gap = Math.round(((todayBar.open - prevClose) / prevClose) * 10000) / 100;
    return {
      prevClose: roundPrice(prevClose),
      lastPrice: roundPrice(todayBar.open),
      liveGapPct: gap,
      liveTodayReturnPct: computeTodayReturn(gap),
      priceSource: "regular",
    };
  }

  if (
    latestIntraday &&
    Number.isFinite(latestIntraday.close) &&
    latestIntraday.close > 0 &&
    formatSessionDate(latestIntraday.time, timezone) > lastCompletedSession &&
    Math.abs(latestIntraday.close - prevClose) / prevClose > 0.0002
  ) {
    const gap = Math.round(((latestIntraday.close - prevClose) / prevClose) * 10000) / 100;
    return {
      prevClose: roundPrice(prevClose),
      lastPrice: roundPrice(latestIntraday.close),
      liveGapPct: gap,
      liveTodayReturnPct: computeTodayReturn(gap),
      priceSource: inTupleWindow(sessions?.regular, latestIntraday.time) ? "regular" : "premarket",
    };
  }

  return {
    prevClose: roundPrice(prevClose),
    lastPrice: roundPrice(prevClose),
    liveGapPct: 0,
    liveTodayReturnPct: 0,
    priceSource: "last-close",
  };
}

export function nextTradingWeekday(now: number, timezone: string, regularClosed = false): number {
  const iso = formatSessionDate(now, timezone);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) return 1;
  const d = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return 1; // Weekend -> Monday
  if (regularClosed) return wd === 5 ? 1 : wd + 1;
  return wd;
}
