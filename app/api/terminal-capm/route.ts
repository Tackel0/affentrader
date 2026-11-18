import { isYahooTicker } from "@/lib/symbolId";
import { logError } from "@/lib/server/logger";
import { yahooChart } from "@/lib/server/yahoo";
import { adjustForDividends } from "@/lib/market/yahoo";
import { completedStockDays, STOCK_BASE_MARKETS } from "@/lib/screener/stockBase";
import { terminalCapm } from "@/lib/terminal/capm";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams, ticker = q.get("ticker")?.trim().toUpperCase() ?? "";
  const market = STOCK_BASE_MARKETS.find(m => m.id === (q.get("market") ?? "us")), rf = Number(q.get("rf") ?? 0);
  if (!isYahooTicker(ticker) || !market || !Number.isFinite(rf) || rf < -20 || rf > 50) return Response.json({ error: "Enter a Yahoo ticker, a supported benchmark and a rate from −20% to 50%." }, { status: 400 });
  try {
    const now = Date.now(), period2 = Math.floor(now / 60_000) * 60, deadline = AbortSignal.timeout(22_000);
    const fetcher: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline });
    const load = async (symbol: string) => {
      const data = await yahooChart({ ticker: symbol, interval: "1d", period1: period2 - 365 * 86400, period2, extended: false }, fetcher);
      if (!data.meta.timezone || data.meta.timezone === "UTC") throw new Error("Exchange timezone unavailable.");
      return { data, bars: completedStockDays(adjustForDividends(data.bars, data.adjClose), data.meta.timezone, now) };
    };
    const [asset, benchmark] = await Promise.all([load(ticker), load(market.benchmark)]);
    if (asset.data.meta.currency !== benchmark.data.meta.currency) return Response.json({ error: "Choose a benchmark in the same currency." }, { status: 422 });
    const stats = terminalCapm(asset.bars, benchmark.bars, rf / 100);
    if (!stats) return Response.json({ error: "At least 29 matching daily returns with nonzero variance are required." }, { status: 422 });
    return Response.json({ ticker, name: asset.data.meta.name, benchmark: market.benchmarkLabel, currency: asset.data.meta.currency, asOf: [asset.bars.at(-1)!.session, benchmark.bars.at(-1)!.session].sort()[0], riskFree: rf, ...stats });
  } catch (error) {
    logError("api.terminalCapm.error", error, { ticker });
    return Response.json({ error: "Yahoo Finance daily history is unavailable for this analysis." }, { status: 503 });
  }
}
