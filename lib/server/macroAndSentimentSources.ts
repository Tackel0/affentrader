import { yahooChart } from "./yahoo";
import { setBoundedCache } from "./cache";
import { SEC_CIK_MAP } from "./fundamentals";
import { resolveSecCik, secFetch } from "./secForm4";
import type { AnalystConsensus } from "@/lib/screener/opportunities";

export interface FredMacroPoint {
  id: string;
  label: string;
  unit: string;
  date: string;
  value: number;
  prevValue: number | null;
  change: number | null;
}

export interface CryptoFearGreedEntry {
  value: number;
  classification: string;
  timestamp: number;
}

export interface CrossAssetQuote {
  symbol: string;
  label: string;
  price: number;
  changePct: number;
}

export interface GlobalMacroPulse {
  updatedAt: number;
  fred: FredMacroPoint[];
  fearGreed: CryptoFearGreedEntry | null;
  fearGreedHistory: CryptoFearGreedEntry[];
  crossAssets: CrossAssetQuote[];
}

export interface NasdaqAnalystSummary {
  ticker: string;
  consensus: AnalystConsensus | null;
  targetMean: number | null;
  targetHigh: number | null;
  targetLow: number | null;
}

/**
 * Parses public FRED CSV series (`https://fred.stlouisfed.org/graph/fredgraph.csv?id=...`)
 * skipping missing `.` observations and returning the latest non-empty reading + delta.
 */
export function parseFredCsv(
  csvText: string,
  id: string,
  label: string,
  unit: string,
): FredMacroPoint | null {
  if (!csvText.trim()) return null;
  const rows: Array<{ date: string; value: number }> = [];
  for (const rawLine of csvText.trim().split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("DATE") || line.startsWith("observation_date")) continue;
    const [date, rawVal] = line.split(",");
    if (!date || !rawVal || rawVal === ".") continue;
    const value = Number(rawVal);
    if (Number.isFinite(value)) rows.push({ date: date.trim(), value });
  }
  if (!rows.length) return null;
  const latest = rows.at(-1)!;
  const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
  const change = prev ? Number((latest.value - prev.value).toFixed(4)) : null;
  return {
    id,
    label,
    unit,
    date: latest.date,
    value: Number(latest.value.toFixed(4)),
    prevValue: prev ? Number(prev.value.toFixed(4)) : null,
    change,
  };
}

/**
 * Parses Alternative.me Fear & Greed JSON payload (`https://api.alternative.me/fng/?limit=7`).
 */
export function parseFearGreedPayload(payload: unknown): CryptoFearGreedEntry[] {
  const data = (payload as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: CryptoFearGreedEntry[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const value = Number(row.value);
    const classification = typeof row.value_classification === "string" ? row.value_classification : "";
    const tsSec = Number(row.timestamp);
    if (!Number.isFinite(value) || !classification) continue;
    out.push({
      value,
      classification,
      timestamp: Number.isFinite(tsSec) && tsSec > 0 ? tsSec * 1000 : Date.now(),
    });
  }
  return out;
}

/**
 * Parses Nasdaq Public API analyst ratings JSON (`/api/analyst/{ticker}/ratings`).
 */
export function parseNasdaqAnalystRatings(
  ticker: string,
  ratingsJson: unknown,
  targetJson?: unknown,
): NasdaqAnalystSummary | null {
  const data = (ratingsJson as { data?: Record<string, unknown> } | null)?.data;
  const targetData = (targetJson as { data?: Record<string, unknown> } | null)?.data;
  const overview =
    (targetData?.consensusOverview as Record<string, unknown> | undefined) ?? undefined;
  const ratingsObj =
    typeof data?.ratingsSummary === "object" && data.ratingsSummary !== null
      ? (data.ratingsSummary as Record<string, unknown>)
      : typeof data?.meanRatingType === "object" && data.meanRatingType !== null
        ? (data.meanRatingType as Record<string, unknown>)
        : data;

  const parseNum = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const cleaned = v.replace(/[$,%]/g, "").trim();
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  let strongBuy = 0;
  let buy = 0;
  let hold = 0;
  let sell = 0;
  let strongSell = 0;
  let ratingLabel = "";

  if (typeof data?.consensusRecommendation === "string") {
    ratingLabel = data.consensusRecommendation.trim();
  } else if (typeof data?.meanRatingType === "string") {
    ratingLabel = data.meanRatingType.trim();
  }

  if (ratingsObj && typeof ratingsObj === "object") {
    strongBuy = Math.max(0, Math.round(parseNum(ratingsObj.strongBuy) ?? 0));
    buy = Math.max(0, Math.round(parseNum(ratingsObj.buy) ?? 0));
    hold = Math.max(0, Math.round(parseNum(ratingsObj.hold) ?? 0));
    sell = Math.max(0, Math.round(parseNum(ratingsObj.sell) ?? 0));
    strongSell = Math.max(0, Math.round(parseNum(ratingsObj.strongSell) ?? 0));
    if (!ratingLabel && typeof ratingsObj.rating === "string") {
      ratingLabel = ratingsObj.rating.trim();
    }
  }

  // Live Nasdaq /targetprice exposes consensusOverview: { buy, hold, sell, priceTarget, highPriceTarget, lowPriceTarget }
  if (overview && strongBuy + buy + hold + sell + strongSell === 0) {
    buy = Math.max(0, Math.round(parseNum(overview.buy) ?? 0));
    hold = Math.max(0, Math.round(parseNum(overview.hold) ?? 0));
    sell = Math.max(0, Math.round(parseNum(overview.sell) ?? 0));
  }

  // Also parse broker recommendations matrix if summary uses table rows
  const recRows = (data?.brokerRecommendations as { rows?: unknown[] } | undefined)?.rows;
  if (Array.isArray(recRows) && strongBuy + buy + hold + sell + strongSell === 0) {
    for (const r of recRows) {
      if (!r || typeof r !== "object") continue;
      const row = r as Record<string, unknown>;
      const type = String(row.recommendation ?? row.rating ?? "").toLowerCase();
      const current = parseNum(row.current ?? row.count ?? row.month1) ?? 0;
      if (type.includes("strong buy")) strongBuy += Math.round(current);
      else if (type === "buy") buy += Math.round(current);
      else if (type.includes("hold")) hold += Math.round(current);
      else if (type.includes("strong sell")) strongSell += Math.round(current);
      else if (type.includes("sell")) sell += Math.round(current);
    }
  }

  const targetMean = parseNum(
    overview?.priceTarget ??
      targetData?.meanTargetPrice ??
      targetData?.consensusTargetPrice ??
      targetData?.medianTarget,
  );
  const targetHigh = parseNum(
    overview?.highPriceTarget ?? targetData?.highTargetPrice ?? targetData?.highTarget,
  );
  const targetLow = parseNum(
    overview?.lowPriceTarget ?? targetData?.lowTargetPrice ?? targetData?.lowTarget,
  );

  const totalBuy = strongBuy + buy;
  const totalSell = sell + strongSell;
  const count = totalBuy + hold + totalSell;

  if (!count && targetMean === null && !ratingLabel) return null;

  if (!ratingLabel && count > 0) {
    const score = (totalBuy - totalSell) / count;
    ratingLabel = score >= 0.45 ? "Strong Buy" : score >= 0.15 ? "Buy" : score <= -0.15 ? "Sell" : "Hold";
  }

  return {
    ticker: ticker.toUpperCase(),
    consensus: count > 0 || targetMean !== null
      ? {
          ratingLabel: ratingLabel || "Hold",
          buy: totalBuy,
          hold,
          sell: totalSell,
          analystCount: count,
          targetLow,
          targetMean,
          targetHigh,
        }
      : null,
    targetMean,
    targetHigh,
    targetLow,
  };
}

const nasdaqAnalystCache = new Map<string, { expiresAt: number; value: NasdaqAnalystSummary | null }>();
const historicalPeCache = new Map<
  string,
  { expiresAt: number; value: { historicalMedianPe: number | null; peVsHistoryPct: number | null } | null }
>();

export async function fetchNasdaqAnalystData(
  ticker: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<NasdaqAnalystSummary | null> {
  const clean = ticker.replace(/\.[A-Z]+$/, "").trim().toUpperCase();
  if (!clean || ticker.includes(".")) return null;
  const cached = nasdaqAnalystCache.get(clean);
  if (cached && cached.expiresAt > now) return cached.value;

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    Accept: "application/json",
    Origin: "https://www.nasdaq.com",
    Referer: "https://www.nasdaq.com/",
  };

  try {
    const [rRes, tRes] = await Promise.all([
      fetcher(`https://api.nasdaq.com/api/analyst/${encodeURIComponent(clean)}/ratings`, {
        headers,
        signal: AbortSignal.timeout(4_500),
      }),
      fetcher(`https://api.nasdaq.com/api/analyst/${encodeURIComponent(clean)}/targetprice`, {
        headers,
        signal: AbortSignal.timeout(4_500),
      }),
    ]);
    const rJson = rRes.ok ? await rRes.json().catch(() => null) : null;
    const tJson = tRes.ok ? await tRes.json().catch(() => null) : null;
    const value = parseNasdaqAnalystRatings(clean, rJson, tJson);
    const ttl = rRes.ok || tRes.ok ? 3_600_000 : 300_000;
    setBoundedCache(nasdaqAnalystCache, clean, { expiresAt: now + ttl, value }, 250);
    return value;
  } catch {
    setBoundedCache(nasdaqAnalystCache, clean, { expiresAt: now + 300_000, value: null }, 250);
    return null;
  }
}

interface XbrlFactItem {
  form?: string;
  fp?: string;
  frame?: string;
  start?: string;
  end?: string;
  filed?: string;
  val?: number;
}

/**
 * Computes genuine multi-year historical P/E median by aligning SEC XBRL annual
 * diluted/basic EPS fiscal-year-end dates against historical Yahoo monthly stock closes.
 * Strictly filters full-year 10-K periods (>= 300 days, fp === "FY", no Q1-Q4 frames)
 * and uses latest restatement filings so split-adjusted Yahoo prices align with post-split EPS.
 */
export async function fetchTrueHistoricalMedianPe(
  ticker: string,
  cik: string | null,
  _currentPrice: number,
  currentForwardPe: number | null,
  fetcher: typeof fetch = fetch,
  nowSec = Math.floor(Date.now() / 1000),
  signal?: AbortSignal,
): Promise<{ historicalMedianPe: number | null; peVsHistoryPct: number | null } | null> {
  const cleanTicker = ticker.trim().toUpperCase();
  const cacheKey = `${cleanTicker}:${cik ?? ""}:${currentForwardPe ?? ""}`;
  const cached = historicalPeCache.get(cacheKey);
  if (cached && cached.expiresAt > nowSec * 1000) return cached.value;

  try {
    const resolvedCik = cik ?? (await resolveSecCik(ticker, SEC_CIK_MAP, fetcher, undefined, signal));
    if (!resolvedCik) return null;

    const padded = resolvedCik.padStart(10, "0");
    const [factsRes, historyRes] = await Promise.allSettled([
      secFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`, {
        fetcher,
        signal,
        headers: { Accept: "application/json" },
        timeoutMs: 5_500,
      }),
      yahooChart(
        { ticker, interval: "1mo", period1: nowSec - 6 * 365 * 86_400, period2: nowSec, extended: false },
        fetcher,
      ),
    ]);

    if (factsRes.status !== "fulfilled" || !factsRes.value.ok) return null;
    const factsJson = (await factsRes.value.json()) as {
      facts?: {
        "us-gaap"?: Record<string, { units?: Record<string, XbrlFactItem[]> }>;
      };
    };

    const gaap = factsJson?.facts?.["us-gaap"];
    const epsUnits =
      gaap?.EarningsPerShareDiluted?.units?.["USD/shares"] ??
      gaap?.EarningsPerShareBasic?.units?.["USD/shares"] ??
      [];
    if (!Array.isArray(epsUnits) || !epsUnits.length) return null;

    // Group annual 10-K facts by end date to pick latest `filed` restatement and detect split restatements
    const byYear = new Map<string, { end: string; val: number; filed: string }>();
    let latestSplitRestatementFiled = "";

    for (const item of epsUnits) {
      if (item.form !== "10-K" || !item.end || typeof item.val !== "number" || item.val <= 0) continue;
      if (item.fp && item.fp !== "FY") continue;
      if (item.frame && /Q[1-4]$/i.test(item.frame)) continue;
      if (item.start) {
        const startMs = Date.parse(`${item.start}T00:00:00Z`);
        const endMs = Date.parse(`${item.end}T00:00:00Z`);
        if (Number.isFinite(startMs) && Number.isFinite(endMs) && (endMs - startMs) / 86_400_000 < 300) {
          continue; // Reject 3M/6M/9M quarterly facts inside 10-K filings
        }
      }

      const yr = item.end.slice(0, 4);
      const filed = item.filed ?? "";
      const prev = byYear.get(yr);
      if (!prev) {
        byYear.set(yr, { end: item.end, val: item.val, filed });
      } else if (item.end > prev.end) {
        byYear.set(yr, { end: item.end, val: item.val, filed });
      } else if (item.end === prev.end && filed >= prev.filed) {
        if (filed > prev.filed && prev.val > 0) {
          const ratio = prev.val / item.val;
          if (ratio > 1.7 || ratio < 0.58) {
            if (filed > latestSplitRestatementFiled) latestSplitRestatementFiled = filed;
          }
        }
        byYear.set(yr, { end: item.end, val: item.val, filed });
      } else if (item.end === prev.end && filed < prev.filed && item.val > 0) {
        const ratio = item.val / prev.val;
        if (ratio > 1.7 || ratio < 0.58) {
          if (prev.filed > latestSplitRestatementFiled) latestSplitRestatementFiled = prev.filed;
        }
      }
    }

    let annual = [...byYear.values()].sort((a, b) => a.end.localeCompare(b.end));
    if (latestSplitRestatementFiled) {
      const splitConsistent = annual.filter((a) => !a.filed || a.filed >= latestSplitRestatementFiled);
      if (splitConsistent.length >= 2) annual = splitConsistent;
    }
    annual = annual.slice(-6);
    if (annual.length < 2) return null;

    const closes = historyRes.status === "fulfilled" ? historyRes.value.bars : [];
    if (!closes.length) return null;
    const pes: number[] = [];

    for (const entry of annual) {
      const targetMs = Date.parse(`${entry.end}T00:00:00Z`);
      if (!Number.isFinite(targetMs) || entry.val <= 0) continue;
      let refPrice: number | null = null;
      let bestDiff = Infinity;
      for (const bar of closes) {
        const diff = Math.abs(bar.time - targetMs);
        if (diff < bestDiff && bar.close > 0) {
          bestDiff = diff;
          refPrice = bar.close;
        }
      }
      // Strictly reject fiscal years without a price-aligned historical close within ~45 days
      if (refPrice === null || bestDiff > 45 * 86_400_000) continue;
      const pe = refPrice / entry.val;
      if (pe > 1 && pe < 200) pes.push(pe);
    }

    if (pes.length < 2) return null;
    pes.sort((a, b) => a - b);
    const mid = Math.floor(pes.length / 2);
    const medianPe = pes.length % 2 === 0 ? (pes[mid - 1] + pes[mid]) / 2 : pes[mid];
    const historicalMedianPe = Number(medianPe.toFixed(1));
    const peVsHistoryPct =
      currentForwardPe && currentForwardPe > 0 && historicalMedianPe > 0
        ? Number((((currentForwardPe - historicalMedianPe) / historicalMedianPe) * 100).toFixed(1))
        : null;

    const result = { historicalMedianPe, peVsHistoryPct };
    setBoundedCache(historicalPeCache, cacheKey, { expiresAt: nowSec * 1000 + 1_800_000, value: result }, 250);
    return result;
  } catch {
    return null;
  }
}

const FRED_SERIES: Array<{ id: string; label: string; unit: string }> = [
  { id: "FEDFUNDS", label: "Fed Funds Effective", unit: "%" },
  { id: "T10Y2Y", label: "US 10Y-2Y Spread", unit: "%" },
  { id: "BAMLH0A0HYM2", label: "US High Yield OAS", unit: "%" },
  { id: "VIXCLS", label: "CBOE VIX Index", unit: "pts" },
  { id: "DCOILWTICO", label: "WTI Crude Spot", unit: "$" },
];

const CROSS_ASSETS: Array<{ ticker: string; symbol: string; label: string }> = [
  { ticker: "^GSPC", symbol: "YF:^GSPC", label: "S&P 500" },
  { ticker: "^IXIC", symbol: "YF:^IXIC", label: "NASDAQ" },
  { ticker: "^GDAXI", symbol: "YF:^GDAXI", label: "DAX 40" },
  { ticker: "^VIX", symbol: "YF:^VIX", label: "VIX" },
  { ticker: "^TNX", symbol: "YF:^TNX", label: "US 10Y" },
  { ticker: "BZ=F", symbol: "YF:BZ=F", label: "Brent Oil" },
  { ticker: "CL=F", symbol: "YF:CL=F", label: "WTI Oil" },
  { ticker: "GC=F", symbol: "YF:GC=F", label: "Gold" },
  { ticker: "BTC-USD", symbol: "BTCUSDT", label: "Bitcoin" },
];

let macroPulseCache: { expiresAt: number; payload: GlobalMacroPulse } | null = null;

export function clearMacroPulseCache(): void {
  macroPulseCache = null;
  nasdaqAnalystCache.clear();
  historicalPeCache.clear();
}

export async function fetchGlobalMacroPulse(
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<GlobalMacroPulse> {
  if (macroPulseCache && macroPulseCache.expiresAt > now) {
    return macroPulseCache.payload;
  }

  const nowSec = Math.floor(now / 1000);
  const [fredResults, fngRes, assetResults] = await Promise.all([
    Promise.allSettled(
      FRED_SERIES.map((s) =>
        fetcher(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${s.id}`, {
          headers: { "User-Agent": "AffenTerminal/1.0" },
          signal: AbortSignal.timeout(5_500),
        }).then(async (r) => (r.ok ? parseFredCsv(await r.text(), s.id, s.label, s.unit) : null)),
      ),
    ),
    fetcher("https://api.alternative.me/fng/?limit=7", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4_500),
    }).catch(() => null),
    Promise.allSettled(
      CROSS_ASSETS.map(async (a) => {
        const res = await yahooChart(
          { ticker: a.ticker, interval: "1d", period1: nowSec - 10 * 86_400, period2: nowSec, extended: false },
          fetcher,
        );
        const last = res.bars.at(-1);
        const prev = res.bars.length >= 2 ? res.bars[res.bars.length - 2] : undefined;
        const price = last?.close ?? res.meta.price ?? 0;
        const ref = prev?.close ?? res.meta.previousClose ?? price;
        const changePct = ref > 0 ? Number((((price - ref) / ref) * 100).toFixed(2)) : 0;
        if (!(price > 0)) return null;
        return { symbol: a.symbol, label: a.label, price: Number(price.toFixed(2)), changePct };
      }),
    ),
  ]);

  const fred = fredResults
    .filter((r): r is PromiseFulfilledResult<FredMacroPoint | null> => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value!);

  const fngJson = fngRes && fngRes.ok ? await fngRes.json().catch(() => null) : null;
  const fearGreedHistory = parseFearGreedPayload(fngJson);

  const crossAssets = assetResults
    .filter((r): r is PromiseFulfilledResult<CrossAssetQuote | null> => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value!);

  const payload: GlobalMacroPulse = {
    updatedAt: now,
    fred,
    fearGreed: fearGreedHistory[0] ?? null,
    fearGreedHistory,
    crossAssets,
  };
  if (fred.length > 0 || fearGreedHistory.length > 0 || crossAssets.length > 0) {
    macroPulseCache = { expiresAt: now + 120_000, payload };
  }
  return payload;
}
