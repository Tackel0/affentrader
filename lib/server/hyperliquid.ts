import { HYPERLIQUID_MAX_CANDLES, HYPERLIQUID_NATIVES, parseAssets, type HyperliquidAsset } from "@/lib/market/hyperliquid";
import { isHyperliquidCoin } from "@/lib/symbolId";
import { candleDayRange, DAY_MS, MINUTE_MS } from "@/lib/market/quoteMetrics";
import { parseCandles } from "@/lib/market/hyperliquid";
import type { OHLCV, QuoteRange } from "@/types/trading";

const INFO_URL = "https://api.hyperliquid.xyz/info";
const DEX_NAME = /^[a-z0-9]{2,12}$/;
const INTERVALS = HYPERLIQUID_NATIVES.map((n) => n.api);

export class HyperliquidValidationError extends Error {}

const cache = new Map<string, { at: number; value: unknown }>();
function recall<T>(key: string, ttl: number): T | undefined {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < ttl ? (hit.value as T) : undefined;
}
function remember<T>(key: string, value: T): T {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return value;
}
export function clearHyperliquidCache() {
  cache.clear();
  rangeCache.clear();
}
const rangeCache = new Map<string, { bars: OHLCV[]; range: QuoteRange }>();
const rangePending = new Map<string, Promise<QuoteRange>>();
let activeRanges = 0;
const rangeWaiters: (() => void)[] = [];
async function rangeSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeRanges >= 2) await new Promise<void>(resolve => rangeWaiters.push(resolve));
  else activeRanges++;
  try { return await work(); } finally {
    const next = rangeWaiters.shift();
    if (next) next(); else activeRanges--;
  }
}
/** Complete minute-aligned 24h windows. Subsequent refreshes only fetch new closed minutes. */
export async function hyperliquidRange(coin: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<QuoteRange> {
  if (!isHyperliquidCoin(coin)) throw new HyperliquidValidationError("Invalid coin.");
  const to = Math.floor(now / MINUTE_MS) * MINUTE_MS, from = to - DAY_MS;
  const known = rangeCache.get(coin);
  if (known?.range.to === to) return known.range;
  const pendingKey = `${coin}:${to}`;
  const pending = rangePending.get(pendingKey);
  if (pending) return pending;
  const task = (async () => {
    const incremental = known?.range.complete && to > known.range.to && to - known.range.to <= 10 * MINUTE_MS;
    const rows = parseCandles(await rangeSlot(() => info({ type: "candleSnapshot", req: {
      coin, interval: "1m", startTime: incremental ? known.range.to - MINUTE_MS : from, endTime: to - 1,
    } }, fetcher)));
    const merged = new Map((incremental ? known.bars : []).map(bar => [bar.time, bar]));
    for (const bar of rows) merged.set(bar.time, bar);
    const bars = [...merged.values()].filter(bar => bar.time >= from && bar.time + MINUTE_MS <= to).sort((a, b) => a.time - b.time);
    const range = candleDayRange(bars, to);
    if (to >= (rangeCache.get(coin)?.range.to ?? 0)) rangeCache.set(coin, { bars, range });
    if (rangeCache.size > 128) rangeCache.delete(rangeCache.keys().next().value!);
    return range;
  })();
  rangePending.set(pendingKey, task);
  try { return await task; } finally { rangePending.delete(pendingKey); }
}

/** POST to the public info endpoint with a fixed, validated body. */
export async function info(body: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<unknown> {
  const response = await fetcher(INFO_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Hyperliquid responded with HTTP ${response.status}`);
  return await response.json();
}

export interface CandleRequest {
  coin: string;
  interval: string;
  startTime: number;
  endTime: number;
}

export function validateCandleRequest(r: CandleRequest, now = Date.now()): void {
  if (!isHyperliquidCoin(r.coin)) throw new HyperliquidValidationError("Invalid coin.");
  if (!INTERVALS.includes(r.interval)) throw new HyperliquidValidationError("Unsupported interval.");
  if (!Number.isFinite(r.startTime) || !Number.isFinite(r.endTime) || r.startTime < 0 || r.endTime <= r.startTime)
    throw new HyperliquidValidationError("Invalid time window.");
  if (r.endTime > now + 86_400_000) throw new HyperliquidValidationError("Time window is in the future.");
  const native = HYPERLIQUID_NATIVES.find((n) => n.api === r.interval)!;
  if (r.endTime - r.startTime > native.ms * (HYPERLIQUID_MAX_CANDLES + 1)) throw new HyperliquidValidationError("Time window is too long.");
}

export async function hyperliquidCandles(r: CandleRequest, fetcher: typeof fetch = fetch): Promise<unknown> {
  validateCandleRequest(r);
  const key = `c:${r.coin}:${r.interval}:${r.startTime}:${r.endTime}`;
  const hit = recall<unknown>(key, 5_000);
  if (hit) return hit;
  return remember(
    key,
    await info(
      {
        type: "candleSnapshot",
        req: { coin: r.coin, interval: r.interval, startTime: Math.floor(r.startTime), endTime: Math.floor(r.endTime) },
      },
      fetcher,
    ),
  );
}

interface DexRow {
  name?: string;
  fullName?: string;
}

/** Dexes that failed in the most recent refresh, shown to the user instead of hiding silently. */
export let lastWarnings: string[] = [];

/** Last good result per dex, served when a refresh fails so one flaky dex never empties the list. */
const lastGood = new Map<string, HyperliquidAsset[]>();

async function dexAssets(
  dex: { name: string; fullName: string },
  fetcher: typeof fetch,
): Promise<HyperliquidAsset[]> {
  const body: Record<string, unknown> = { type: "metaAndAssetCtxs" };
  if (dex.name) body.dex = dex.name;
  let error: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const [meta, contexts] = (await info(body, fetcher)) as [unknown, unknown];
      const assets = parseAssets(meta, contexts, dex.name, dex.fullName);
      lastGood.set(dex.name, assets);
      return assets;
    } catch (e) {
      error = e;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  const stale = lastGood.get(dex.name);
  if (stale) return stale;
  throw error;
}

/** Every perpetual market on every dex, with live context, busiest first. */
let assetsPending: Promise<HyperliquidAsset[]> | undefined;
export async function hyperliquidAssets(fetcher: typeof fetch = fetch): Promise<HyperliquidAsset[]> {
  const hit = recall<HyperliquidAsset[]>("assets", 60_000);
  if (hit) return hit;
  if (assetsPending) return assetsPending;
  assetsPending = refreshAssets(fetcher);
  try { return await assetsPending; } finally { assetsPending = undefined; }
}
async function refreshAssets(fetcher: typeof fetch): Promise<HyperliquidAsset[]> {
  const dexes = ((await info({ type: "perpDexs" }, fetcher)) as (DexRow | null)[]).filter(
    (d): d is DexRow & { name: string } => Boolean(d?.name && DEX_NAME.test(d.name)),
  );
  const sources = [{ name: "", fullName: "Hyperliquid" }, ...dexes.map((d) => ({ name: d.name, fullName: d.fullName ?? d.name }))];
  // A few at a time: the public endpoint rate-limits bursts and then drops some dexes.
  const lists: HyperliquidAsset[][] = [];
  const warnings: string[] = [];
  for (let i = 0; i < sources.length; i += 3) {
    const settled = await Promise.allSettled(sources.slice(i, i + 3).map((dex) => dexAssets(dex, fetcher)));
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") lists.push(result.value);
      else {
        lists.push([]);
        warnings.push(`${sources[i + index].name || "main"}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
    });
  }
  lastWarnings = warnings;
  const assets = lists.flat().sort((a, b) => b.volume - a.volume);
  if (!assets.length) throw new Error("Hyperliquid returned no markets.");
  return remember("assets", assets);
}
