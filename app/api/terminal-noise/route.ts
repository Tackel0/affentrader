import { isYahooTicker } from "@/lib/symbolId";
import { logError } from "@/lib/server/logger";
import { yahooChart } from "@/lib/server/yahoo";
import { adjustForDividends, type YahooChart } from "@/lib/market/yahoo";
import { buildNoiseDataset, type NoiseApiPayload, type NoiseDayBar } from "@/lib/terminal/noiseMeter";
import type { OHLCV } from "@/types/trading";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function formatSessionDate(ms: number, timezone: string): string {
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

function normalizeNoiseDailyBars(
  bars: readonly OHLCV[],
  timezone: string,
  now: number,
): { completed: NoiseDayBar[]; todayBar: NoiseDayBar | null } {
  const todaySession = formatSessionDate(now, timezone);
  const bySession = new Map<string, NoiseDayBar>();
  let todayBar: NoiseDayBar | null = null;

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
    if (session >= todaySession) {
      if (session === todaySession) todayBar = clean;
      continue;
    }
    bySession.set(session, clean);
  }

  const completed = [...bySession.values()].sort((a, b) => a.session.localeCompare(b.session));
  return { completed, todayBar };
}

function resolveLiveQuote(
  daily: YahooChart,
  intraday: YahooChart | null,
  completed: readonly NoiseDayBar[],
  todayBar: NoiseDayBar | null,
  now: number,
): {
  prevClose: number;
  lastPrice: number;
  liveGapPct: number;
  priceSource: "premarket" | "afterhours" | "regular" | "last-close";
} {
  const lastCompleted = completed.at(-1);
  const prevClose = lastCompleted?.close ?? (Number.isFinite(daily.meta.previousClose) ? daily.meta.previousClose : daily.meta.price);
  if (!(prevClose > 0)) {
    return { prevClose: 0, lastPrice: 0, liveGapPct: 0, priceSource: "last-close" };
  }

  const sessions = intraday?.meta.sessions ?? daily.meta.sessions;
  const inTupleWindow = (list?: ReadonlyArray<readonly [number, number]>, t = now) =>
    Boolean(list?.some(([start, end]) => t >= start && t <= end));

  const latestIntraday = intraday?.bars.at(-1);
  if (latestIntraday && Number.isFinite(latestIntraday.close) && latestIntraday.close > 0) {
    const barTime = latestIntraday.time;
    const matchedExtended = sessions?.extended.find(([start, end]) => barTime >= start && barTime <= end);
    const matchingRegular = matchedExtended
      ? sessions?.regular.find(([rStart, rEnd]) => rStart >= matchedExtended[0] && rEnd <= matchedExtended[1])
      : undefined;

    if (matchedExtended && matchingRegular && barTime < matchingRegular[0]) {
      return {
        prevClose: roundPrice(prevClose),
        lastPrice: roundPrice(latestIntraday.close),
        liveGapPct: Math.round(((latestIntraday.close - prevClose) / prevClose) * 10000) / 100,
        priceSource: "premarket",
      };
    }
    if (matchedExtended && matchingRegular && barTime >= matchingRegular[1]) {
      const anchor = todayBar?.close ?? prevClose;
      return {
        prevClose: roundPrice(anchor),
        lastPrice: roundPrice(latestIntraday.close),
        liveGapPct: Math.round(((latestIntraday.close - anchor) / anchor) * 10000) / 100,
        priceSource: "afterhours",
      };
    }
  }

  if (todayBar && todayBar.open > 0) {
    return {
      prevClose: roundPrice(prevClose),
      lastPrice: roundPrice(todayBar.open),
      liveGapPct: Math.round(((todayBar.open - prevClose) / prevClose) * 10000) / 100,
      priceSource: "regular",
    };
  }

  if (
    latestIntraday &&
    Number.isFinite(latestIntraday.close) &&
    latestIntraday.close > 0 &&
    Math.abs(latestIntraday.close - prevClose) / prevClose > 0.0002
  ) {
    return {
      prevClose: roundPrice(prevClose),
      lastPrice: roundPrice(latestIntraday.close),
      liveGapPct: Math.round(((latestIntraday.close - prevClose) / prevClose) * 10000) / 100,
      priceSource: inTupleWindow(sessions?.regular, latestIntraday.time) ? "regular" : "premarket",
    };
  }

  return {
    prevClose: roundPrice(prevClose),
    lastPrice: roundPrice(prevClose),
    liveGapPct: 0,
    priceSource: "last-close",
  };
}

function nextTradingWeekday(now: number, timezone: string): number {
  const iso = formatSessionDate(now, timezone);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) return 1;
  const d = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return 1; // Weekend -> Monday
  return wd;
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const rawTicker = (q.get("ticker") ?? "SPY").trim().toUpperCase().replace(/^YF:/, "");
  const yearsParam = Number(q.get("years") ?? 10);
  const years = Number.isFinite(yearsParam) ? Math.max(2, Math.min(15, Math.round(yearsParam))) : 10;

  if (!isYahooTicker(rawTicker)) {
    return Response.json(
      { error: "Bitte gib einen gültigen Yahoo-Ticker ein (z. B. SPY, QQQ, ^GSPC, ^NDX, ^GDAXI, NVDA)." },
      { status: 400 },
    );
  }

  try {
    const now = Date.now();
    const period2 = Math.floor(now / 60_000) * 60;
    const deadline = AbortSignal.timeout(22_000);
    const fetcher: typeof fetch = (input, init) =>
      fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline });

    const [daily, intraday] = await Promise.all([
      yahooChart(
        {
          ticker: rawTicker,
          interval: "1d",
          period1: period2 - years * 366 * 86400,
          period2,
          extended: false,
        },
        fetcher,
      ),
      yahooChart(
        {
          ticker: rawTicker,
          interval: "5m",
          period1: period2 - 5 * 86400,
          period2,
          extended: true,
        },
        fetcher,
      ).catch(() => null),
    ]);

    const timezone = daily.meta.timezone || "America/New_York";
    const adjusted = adjustForDividends(daily.bars, daily.adjClose);
    const { completed, todayBar } = normalizeNoiseDailyBars(adjusted, timezone, now);

    if (completed.length < 30) {
      return Response.json(
        { error: "Für diesen Ticker sind zu wenige historische Handelstage (< 30) verfügbar." },
        { status: 422 },
      );
    }

    const dataset = buildNoiseDataset(completed);
    const liveQuote = resolveLiveQuote(daily, intraday, completed, todayBar, now);

    const payload: NoiseApiPayload = {
      ticker: rawTicker,
      name: daily.meta.name || rawTicker,
      exchange: daily.meta.exchange || "",
      currency: daily.meta.currency || "USD",
      timezone,
      asOf: dataset.lastSession,
      years,
      totalDays: completed.length,
      live: {
        ...liveQuote,
        currentStreak: dataset.currentStreak,
        currentCandleStreak: dataset.currentCandleStreak,
        currentAtr14Pct: dataset.currentAtr14Pct,
        nextWeekday: nextTradingWeekday(now, timezone),
      },
      bars: completed,
    };

    return Response.json(payload, {
      headers: { "cache-control": "private, max-age=30" },
    });
  } catch (error) {
    logError("api.terminalNoise.error", error, { ticker: rawTicker, years });
    return Response.json(
      { error: "Historische Marktdaten von Yahoo Finance sind aktuell nicht verfügbar." },
      { status: 503 },
    );
  }
}
