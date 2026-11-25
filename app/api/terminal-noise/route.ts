import { isYahooTicker } from "@/lib/symbolId";
import { logError } from "@/lib/server/logger";
import { yahooChart } from "@/lib/server/yahoo";
import { adjustForDividends } from "@/lib/market/yahoo";
import { buildNoiseDataset, type NoiseApiPayload } from "@/lib/terminal/noiseMeter";
import {
  formatSessionDate,
  isTodayRegularClosed,
  nextTradingWeekday,
  normalizeNoiseDailyBars,
  resolveLiveQuote,
} from "@/lib/terminal/noiseSession";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const rawTicker = (q.get("ticker") ?? "SPY").trim().toUpperCase().replace(/^YF:/, "");
  const rawYears = (q.get("years") ?? "max").trim().toLowerCase();
  const isMax = rawYears === "max" || rawYears === "all";
  const yearsParam = Number(rawYears);
  const years = isMax
    ? 55
    : Number.isFinite(yearsParam)
      ? Math.max(2, Math.min(55, Math.round(yearsParam)))
      : 10;

  if (!isYahooTicker(rawTicker)) {
    return Response.json(
      { error: "Bitte gib einen gültigen Yahoo-Ticker ein (z. B. SPY, QQQ, ^GSPC, ^NDX, ^GDAXI, NVDA)." },
      { status: 400 },
    );
  }

  try {
    const now = Date.now();
    const period2 = Math.floor(now / 60_000) * 60;
    const period1 = Math.max(0, period2 - years * 365 * 86400);
    const deadline = request.signal
      ? AbortSignal.any([request.signal, AbortSignal.timeout(22_000)])
      : AbortSignal.timeout(22_000);
    const fetcher: typeof fetch = (input, init) =>
      fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline });

    const [daily, intraday] = await Promise.all([
      yahooChart(
        {
          ticker: rawTicker,
          interval: "1d",
          period1,
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
    const todaySession = formatSessionDate(now, timezone);
    const sessions = intraday?.meta.sessions ?? daily.meta.sessions;
    const regularClosed = isTodayRegularClosed(
      todaySession,
      timezone,
      sessions,
      intraday?.bars.at(-1)?.time,
      now,
    );

    const adjusted = adjustForDividends(daily.bars, daily.adjClose);
    const { completed, todayBar } = normalizeNoiseDailyBars(adjusted, timezone, now, {
      promoteToday: regularClosed,
    });

    if (completed.length < 30) {
      return Response.json(
        { error: "Für diesen Ticker sind zu wenige historische Handelstage (< 30) verfügbar." },
        { status: 422 },
      );
    }

    const dataset = buildNoiseDataset(completed);
    const liveQuote = resolveLiveQuote(daily, intraday, completed, todayBar, now, timezone);

    const payload: NoiseApiPayload = {
      ticker: rawTicker,
      name: daily.meta.name || rawTicker,
      exchange: daily.meta.exchange || "",
      currency: daily.meta.currency || "USD",
      timezone,
      asOf: dataset.lastSession,
      years,
      rangeMode: isMax ? "max" : "years",
      totalDays: completed.length,
      live: {
        ...liveQuote,
        currentStreak: dataset.currentStreak,
        currentCandleStreak: dataset.currentCandleStreak,
        currentAtr14Pct: dataset.currentAtr14Pct,
        currentRsi14: dataset.currentRsi14,
        currentDistEma20Pct: dataset.currentDistEma20Pct,
        currentAboveSma200: dataset.currentAboveSma200,
        nextWeekday: nextTradingWeekday(now, timezone, regularClosed),
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
