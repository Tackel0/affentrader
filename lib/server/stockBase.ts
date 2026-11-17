import { adjustForDividends, type YahooChart } from "@/lib/market/yahoo";
import { comparePendingRetests, completedStockDays, detectPendingRetest, stockBaseCoverageIssue, stockBaseFollowThrough, trackStockBase, STOCK_BASE_MARKETS, STOCK_BASE_PAGE_SIZE, type StockBaseScan } from "@/lib/screener/stockBase";
import { universeFor } from "@/lib/stockUniverse";
import { exchangeOfTicker, POPULAR } from "@/lib/markets";
import { isYahooTicker } from "@/lib/symbolId";
import { yahooChart } from "./yahoo";
import { createHash } from "node:crypto";

const DAY = 86_400_000;
const cache = new Map<string, { result: StockBaseScan; expires: number }>();
const pending = new Map<string, Promise<StockBaseScan>>();
const etfs = new Set(POPULAR.etf.map(item => item.ticker));
export class InvalidStockBaseScan extends Error {}

export async function scanStockBases(marketId: string, page: number, now = Date.now(), chart = yahooChart, watchlist?: unknown, signal?: AbortSignal): Promise<StockBaseScan> {
  const market = STOCK_BASE_MARKETS.find(m => m.id === marketId), universe = universeFor(marketId);
  if (!market || !universe) throw new InvalidStockBaseScan("Choose a supported stock market.");
  let tickers = universe.tickers.filter(ticker => !etfs.has(ticker));
  if (watchlist !== undefined) {
    if (!Array.isArray(watchlist) || !watchlist.length || watchlist.length > STOCK_BASE_PAGE_SIZE ||
        !watchlist.every(ticker => typeof ticker === "string" && isYahooTicker(ticker) && exchangeOfTicker(ticker).id === marketId)) {
      throw new InvalidStockBaseScan("Choose up to 24 valid Yahoo tickers from the selected market.");
    }
    tickers = [...new Set<string>(watchlist)];
  }
  const pages = Math.ceil(tickers.length / STOCK_BASE_PAGE_SIZE);
  if (!Number.isInteger(page) || page < 0 || page >= pages) throw new InvalidStockBaseScan("Choose a valid universe page.");
  const cacheable = chart === yahooChart && watchlist === undefined;
  const key = `${marketId}:${page}`, hit = cacheable ? cache.get(key) : undefined;
  if (hit && now < hit.expires) return hit.result;
  const existing = cacheable ? pending.get(key) : undefined;
  if (existing) return existing;

  const scan = async (): Promise<StockBaseScan> => {
    // Curated pages are shared with other callers. Only cancel private scans.
    const cancellation = cacheable ? undefined : signal;
    const deadline = AbortSignal.timeout(22_000);
    const fetcher: typeof fetch = (input, init) => {
      cancellation?.throwIfAborted();
      return fetch(input, { ...init, signal: AbortSignal.any([deadline, ...(cancellation ? [cancellation] : []), ...(init?.signal ? [init.signal] : [])]) });
    };
    const period2 = Math.floor(now / 60_000) * 60;
    const get = (ticker: string) => chart({ ticker, interval: "1d", period1: period2 - 220 * 86400, period2, extended: false }, fetcher);
    const daily = (data: YahooChart) => {
      if (!data.meta.timezone || data.meta.timezone === "UTC") throw new Error("Exchange timezone unavailable.");
      return completedStockDays(adjustForDividends(data.bars, data.adjClose), data.meta.timezone, now);
    };
    cancellation?.throwIfAborted();
    const benchmark = daily(await get(market.benchmark));
    cancellation?.throwIfAborted();
    if (benchmark.length < 70 || now - benchmark.at(-1)!.time > 7 * DAY) throw new Error("Recent completed benchmark sessions are unavailable.");
    const selected = tickers.slice(page * STOCK_BASE_PAGE_SIZE, (page + 1) * STOCK_BASE_PAGE_SIZE);
    const benchmarkRevision = createHash("sha256").update(JSON.stringify(benchmark.map(bar => [bar.session, bar.close]))).digest("hex");
    const result: StockBaseScan = { market: market.id, benchmark: market.benchmarkLabel, benchmarkSession: benchmark.at(-1)!.session, benchmarkRevision, generatedAt: now, attempted: selected.length, evaluated: 0, excluded: 0, universe: tickers.length, page, pages, rows: [], unavailable: [] };
    let next = 0;
    const pendingRetests: NonNullable<StockBaseScan["pendingRetests"]> = [];
    await Promise.all(Array.from({ length: Math.min(5, selected.length) }, async () => {
      while (next < selected.length) {
        cancellation?.throwIfAborted();
        const ticker = selected[next++], symbol = `YF:${ticker}`;
        try {
          if (deadline.aborted) throw new Error("Data request time limit reached.");
          const data = await get(ticker);
          cancellation?.throwIfAborted();
          if (data.meta.type !== "stock") { result.excluded++; continue; }
          const bars = daily(data);
          const coverageIssue = stockBaseCoverageIssue(bars, benchmark);
          if (coverageIssue) throw new Error(coverageIssue);
          if (!bars.slice(-22).every(bar => Number.isFinite(bar.volume) && bar.volume > 0)) throw new Error("Recent volume incomplete.");
          const tracking = trackStockBase(bars, benchmark);
          result.evaluated++;
          const retest = detectPendingRetest(bars, benchmark, tracking?.status === "active" ? tracking.setup.retest.session : undefined);
          if (!tracking && !retest) continue;
          const peakSession = [tracking?.setup.drawdownPeak?.session, retest?.drawdownPeak?.session]
            .filter((session): session is string => session !== undefined).sort()[0];
          const peakIndex = bars.findIndex(bar => bar.session === peakSession);
          const recentStart = Math.max(0, bars.length - 45);
          const chartStart = peakIndex < 0 ? recentStart : Math.min(peakIndex, recentStart);
          const chart = bars.slice(chartStart).map(({ session, open, high, low, close }) => ({ session, open, high, low, close }));
          const instrument = { symbol, name: data.meta.name || ticker, currency: data.meta.currency, chart };
          if (retest) pendingRetests.push({ ...retest, ...instrument });
          if (tracking) {
            const { setup, ...progress } = tracking;
            const followThrough = stockBaseFollowThrough(bars, benchmark, progress.firstSeen, progress.firstInvalidation);
            result.rows.push({ ...setup, progress, followThrough, ...instrument });
          }
        } catch (error) {
          cancellation?.throwIfAborted();
          result.unavailable.push({ symbol, reason: error instanceof Error ? error.message.slice(0, 150) : "Daily candles unavailable." });
        }
      }
    }));
    result.rows.sort((a, b) => b.score - a.score || b.relativeStrength - a.relativeStrength || a.symbol.localeCompare(b.symbol));
    result.unavailable.sort((a, b) => a.symbol.localeCompare(b.symbol));
    result.pendingRetests = pendingRetests.sort(comparePendingRetests);
    return result;
  };
  if (!cacheable) return scan();
  const promise = scan().then(result => {
    cache.set(key, { result, expires: now + (result.unavailable.length ? 60_000 : 5 * 60_000) });
    return result;
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
