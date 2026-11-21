import { BINANCE_SYMBOL, KRAKEN_PAIR, spotQuoteCurrency } from "@/lib/symbolId";
import { wireDecimal, wireObject } from "./marketWire";

interface Snapshot {
  price: number;
  turnover?: number;
}

export interface SearchMarketSnapshots {
  binance: Map<string, Snapshot>;
  kraken: Map<string, Snapshot>;
}

async function fetchBinanceSearchQuotes(): Promise<Map<string, Snapshot>> {
  const response = await fetch("/api/market?resource=ticker/24hr", { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Binance ticker unavailable.");
  const rows: unknown = await response.json();
  const quotes = new Map<string, Snapshot>();
  if (!Array.isArray(rows)) return quotes;
  for (const item of rows) {
    const row = wireObject(item);
    if (!row || typeof row.symbol !== "string" || !BINANCE_SYMBOL.test(row.symbol)
      || !["USDT", "USDC"].includes(spotQuoteCurrency(row.symbol))) continue;
    const price = wireDecimal(row.lastPrice), turnover = wireDecimal(row.quoteVolume);
    if (Number.isFinite(price) && price > 0)
      quotes.set(row.symbol, { price, turnover: Number.isFinite(turnover) && turnover >= 0 ? turnover : undefined });
  }
  return quotes;
}

async function fetchKrakenSearchQuotes(): Promise<Map<string, Snapshot>> {
  const response = await fetch("https://api.kraken.com/0/public/Ticker?assetVersion=1", { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Kraken ticker unavailable.");
  const payload = await response.json();
  const result = wireObject(payload?.result);
  const quotes = new Map<string, Snapshot>();
  if (!result || !Array.isArray(payload.error) || payload.error.length) return quotes;
  for (const [pair, item] of Object.entries(result)) {
    if (!KRAKEN_PAIR.test(pair)) continue;
    const row = wireObject(item);
    const [price, baseVolume, vwap] = [row?.c, row?.v, row?.p].map((value, index) => Array.isArray(value) ? wireDecimal(value[index === 0 ? 0 : 1]) : NaN);
    if (!Number.isFinite(price) || price <= 0) continue;
    const turnover = /\/(USD|USDT|USDC)$/.test(pair) && baseVolume >= 0 && vwap > 0 ? baseVolume * vwap : undefined;
    quotes.set(pair, { price, turnover: Number.isFinite(turnover) ? turnover : undefined });
  }
  return quotes;
}

let current: { expires: number; snapshots: SearchMarketSnapshots } | undefined;
let request: Promise<SearchMarketSnapshots> | undefined;

export function searchMarketSnapshots(): Promise<SearchMarketSnapshots> {
  if (current && current.expires > Date.now()) return Promise.resolve(current.snapshots);
  request ??= Promise.allSettled([fetchBinanceSearchQuotes(), fetchKrakenSearchQuotes()]).then(([binance, kraken]) => {
    const snapshots = {
      binance: binance.status === "fulfilled" ? binance.value : new Map<string, Snapshot>(),
      kraken: kraken.status === "fulfilled" ? kraken.value : new Map<string, Snapshot>(),
    };
    current = { expires: Date.now() + 30_000, snapshots };
    return snapshots;
  }).finally(() => { request = undefined; });
  return request;
}
