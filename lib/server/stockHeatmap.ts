import { lastUsMarketCloseMs, usMarketPhase } from "@/lib/market/usMarketClose";

export interface StockHeatmapCell {
  ticker: string;
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  /** Change in percent since the latest completed US regular close (16:00 ET). */
  changeSinceUsClosePct: number;
  marketCapBn: number;
  valueTradedMn: number;
}

export interface StockHeatmapResponse {
  market: string;
  sectors: string[];
  rows: StockHeatmapCell[];
  generatedAt: number;
  usCloseMs: number;
  source: string;
}

const MARKET_SCANNER: Record<string, { url: string; suffix: string; label: string }> = {
  us: { url: "https://scanner.tradingview.com/america/scan", suffix: "", label: "US S&P 500 / Nasdaq" },
  xetra: { url: "https://scanner.tradingview.com/germany/scan", suffix: ".DE", label: "Germany Xetra / DAX" },
  lse: { url: "https://scanner.tradingview.com/uk/scan", suffix: ".L", label: "UK London / FTSE" },
};

const heatmapCache = new Map<string, { at: number; data: StockHeatmapResponse }>();

export function clearStockHeatmapCache(): void {
  heatmapCache.clear();
}

const optNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function computeUsCloseChangePct(
  market: string,
  phase: ReturnType<typeof usMarketPhase>,
  price: number,
  regularChangePct: number,
  premarketChange: number | null,
  postmarketChange: number | null,
  premarketClose: number | null,
  postmarketClose: number | null,
  hasExtendedColumns: boolean,
): number {
  if (market !== "us" || phase === "regular" || !hasExtendedColumns) {
    return regularChangePct;
  }
  const derivedPre = premarketChange ?? (premarketClose && price > 0 ? ((premarketClose - price) / price) * 100 : null);
  const derivedPost = postmarketChange ?? (postmarketClose && price > 0 ? ((postmarketClose - price) / price) * 100 : null);
  if (phase === "premarket") {
    return derivedPre ?? derivedPost ?? 0;
  }
  return derivedPost ?? derivedPre ?? 0;
}

export async function fetchStockSectorHeatmap(
  market = "us",
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<StockHeatmapResponse> {
  const cleanMarket = MARKET_SCANNER[market] ? market : "us";
  const cached = heatmapCache.get(cleanMarket);
  if (cached && now - cached.at < 3 * 60_000) return cached.data;

  const cfg = MARKET_SCANNER[cleanMarket];
  const body = {
    filter: [
      { left: "market_cap_basic", operation: "nempty" },
      { left: "close", operation: "greater", right: 1 },
      { left: "type", operation: "in_range", right: ["stock", "dr"] },
    ],
    options: { lang: "en" },
    symbols: { query: { types: [] }, tickers: [] },
    columns: [
      "name",
      "description",
      "close",
      "change",
      "volume",
      "market_cap_basic",
      "sector",
      "Value.Traded",
      "premarket_change",
      "postmarket_change",
      "premarket_close",
      "postmarket_close",
    ],
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
    range: [0, 84],
  };

  const res = await fetcher(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(7_000),
  });
  if (!res.ok) {
    throw new Error(`Stock sector heatmap source returned HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ s?: string; d?: unknown[] }>;
  };

  const rows: StockHeatmapCell[] = [];
  const sectorSet = new Set<string>();
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const phase = usMarketPhase(now);
  const usCloseMs = lastUsMarketCloseMs(now);

  for (const item of json.data ?? []) {
    const d = item.d;
    if (!Array.isArray(d) || d.length < 7) continue;
    const rawTicker = typeof d[0] === "string" ? d[0].trim().toUpperCase() : "";
    if (!rawTicker || rawTicker.includes("/")) continue;
    const ticker = cfg.suffix && !rawTicker.includes(".") ? `${rawTicker}${cfg.suffix}` : rawTicker;
    const name = typeof d[1] === "string" && d[1].trim() ? d[1].trim() : rawTicker;
    const price = num(d[2]);
    const changePct = num(d[3]);
    const mcap = num(d[5]);
    const sector = typeof d[6] === "string" && d[6].trim() ? d[6].trim() : "Other";
    const valueTraded = num(d[7]);
    if (!(price > 0) || !(mcap > 0)) continue;
    const hasExtended = d.length > 8;
    const changeSinceUsClose = computeUsCloseChangePct(
      cleanMarket,
      phase,
      price,
      changePct,
      optNum(d[8]),
      optNum(d[9]),
      optNum(d[10]),
      optNum(d[11]),
      hasExtended,
    );
    sectorSet.add(sector);
    rows.push({
      ticker,
      symbol: `YF:${ticker}`,
      name,
      sector,
      price,
      changePct: Math.round(changePct * 100) / 100,
      changeSinceUsClosePct: Math.round(changeSinceUsClose * 100) / 100,
      marketCapBn: Math.round((mcap / 1e9) * 100) / 100,
      valueTradedMn: Math.round(((valueTraded || price * num(d[4])) / 1e6) * 10) / 10,
    });
  }

  const out: StockHeatmapResponse = {
    market: cfg.label,
    sectors: [...sectorSet].sort(),
    rows,
    generatedAt: now,
    usCloseMs,
    source: "TradingView Public GICS Scanner",
  };
  heatmapCache.set(cleanMarket, { at: now, data: out });
  return out;
}
