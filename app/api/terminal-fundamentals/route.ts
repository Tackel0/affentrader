import { isYahooTicker } from "@/lib/symbolId";
import { exchangeOfTicker } from "@/lib/markets";
import { yahooChart } from "@/lib/server/yahoo";
import {
  SEC_CIK_MAP,
  fetchSecEdgarForm4Summary,
  fetchTradingViewScannerBatch,
  mergeAnalystConsensus,
  resolveFundamentalSnapshot,
} from "@/lib/server/fundamentals";
import { resolveSecCik } from "@/lib/server/secForm4";
import {
  fetchFinvizSnapshot,
  fetchOpenInsiderBuys,
  fetchYahooFinanceInsights,
} from "@/lib/server/publicEquitySources";
import {
  fetchNasdaqAnalystData,
  fetchTrueHistoricalMedianPe,
} from "@/lib/server/macroAndSentimentSources";
import { computeQuantSignals } from "@/lib/quant/signals";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const ticker = (params.get("ticker") ?? "").trim().toUpperCase();
  if (!isYahooTicker(ticker)) {
    return Response.json({ error: "Enter a valid Yahoo stock ticker." }, { status: 400 });
  }
  const exchange = exchangeOfTicker(ticker);
  const marketId = params.get("market") ?? exchange.id;
  try {
    const now = Math.floor(Date.now() / 60_000) * 60;
    const deadline = AbortSignal.timeout(15_000);
    const boundedFetch: typeof fetch = (input, init) =>
      fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline });

    const [chartRes, tvBatch, secSummary, openInsider, finviz, yahooInsights, cik, nasdaqAnalyst] = await Promise.all([
      yahooChart(
        { ticker, interval: "1d", period1: now - 210 * 86400, period2: now, extended: false },
        boundedFetch,
      ).catch(() => null),
      fetchTradingViewScannerBatch(marketId, [ticker], boundedFetch),
      marketId === "us"
        ? fetchSecEdgarForm4Summary(ticker, boundedFetch, undefined, {
            maxXmlDocs: 8,
            concurrency: 2,
            signal: deadline,
          })
        : Promise.resolve(null),
      marketId === "us" ? fetchOpenInsiderBuys(ticker, boundedFetch) : Promise.resolve([]),
      marketId === "us" ? fetchFinvizSnapshot(ticker, boundedFetch) : Promise.resolve(null),
      fetchYahooFinanceInsights(ticker).catch(() => null),
      marketId === "us" ? resolveSecCik(ticker, SEC_CIK_MAP, boundedFetch, undefined, deadline) : Promise.resolve(null),
      marketId === "us" ? fetchNasdaqAnalystData(ticker, boundedFetch).catch(() => null) : Promise.resolve(null),
    ]);

    const latestClose = chartRes?.bars.at(-1)?.close ?? chartRes?.meta.price ?? 0;
    const currency = chartRes?.meta.currency ?? "USD";
    const name = chartRes?.meta.name ?? ticker;
    const tvPartial = tvBatch.get(ticker);
    const currentForwardPe = tvPartial?.forwardPe ?? yahooInsights?.partial.forwardPe ?? finviz?.forwardPe ?? null;

    const historicalPe = cik && latestClose > 0
      ? await fetchTrueHistoricalMedianPe(
          ticker,
          cik,
          latestClose,
          currentForwardPe,
          boundedFetch,
          undefined,
          deadline,
        ).catch(() => null)
      : null;

    const snapshot = resolveFundamentalSnapshot(
      ticker,
      latestClose,
      currency,
      name,
      tvPartial,
      secSummary,
      { openInsider, finviz, yahooInsights, historicalPe },
    );

    if (nasdaqAnalyst?.consensus) {
      snapshot.analystConsensus = mergeAnalystConsensus(
        snapshot.analystConsensus,
        nasdaqAnalyst.consensus,
      );
      if (!snapshot.analystTarget && nasdaqAnalyst.targetMean) {
        snapshot.analystTarget = nasdaqAnalyst.targetMean;
      }
      snapshot.dataSources ??= [];
      if (!snapshot.dataSources.includes("Nasdaq Analyst")) {
        snapshot.dataSources.push("Nasdaq Analyst");
      }
    }

    const quant = chartRes?.bars?.length ? computeQuantSignals(chartRes.bars) : null;

    return Response.json({
      ticker,
      lastClose: latestClose,
      fundamentals: snapshot,
      quant,
    });
  } catch {
    return Response.json({ error: "Fundamental data is temporarily unavailable." }, { status: 503 });
  }
}
