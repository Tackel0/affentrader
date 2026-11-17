import {
  parseChart,
  parseSearch,
  parseSpark,
  type YahooChart,
  type YahooQuote,
  type YahooSearchHit,
} from "@/lib/market/yahoo";
import { isYahooTicker } from "@/lib/symbolId";

const HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; affentrader/1.0)", accept: "application/json" };
export const YAHOO_INTERVALS = ["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"];
const MAX_SPAN_SECONDS = 60 * 365 * 86_400;

const cache = new Map<string, { at: number; value: unknown }>();
function remember<T>(key: string, ttl: number, value: T): T {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return value;
}
function recall<T>(key: string, ttl: number): T | undefined {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < ttl ? (hit.value as T) : undefined;
}
export function clearYahooCache() {
  cache.clear();
}

async function getJson(path: string, fetcher: typeof fetch): Promise<unknown> {
  let last: unknown;
  for (const host of HOSTS) {
    try {
      const response = await fetcher(`${host}${path}`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });
      if (response.ok) return await response.json();
      // Yahoo answers unknown symbols with 404 plus a JSON error body.
      if (response.status === 404) {
        const body = await response.json().catch(() => null);
        return body ?? { chart: { error: { description: "Symbol not found." } } };
      }
      last = new Error(`Yahoo Finance responded with HTTP ${response.status}`);
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("Yahoo Finance is unavailable.");
}

export interface ChartRequest {
  ticker: string;
  interval: string;
  period1: number;
  period2: number;
  extended: boolean;
}

export function validateChartRequest(r: ChartRequest, now = Date.now() / 1000): void {
  if (!isYahooTicker(r.ticker)) throw new Error("Invalid symbol.");
  if (!YAHOO_INTERVALS.includes(r.interval)) throw new Error("Unsupported interval.");
  if (!Number.isFinite(r.period1) || !Number.isFinite(r.period2) || r.period1 < 0 || r.period2 <= r.period1)
    throw new Error("Invalid time window.");
  if (r.period2 - r.period1 > MAX_SPAN_SECONDS) throw new Error("Time window is too long.");
  if (r.period2 > now + 2 * 86_400) throw new Error("Time window is in the future.");
}

export async function yahooChart(r: ChartRequest, fetcher: typeof fetch = fetch): Promise<YahooChart> {
  validateChartRequest(r);
  const key = `chart:${JSON.stringify(r)}`;
  const hit = recall<YahooChart>(key, 15_000);
  if (hit) return hit;
  const daily = ["1d", "5d", "1wk", "1mo", "3mo"].includes(r.interval);
  const params = new URLSearchParams({
    interval: r.interval,
    period1: String(Math.floor(r.period1)),
    period2: String(Math.floor(r.period2)),
    includePrePost: String(r.extended && !daily),
    events: daily ? "div|split" : "",
  });
  if (!daily) params.delete("events");
  const json = await getJson(`/v8/finance/chart/${encodeURIComponent(r.ticker)}?${params}`, fetcher);
  return remember(key, 15_000, parseChart(json));
}

export async function yahooSpark(tickers: string[], fetcher: typeof fetch = fetch): Promise<Record<string, YahooQuote>> {
  const valid = [...new Set(tickers)].filter(isYahooTicker).slice(0, 20);
  if (!valid.length) return {};
  const key = `spark:${valid.join(",")}`;
  const hit = recall<Record<string, YahooQuote>>(key, 5_000);
  if (hit) return hit;
  const params = new URLSearchParams({ symbols: valid.join(","), range: "1d", interval: "5m" });
  return remember(key, 5_000, parseSpark(await getJson(`/v8/finance/spark?${params}`, fetcher)));
}

export async function yahooSearch(query: string, fetcher: typeof fetch = fetch): Promise<YahooSearchHit[]> {
  const q = query.trim().slice(0, 40);
  if (!q) return [];
  const key = `search:${q.toLowerCase()}`;
  const hit = recall<YahooSearchHit[]>(key, 300_000);
  if (hit) return hit;
  const params = new URLSearchParams({ q, quotesCount: "15", newsCount: "0" });
  return remember(key, 300_000, parseSearch(await getJson(`/v1/finance/search?${params}`, fetcher)));
}
