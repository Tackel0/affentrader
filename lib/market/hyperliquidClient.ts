import type { OHLCV } from "@/types/trading";
import { aggregateBars } from "./aggregation";
import { bucketStart, parseInterval, planSource } from "./intervals";
import {
  HYPERLIQUID_MAX_CANDLES,
  HYPERLIQUID_NATIVES,
  parseCandles,
  type HyperliquidAsset,
} from "./hyperliquid";

export interface HyperliquidLoadRequest {
  coin: string;
  timeframe: string;
  count: number;
  end?: number;
  fetcher?: typeof fetch;
  /** Replaces the HTTP page loader, so the server can read candles without calling itself. */
  page?: (coin: string, api: string, start: number, end: number) => Promise<OHLCV[]>;
}

async function candlePage(
  fetcher: typeof fetch,
  coin: string,
  api: string,
  start: number,
  end: number,
): Promise<OHLCV[]> {
  const params = new URLSearchParams({
    kind: "candles",
    coin,
    interval: api,
    start: String(Math.floor(start)),
    end: String(Math.ceil(end)),
  });
  const response = await fetcher(`/api/hyperliquid?${params}`, { signal: AbortSignal.timeout(20_000) });
  const body = (await response.json().catch(() => ({}))) as { candles?: unknown; error?: string };
  if (!response.ok) throw new Error(body.error ?? "Hyperliquid is unavailable.");
  return parseCandles(body.candles);
}

/**
 * Load candles of any time interval: the coarsest Hyperliquid interval that
 * divides it is paged backwards (at most 5,000 bars each) and resampled.
 * The exchange keeps only the latest 5,000 candles per interval, so depth is
 * limited by what it serves, never padded.
 */
export async function loadHyperliquidBars(request: HyperliquidLoadRequest): Promise<OHLCV[]> {
  const interval = parseInterval(request.timeframe);
  const plan = planSource(request.timeframe, HYPERLIQUID_NATIVES);
  if (!interval || !plan)
    throw new Error(`${request.timeframe} is not available for Hyperliquid markets; use 1m or longer.`);
  const fetcher = request.fetcher ?? fetch;
  const count = Math.max(1, Math.min(HYPERLIQUID_MAX_CANDLES, Math.floor(request.count)));
  const wanted = Math.min(HYPERLIQUID_MAX_CANDLES, (count + (plan.resample ? 1 : 0)) * plan.factor);
  const end = request.end ?? Date.now();
  const byTime = new Map<number, OHLCV>();
  let cursor = end;
  // A window covers 1,000 native bars; stop early when the exchange has nothing older.
  for (let guard = 0; byTime.size < wanted && guard < 6; guard++) {
    const need = Math.min(1000, wanted - byTime.size);
    const from = cursor - need * plan.nativeMs;
    const page = request.page
      ? await request.page(request.coin, plan.api, from, cursor)
      : await candlePage(fetcher, request.coin, plan.api, from, cursor);
    const fresh = page.filter((b) => !byTime.has(b.time));
    if (!fresh.length) break;
    for (const b of fresh) byTime.set(b.time, b);
    const oldest = Math.min(...page.map((b) => b.time));
    if (oldest >= cursor) break;
    cursor = oldest;
  }
  let source = [...byTime.values()].filter((b) => b.time <= end).sort((a, b) => a.time - b.time);
  if (plan.resample && source.length) {
    const first = bucketStart(interval.id, source[0].time);
    if (first < source[0].time) source = source.filter((b) => bucketStart(interval.id, b.time) > first);
    source = aggregateBars(source, interval.id);
  }
  return source.slice(-count);
}

/** Every Hyperliquid perpetual market with its 24h context. */
export async function loadHyperliquidAssets(fetcher: typeof fetch = fetch): Promise<HyperliquidAsset[]> {
  const response = await fetcher("/api/hyperliquid?kind=assets", { signal: AbortSignal.timeout(20_000) });
  const body = (await response.json().catch(() => ({}))) as { assets?: HyperliquidAsset[]; error?: string };
  if (!response.ok || !body.assets) throw new Error(body.error ?? "Hyperliquid is unavailable.");
  return body.assets;
}
