import { adjustForDividends, type YahooChart } from "@/lib/market/yahoo";
import {
  completedStockDays,
  STOCK_BASE_MARKETS,
  STOCK_BASE_PAGE_SIZE,
} from "@/lib/screener/stockBase";
import {
  evaluateTickerOpportunities,
  opportunityHistoryIssue,
  type OpportunityScanResult,
  type TradeOpportunity,
} from "@/lib/screener/opportunities";
import { universeFor } from "@/lib/stockUniverse";
import { POPULAR, exchangeOfTicker } from "@/lib/markets";
import { isYahooTicker } from "@/lib/symbolId";
import { yahooChart } from "./yahoo";
import {
  SEC_CIK_MAP,
  fetchSecEdgarForm4Summary,
  fetchTradingViewScannerBatch,
  FUNDAMENTAL_BASELINES,
  mergeAnalystConsensus,
  resolveFundamentalSnapshot,
} from "./fundamentals";
import { setBoundedCache } from "./cache";
import { resolveSecCik } from "./secForm4";
import { fetchFinvizSnapshot, fetchOpenInsiderBuys, fetchYahooFinanceInsights } from "./publicEquitySources";
import { fetchNasdaqAnalystData, fetchTrueHistoricalMedianPe } from "./macroAndSentimentSources";

const DAY = 86_400_000;
const etfs = new Set(POPULAR.etf.map(item => item.ticker));
const scanCache = new Map<string, { at: number; result: OpportunityScanResult }>();

export class InvalidOpportunityScan extends Error {}

export function clearOpportunityScanCache(): void {
  scanCache.clear();
}

/**
 * Prioritize high-liquidity & fundamental-coverage symbols first so a single scan batch
 * immediately surfaces Categories A, B, and C setups.
 */
function prioritizedUniverse(marketId: string): string[] {
  const universe = universeFor(marketId);
  if (!universe) return [];
  const all = universe.tickers.filter(ticker => !etfs.has(ticker));
  const withBaseline = all.filter(t => t in FUNDAMENTAL_BASELINES);
  const rest = all.filter(t => !(t in FUNDAMENTAL_BASELINES));
  return [...withBaseline, ...rest];
}

export async function scanTradeOpportunities(
  marketId: string,
  page = 0,
  now = Date.now(),
  chartLoader = yahooChart,
  customTickers?: unknown,
  fetcher: typeof fetch = fetch,
  cancellation?: AbortSignal,
): Promise<OpportunityScanResult> {
  const market = STOCK_BASE_MARKETS.find(m => m.id === marketId);
  const baseTickers = prioritizedUniverse(marketId);
  if (!market || !baseTickers.length) {
    throw new InvalidOpportunityScan("Choose a supported stock market (us, xetra, lse).");
  }

  let tickers = baseTickers;
  if (customTickers !== undefined) {
    if (
      !Array.isArray(customTickers) ||
      !customTickers.length ||
      customTickers.length > STOCK_BASE_PAGE_SIZE ||
      !customTickers.every(t => typeof t === "string" && isYahooTicker(t) && exchangeOfTicker(t).id === marketId)
    ) {
      throw new InvalidOpportunityScan("Choose up to 24 valid Yahoo tickers from the selected market.");
    }
    tickers = [...new Set<string>(customTickers)];
  }

  const pages = Math.max(1, Math.ceil(tickers.length / STOCK_BASE_PAGE_SIZE));
  if (!Number.isInteger(page) || page < 0 || page >= pages) {
    throw new InvalidOpportunityScan("Choose a valid universe page.");
  }

  const cacheable = chartLoader === yahooChart && customTickers === undefined;
  const cacheKey = `${marketId}:${page}`;
  const cached = cacheable ? scanCache.get(cacheKey) : undefined;
  if (cached && now - cached.at < 3 * 60_000) return cached.result;

  const selected = tickers.slice(page * STOCK_BASE_PAGE_SIZE, (page + 1) * STOCK_BASE_PAGE_SIZE);
  cancellation?.throwIfAborted();
  const timeout = AbortSignal.timeout(22_000);
  const deadline = cancellation ? AbortSignal.any([timeout, cancellation]) : timeout;
  const boundedFetch: typeof fetch = (input, init) =>
    fetcher(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline,
    });

  const period2 = Math.floor(now / 60_000) * 60;
  const loadChart = (ticker: string) =>
    chartLoader({ ticker, interval: "1d", period1: period2 - 200 * 86400, period2, extended: false }, boundedFetch);
  const toDaily = (data: YahooChart) => {
    if (!data.meta.timezone || data.meta.timezone === "UTC") throw new Error("Exchange timezone unavailable.");
    return completedStockDays(adjustForDividends(data.bars, data.adjClose), data.meta.timezone, now);
  };

  const benchmark = toDaily(await loadChart(market.benchmark));
  cancellation?.throwIfAborted();
  if (benchmark.length < 60 || now - benchmark.at(-1)!.time > 7 * DAY) {
    throw new Error("Recent completed benchmark sessions are unavailable.");
  }

  const tvBatch = await fetchTradingViewScannerBatch(marketId, selected, boundedFetch);

  const opportunities: TradeOpportunity[] = [];
  const unavailable: { symbol: string; reason: string }[] = [];
  const sourcesUsed = new Set<string>(["Yahoo Finance OHLCV"]);
  if (tvBatch.size > 0) sourcesUsed.add("TradingView Public Scanner");

  let evaluated = 0;
  let excluded = 0;
  let nextIdx = 0;

  await Promise.all(
    Array.from({ length: Math.min(5, selected.length) }, async () => {
      while (nextIdx < selected.length) {
        cancellation?.throwIfAborted();
        const ticker = selected[nextIdx++];
        const symbol = `YF:${ticker}`;
        try {
          const [chartData, secSummary, openInsider, cik, yahooInsights, finviz, nasdaqAnalyst] = await Promise.all([
            loadChart(ticker),
            marketId === "us"
              ? fetchSecEdgarForm4Summary(ticker, boundedFetch, now, {
                  maxXmlDocs: 3,
                  stopAfterBuys: 2,
                  concurrency: 1,
                  signal: deadline,
                })
              : Promise.resolve(null),
            marketId === "us" ? fetchOpenInsiderBuys(ticker, boundedFetch, now) : Promise.resolve([]),
            marketId === "us" ? resolveSecCik(ticker, SEC_CIK_MAP, boundedFetch, now, deadline) : Promise.resolve(null),
            chartLoader === yahooChart ? fetchYahooFinanceInsights(ticker, now).catch(() => null) : Promise.resolve(null),
            marketId === "us" && chartLoader === yahooChart ? fetchFinvizSnapshot(ticker, boundedFetch, now).catch(() => null) : Promise.resolve(null),
            marketId === "us" && chartLoader === yahooChart ? fetchNasdaqAnalystData(ticker, boundedFetch, now).catch(() => null) : Promise.resolve(null),
          ]);
          if (secSummary) {
            sourcesUsed.add(secSummary.xmlVerified ? "SEC EDGAR Form 4 XML" : "SEC EDGAR Submissions");
          }
          if (openInsider.length) sourcesUsed.add("OpenInsider");
          if (yahooInsights) sourcesUsed.add("Yahoo Finance2 Consensus");
          if (finviz) sourcesUsed.add("Finviz");
          if (nasdaqAnalyst) sourcesUsed.add("Nasdaq Analyst");
          if (chartData.meta.type !== "stock") { excluded++; continue; }
          const bars = toDaily(chartData);
          const historyIssue = opportunityHistoryIssue(bars, benchmark);
          if (historyIssue) throw new Error(historyIssue);
          const latestBar = bars.at(-1)!;
          const tvPartial = tvBatch.get(ticker);
          const base = FUNDAMENTAL_BASELINES[ticker];
          const currentPe = tvPartial?.forwardPe ?? yahooInsights?.partial.forwardPe ?? finviz?.forwardPe ?? base?.forwardPe ?? null;
          const netDebt = tvPartial?.netDebtToEbitda ?? base?.netDebtToEbitda ?? null;
          const pfcf = tvPartial?.priceToFcf ?? finviz?.priceToFcf ?? base?.priceToFcf ?? null;
          const fcfYield =
            tvPartial?.fcfYieldPct ??
            yahooInsights?.partial.fcfYieldPct ??
            base?.fcfYieldPct ??
            (pfcf && pfcf > 0 ? Math.round((100 / pfcf) * 100) / 100 : null);
          const opMargin =
            tvPartial?.operatingMarginPct ?? yahooInsights?.partial.operatingMarginPct ?? finviz?.operatingMarginPct ?? base?.operatingMarginPct ?? null;
          const revGrowth =
            tvPartial?.revenueGrowthPct ?? yahooInsights?.partial.revenueGrowthPct ?? finviz?.revenueGrowthPct ?? base?.revenueGrowthPct ?? null;
          const epsRev = base?.epsRevisionPct ?? (revGrowth ? Math.round(revGrowth * 0.25 * 10) / 10 : null);
          const eligibleForValueHistory =
            Boolean(cik) &&
            latestBar.close > 0 &&
            chartLoader === yahooChart &&
            currentPe !== null &&
            currentPe > 0 &&
            (netDebt === null || netDebt <= 2.6) &&
            (fcfYield === null || fcfYield >= 3.2) &&
            (opMargin === null || opMargin >= 10) &&
            (epsRev === null || epsRev >= -1);
          const historicalPe = eligibleForValueHistory
            ? await fetchTrueHistoricalMedianPe(
                ticker,
                cik,
                latestBar.close,
                currentPe,
                boundedFetch,
                Math.floor(now / 1000),
                deadline,
              ).catch(() => null)
            : null;
          if (historicalPe?.historicalMedianPe) sourcesUsed.add("SEC XBRL Multi-Year History");

          const fundamentals = resolveFundamentalSnapshot(
            ticker,
            latestBar.close,
            chartData.meta.currency || "USD",
            chartData.meta.name || ticker,
            tvPartial,
            secSummary,
            { openInsider, finviz, yahooInsights, historicalPe },
          );
          if (nasdaqAnalyst?.consensus) {
            fundamentals.analystConsensus = mergeAnalystConsensus(
              fundamentals.analystConsensus,
              nasdaqAnalyst.consensus,
            );
            if (!fundamentals.analystTarget && nasdaqAnalyst.targetMean) {
              fundamentals.analystTarget = nasdaqAnalyst.targetMean;
            }
            fundamentals.dataSources ??= [];
            if (!fundamentals.dataSources.includes("Nasdaq Analyst")) {
              fundamentals.dataSources.push("Nasdaq Analyst");
            }
          }
          if (fundamentals.source === "curated-baseline") sourcesUsed.add("Open Fundamental & Sector Model");
          const detected = evaluateTickerOpportunities(
            bars,
            benchmark,
            {
              symbol,
              ticker,
              name: fundamentals.name,
              market: marketId,
              sector: fundamentals.sector,
              currency: fundamentals.currency,
            },
            fundamentals,
          );
          evaluated++;
          opportunities.push(...detected);
        } catch (error) {
          cancellation?.throwIfAborted();
          unavailable.push({
            symbol,
            reason: error instanceof Error ? error.message.slice(0, 140) : "Daily data unavailable.",
          });
        }
      }
    }),
  );
  cancellation?.throwIfAborted();

  opportunities.sort((a, b) => b.score - a.score || b.levels.riskReward - a.levels.riskReward || a.ticker.localeCompare(b.ticker));
  unavailable.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const result: OpportunityScanResult = {
    market: market.id,
    benchmark: market.benchmarkLabel,
    benchmarkSession: benchmark.at(-1)!.session,
    generatedAt: now,
    evaluated,
    excluded,
    universe: selected.length,
    page,
    pages,
    dataSources: [...sourcesUsed],
    opportunities,
    unavailable,
  };

  if (cacheable) {
    setBoundedCache(scanCache, cacheKey, { at: now, result }, 30);
  }
  return result;
}
