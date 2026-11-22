import { adjustForDividends } from "@/lib/market/yahoo";
import { exchangeOfTicker } from "@/lib/markets";
import { isYahooTicker } from "@/lib/symbolId";
import { completedStockDays, STOCK_BASE_MARKETS } from "@/lib/screener/stockBase";
import { evaluateTickerOpportunities } from "@/lib/screener/opportunities";
import { historicalSetupOutcome, setupRecord, type SetupRecord } from "@/lib/screener/setupJournal";
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
    const nominalBars = new Map(completedStockDays(stock.bars, stock.meta.timezone, now).map(bar => [bar.session, bar]));
    const benchmark = completedStockDays(adjustForDividends(index.bars, index.adjClose), index.meta.timezone, now);
    if (bars.length < 60 || benchmark.length < 60) throw new Error("History unavailable.");
    const records: SetupRecord[] = [];
    const metadata = { symbol: `YF:${ticker}`, ticker, name: stock.meta.name || ticker, currency: stock.meta.currency,
      market: market.id, sector: "—" };
    for (let i = Math.max(59, bars.length - 21); i < bars.length - 1; i++) {
      const nominal = nominalBars.get(bars[i].session);
      if (!nominal) continue;
      const scale = nominal.close / bars[i].close;
      if (!Number.isFinite(scale) || scale <= 0) continue;
      const history = bars.slice(0, i + 1).map(bar => ({ ...bar, open: bar.open * scale, high: bar.high * scale,
        low: bar.low * scale, close: bar.close * scale }));
      const priorIndex = benchmark.filter(bar => bar.session <= bars[i].session);
      for (const opportunity of evaluateTickerOpportunities(history, priorIndex, metadata, null)) {
        const row = setupRecord(opportunity, bars[i].time);
        if (row) records.push({ ...row, id: `replay:${row.id}`, reconstructed: true,
          outcome: historicalSetupOutcome(row.levels, [...nominalBars.values()].filter(bar => bar.session > row.session)) });
      }
    }
    return Response.json({ records, benchmark: market.benchmarkLabel });
  } catch {
    return Response.json({ error: "Historische Tagesdaten vorübergehend nicht verfügbar." }, { status: 503 });
  }
}
