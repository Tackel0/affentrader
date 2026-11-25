import { adjustForDividends } from "@/lib/market/yahoo";
import { exchangeOfTicker } from "@/lib/markets";
import { isYahooTicker } from "@/lib/symbolId";
import { completedStockDays, STOCK_BASE_MARKETS } from "@/lib/screener/stockBase";
import { reconstructSetupHistory, SETUP_REPLAY_SESSIONS } from "@/lib/screener/setupJournal";
import { logError } from "@/lib/server/logger";
import { yahooChart } from "@/lib/server/yahoo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ticker = new URL(request.url).searchParams.get("ticker")?.trim().toUpperCase() ?? "";
  const market = isYahooTicker(ticker) && STOCK_BASE_MARKETS.find(item => item.id === exchangeOfTicker(ticker).id);
  if (!market) return Response.json({ error: "Gib einen Aktien-Ticker aus US, Xetra oder London ein." }, { status: 400 });
  const now = Date.now(), end = Math.floor(now / 60_000) * 60;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
  const fetcher: typeof fetch = (input, init) =>
    fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
  const load = (symbol: string) => yahooChart({ ticker: symbol, interval: "1d", period1: end - 240 * 86400, period2: end, extended: false }, fetcher);
  try {
    const [stock, index] = await Promise.all([load(ticker), load(market.benchmark)]);
    if (stock.meta.type !== "stock") return Response.json({ error: "Historische Signale sind für Aktien verfügbar." }, { status: 400 });
    if (!stock.meta.timezone || stock.meta.timezone === "UTC" || !index.meta.timezone || index.meta.timezone === "UTC")
      throw new Error("Exchange session unavailable.");
    const bars = completedStockDays(adjustForDividends(stock.bars, stock.adjClose), stock.meta.timezone, now);
    const nominalBars = completedStockDays(stock.bars, stock.meta.timezone, now);
    const benchmark = completedStockDays(adjustForDividends(index.bars, index.adjClose), index.meta.timezone, now);
    if (bars.length < 60 || benchmark.length < 60) throw new Error("History unavailable.");
    const metadata = { symbol: `YF:${ticker}`, ticker, name: stock.meta.name || ticker, currency: stock.meta.currency,
      market: market.id, sector: "—" };
    const records = reconstructSetupHistory(bars, nominalBars, benchmark, metadata);
    const sessions = Math.min(SETUP_REPLAY_SESSIONS, bars.length - 60);
    return Response.json(
      { records, sessions, benchmark: market.benchmarkLabel },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (error) {
    logError("api.terminalSetups.error", error, { ticker });
    return Response.json({ error: "Historische Tagesdaten vorübergehend nicht verfügbar." }, { status: 503 });
  }
}
