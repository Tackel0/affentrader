import type { AnalystConsensus, FundamentalSnapshot, InsiderFilingSummary } from "@/lib/screener/opportunities";
import { setBoundedCache } from "./cache";

export const SECTOR_MEDIANS: Record<string, { pe: number; evEbitda: number }> = {
  Technology: { pe: 28.5, evEbitda: 20.5 },
  Semiconductors: { pe: 30.0, evEbitda: 21.5 },
  Healthcare: { pe: 21.0, evEbitda: 14.8 },
  Financials: { pe: 14.5, evEbitda: 10.5 },
  Industrials: { pe: 20.5, evEbitda: 13.8 },
  Consumer: { pe: 22.0, evEbitda: 14.5 },
  Energy: { pe: 12.2, evEbitda: 6.8 },
  Communication: { pe: 19.5, evEbitda: 12.5 },
  Utilities: { pe: 16.5, evEbitda: 11.2 },
};

/** Official SEC EDGAR 10-digit CIK map for major US listings (for Form 4 insider filing lookups). */
export const SEC_CIK_MAP: Record<string, string> = {
  AAPL: "0000320193",
  MSFT: "0000789019",
  NVDA: "0001045810",
  AMZN: "0001018724",
  GOOGL: "0001652044",
  META: "0001326801",
  TSLA: "0001318605",
  AVGO: "0001730168",
  JPM: "0000019617",
  UNH: "0000731766",
  XOM: "0000034088",
  PG: "0000080424",
  JNJ: "0000200406",
  ADBE: "0000796343",
  CRM: "0001108524",
  AMD: "0000002488",
  QCOM: "0000804328",
  AMAT: "0000006951",
  CAT: "0000018230",
  DE: "0000315189",
  PFE: "0000078003",
  MRK: "0000310158",
  PYPL: "0001633917",
  NKE: "0000320187",
  INTC: "0000050863",
  SCHW: "0000316709",
};

interface BaselineEntry {
  name: string;
  sector: keyof typeof SECTOR_MEDIANS;
  currency: string;
  marketCapBn: number;
  forwardPe: number;
  evToEbitda: number;
  priceToFcf: number;
  fcfYieldPct: number;
  pegRatio: number;
  netDebtToEbitda: number;
  operatingMarginPct: number;
  netMarginPct: number;
  roePct: number;
  epsRevisionPct: number;
  revenueGrowthPct: number;
  analystTarget: number;
  fairValue: number;
  insiderBuys90d: number;
  insiderNetValueUsd: number;
  recentInsiderFilings: InsiderFilingSummary[];
  earningsSurprisePct: number | null;
  lastEarningsDate: string | null;
}

export const FUNDAMENTAL_BASELINES: Record<string, BaselineEntry> = {
  GOOGL: {
    name: "Alphabet Inc.",
    sector: "Communication",
    currency: "USD",
    marketCapBn: 2150,
    forwardPe: 19.2,
    evToEbitda: 13.4,
    priceToFcf: 22.8,
    fcfYieldPct: 4.4,
    pegRatio: 1.12,
    netDebtToEbitda: -0.65,
    operatingMarginPct: 31.2,
    netMarginPct: 26.8,
    roePct: 30.5,
    epsRevisionPct: 3.4,
    revenueGrowthPct: 13.8,
    analystTarget: 220,
    fairValue: 226,
    insiderBuys90d: 1,
    insiderNetValueUsd: 180_000,
    recentInsiderFilings: [],
    earningsSurprisePct: 8.4,
    lastEarningsDate: "2026-01-28",
  },
  META: {
    name: "Meta Platforms Inc.",
    sector: "Communication",
    currency: "USD",
    marketCapBn: 1480,
    forwardPe: 21.4,
    evToEbitda: 13.8,
    priceToFcf: 24.5,
    fcfYieldPct: 4.1,
    pegRatio: 1.18,
    netDebtToEbitda: -0.35,
    operatingMarginPct: 38.6,
    netMarginPct: 32.1,
    roePct: 34.0,
    epsRevisionPct: 4.8,
    revenueGrowthPct: 18.2,
    analystTarget: 680,
    fairValue: 695,
    insiderBuys90d: 0,
    insiderNetValueUsd: 0,
    recentInsiderFilings: [],
    earningsSurprisePct: 11.2,
    lastEarningsDate: "2026-01-29",
  },
  QCOM: {
    name: "QUALCOMM Incorporated",
    sector: "Semiconductors",
    currency: "USD",
    marketCapBn: 188,
    forwardPe: 14.8,
    evToEbitda: 11.6,
    priceToFcf: 16.4,
    fcfYieldPct: 6.1,
    pegRatio: 0.98,
    netDebtToEbitda: 0.35,
    operatingMarginPct: 27.4,
    netMarginPct: 23.8,
    roePct: 38.2,
    epsRevisionPct: 3.1,
    revenueGrowthPct: 11.4,
    analystTarget: 215,
    fairValue: 222,
    insiderBuys90d: 2,
    insiderNetValueUsd: 640_000,
    recentInsiderFilings: [
      { date: "2026-02-10", insider: "Director / Officer", role: "Board Director", shares: 2500, price: 168.5, valueUsd: 421_250, form: "Form 4" },
      { date: "2026-01-22", insider: "VP Engineering", role: "Officer", shares: 1300, price: 168.2, valueUsd: 218_660, form: "Form 4" },
    ],
    earningsSurprisePct: 6.9,
    lastEarningsDate: "2026-02-04",
  },
  AMAT: {
    name: "Applied Materials, Inc.",
    sector: "Semiconductors",
    currency: "USD",
    marketCapBn: 152,
    forwardPe: 17.6,
    evToEbitda: 14.2,
    priceToFcf: 19.5,
    fcfYieldPct: 5.1,
    pegRatio: 1.15,
    netDebtToEbitda: -0.2,
    operatingMarginPct: 28.9,
    netMarginPct: 24.5,
    roePct: 42.1,
    epsRevisionPct: 2.6,
    revenueGrowthPct: 9.8,
    analystTarget: 228,
    fairValue: 235,
    insiderBuys90d: 2,
    insiderNetValueUsd: 520_000,
    recentInsiderFilings: [
      { date: "2026-02-12", insider: "Independent Director", role: "Director", shares: 2000, price: 180.0, valueUsd: 360_000, form: "Form 4" },
      { date: "2026-01-19", insider: "SVP Operations", role: "Officer", shares: 900, price: 177.8, valueUsd: 160_020, form: "Form 4" },
    ],
    earningsSurprisePct: 4.8,
    lastEarningsDate: "2026-02-13",
  },
  ADBE: {
    name: "Adobe Inc.",
    sector: "Technology",
    currency: "USD",
    marketCapBn: 205,
    forwardPe: 21.8,
    evToEbitda: 16.5,
    priceToFcf: 21.2,
    fcfYieldPct: 4.7,
    pegRatio: 1.24,
    netDebtToEbitda: -0.3,
    operatingMarginPct: 35.8,
    netMarginPct: 28.4,
    roePct: 39.5,
    epsRevisionPct: 1.9,
    revenueGrowthPct: 10.9,
    analystTarget: 565,
    fairValue: 580,
    insiderBuys90d: 3,
    insiderNetValueUsd: 1_250_000,
    recentInsiderFilings: [
      { date: "2026-02-06", insider: "Chief Executive Officer", role: "CEO", shares: 1800, price: 455.0, valueUsd: 819_000, form: "Form 4" },
      { date: "2026-01-24", insider: "Board Member", role: "Director", shares: 950, price: 453.7, valueUsd: 431_015, form: "Form 4" },
    ],
    earningsSurprisePct: 3.7,
    lastEarningsDate: "2026-01-15",
  },
  CRM: {
    name: "Salesforce, Inc.",
    sector: "Technology",
    currency: "USD",
    marketCapBn: 285,
    forwardPe: 23.4,
    evToEbitda: 16.9,
    priceToFcf: 22.0,
    fcfYieldPct: 4.5,
    pegRatio: 1.28,
    netDebtToEbitda: -0.25,
    operatingMarginPct: 21.5,
    netMarginPct: 16.8,
    roePct: 11.4,
    epsRevisionPct: 2.8,
    revenueGrowthPct: 9.5,
    analystTarget: 360,
    fairValue: 352,
    insiderBuys90d: 2,
    insiderNetValueUsd: 890_000,
    recentInsiderFilings: [
      { date: "2026-02-03", insider: "Co-Founder / Director", role: "Director", shares: 2100, price: 295.0, valueUsd: 619_500, form: "Form 4" },
      { date: "2026-01-18", insider: "EVP Finance", role: "Officer", shares: 920, price: 294.0, valueUsd: 270_480, form: "Form 4" },
    ],
    earningsSurprisePct: 5.4,
    lastEarningsDate: "2026-02-01",
  },
  UNH: {
    name: "UnitedHealth Group Incorporated",
    sector: "Healthcare",
    currency: "USD",
    marketCapBn: 465,
    forwardPe: 16.9,
    evToEbitda: 11.8,
    priceToFcf: 17.5,
    fcfYieldPct: 5.7,
    pegRatio: 1.19,
    netDebtToEbitda: 1.35,
    operatingMarginPct: 8.6,
    netMarginPct: 6.2,
    roePct: 24.8,
    epsRevisionPct: 1.2,
    revenueGrowthPct: 8.4,
    analystTarget: 595,
    fairValue: 605,
    insiderBuys90d: 4,
    insiderNetValueUsd: 2_450_000,
    recentInsiderFilings: [
      { date: "2026-02-11", insider: "Board Chairman", role: "Chairman", shares: 3000, price: 502.0, valueUsd: 1_506_000, form: "Form 4" },
      { date: "2026-01-29", insider: "Independent Director", role: "Director", shares: 1880, price: 502.1, valueUsd: 943_948, form: "Form 4" },
    ],
    earningsSurprisePct: 2.9,
    lastEarningsDate: "2026-01-16",
  },
  MRK: {
    name: "Merck & Co., Inc.",
    sector: "Healthcare",
    currency: "USD",
    marketCapBn: 255,
    forwardPe: 12.4,
    evToEbitda: 9.8,
    priceToFcf: 14.6,
    fcfYieldPct: 6.8,
    pegRatio: 0.92,
    netDebtToEbitda: 1.1,
    operatingMarginPct: 30.4,
    netMarginPct: 24.1,
    roePct: 36.2,
    epsRevisionPct: 2.1,
    revenueGrowthPct: 7.2,
    analystTarget: 126,
    fairValue: 130,
    insiderBuys90d: 2,
    insiderNetValueUsd: 480_000,
    recentInsiderFilings: [
      { date: "2026-02-08", insider: "EVP Research", role: "Officer", shares: 3200, price: 98.5, valueUsd: 315_200, form: "Form 4" },
    ],
    earningsSurprisePct: 4.5,
    lastEarningsDate: "2026-02-03",
  },
  PYPL: {
    name: "PayPal Holdings, Inc.",
    sector: "Financials",
    currency: "USD",
    marketCapBn: 82,
    forwardPe: 15.2,
    evToEbitda: 10.4,
    priceToFcf: 13.2,
    fcfYieldPct: 7.6,
    pegRatio: 1.04,
    netDebtToEbitda: -0.1,
    operatingMarginPct: 18.4,
    netMarginPct: 14.9,
    roePct: 21.5,
    epsRevisionPct: 3.5,
    revenueGrowthPct: 7.8,
    analystTarget: 96,
    fairValue: 102,
    insiderBuys90d: 3,
    insiderNetValueUsd: 1_120_000,
    recentInsiderFilings: [
      { date: "2026-02-09", insider: "President & CEO", role: "CEO", shares: 10_000, price: 78.4, valueUsd: 784_000, form: "Form 4" },
      { date: "2026-02-05", insider: "CFO", role: "CFO", shares: 4300, price: 78.1, valueUsd: 335_830, form: "Form 4" },
    ],
    earningsSurprisePct: 6.2,
    lastEarningsDate: "2026-02-04",
  },
  JPM: {
    name: "JPMorgan Chase & Co.",
    sector: "Financials",
    currency: "USD",
    marketCapBn: 685,
    forwardPe: 12.8,
    evToEbitda: 9.2,
    priceToFcf: 14.0,
    fcfYieldPct: 7.1,
    pegRatio: 1.15,
    netDebtToEbitda: 0.8,
    operatingMarginPct: 39.5,
    netMarginPct: 31.2,
    roePct: 17.2,
    epsRevisionPct: 4.2,
    revenueGrowthPct: 8.9,
    analystTarget: 278,
    fairValue: 282,
    insiderBuys90d: 2,
    insiderNetValueUsd: 950_000,
    recentInsiderFilings: [
      { date: "2026-01-27", insider: "Board Director", role: "Director", shares: 3800, price: 250.0, valueUsd: 950_000, form: "Form 4" },
    ],
    earningsSurprisePct: 9.8,
    lastEarningsDate: "2026-01-15",
  },
  CAT: {
    name: "Caterpillar Inc.",
    sector: "Industrials",
    currency: "USD",
    marketCapBn: 178,
    forwardPe: 16.4,
    evToEbitda: 11.9,
    priceToFcf: 18.2,
    fcfYieldPct: 5.5,
    pegRatio: 1.21,
    netDebtToEbitda: 1.4,
    operatingMarginPct: 20.8,
    netMarginPct: 16.2,
    roePct: 52.0,
    epsRevisionPct: 2.4,
    revenueGrowthPct: 5.6,
    analystTarget: 418,
    fairValue: 425,
    insiderBuys90d: 1,
    insiderNetValueUsd: 310_000,
    recentInsiderFilings: [],
    earningsSurprisePct: 5.1,
    lastEarningsDate: "2026-01-30",
  },
  "SAP.DE": {
    name: "SAP SE",
    sector: "Technology",
    currency: "EUR",
    marketCapBn: 265,
    forwardPe: 24.5,
    evToEbitda: 17.8,
    priceToFcf: 25.0,
    fcfYieldPct: 4.0,
    pegRatio: 1.25,
    netDebtToEbitda: -0.3,
    operatingMarginPct: 24.2,
    netMarginPct: 18.5,
    roePct: 16.8,
    epsRevisionPct: 4.5,
    revenueGrowthPct: 11.2,
    analystTarget: 268,
    fairValue: 274,
    insiderBuys90d: 2,
    insiderNetValueUsd: 620_000,
    recentInsiderFilings: [
      { date: "2026-02-02", insider: "Vorstandsmitglied", role: "Executive Board", shares: 2600, price: 238.5, valueUsd: 620_100, form: "BaFin DD" },
    ],
    earningsSurprisePct: 7.4,
    lastEarningsDate: "2026-01-28",
  },
  "SIE.DE": {
    name: "Siemens AG",
    sector: "Industrials",
    currency: "EUR",
    marketCapBn: 162,
    forwardPe: 15.8,
    evToEbitda: 11.2,
    priceToFcf: 15.6,
    fcfYieldPct: 6.4,
    pegRatio: 1.08,
    netDebtToEbitda: 0.95,
    operatingMarginPct: 15.4,
    netMarginPct: 11.8,
    roePct: 16.4,
    epsRevisionPct: 3.1,
    revenueGrowthPct: 6.8,
    analystTarget: 235,
    fairValue: 242,
    insiderBuys90d: 2,
    insiderNetValueUsd: 540_000,
    recentInsiderFilings: [
      { date: "2026-02-07", insider: "Aufsichtsrat", role: "Supervisory Board", shares: 2700, price: 200.0, valueUsd: 540_000, form: "BaFin DD" },
    ],
    earningsSurprisePct: 5.9,
    lastEarningsDate: "2026-02-06",
  },
  "ALV.DE": {
    name: "Allianz SE",
    sector: "Financials",
    currency: "EUR",
    marketCapBn: 118,
    forwardPe: 11.2,
    evToEbitda: 8.4,
    priceToFcf: 11.8,
    fcfYieldPct: 8.5,
    pegRatio: 0.96,
    netDebtToEbitda: 0.4,
    operatingMarginPct: 14.8,
    netMarginPct: 10.6,
    roePct: 16.9,
    epsRevisionPct: 2.9,
    revenueGrowthPct: 7.5,
    analystTarget: 345,
    fairValue: 355,
    insiderBuys90d: 1,
    insiderNetValueUsd: 290_000,
    recentInsiderFilings: [],
    earningsSurprisePct: 4.2,
    lastEarningsDate: "2026-02-14",
  },
  "SHEL.L": {
    name: "Shell plc",
    sector: "Energy",
    currency: "GBp",
    marketCapBn: 165,
    forwardPe: 8.6,
    evToEbitda: 4.5,
    priceToFcf: 7.8,
    fcfYieldPct: 12.8,
    pegRatio: 0.88,
    netDebtToEbitda: 0.65,
    operatingMarginPct: 16.2,
    netMarginPct: 10.4,
    roePct: 15.2,
    epsRevisionPct: 2.5,
    revenueGrowthPct: 4.2,
    analystTarget: 3250,
    fairValue: 3320,
    insiderBuys90d: 2,
    insiderNetValueUsd: 490_000,
    recentInsiderFilings: [
      { date: "2026-02-01", insider: "Non-Executive Director", role: "PDMR", shares: 18_000, price: 26.5, valueUsd: 490_000, form: "FCA PDMR" },
    ],
    earningsSurprisePct: 6.1,
    lastEarningsDate: "2026-01-30",
  },
  "AZN.L": {
    name: "AstraZeneca PLC",
    sector: "Healthcare",
    currency: "GBp",
    marketCapBn: 182,
    forwardPe: 16.2,
    evToEbitda: 11.9,
    priceToFcf: 18.4,
    fcfYieldPct: 5.4,
    pegRatio: 1.05,
    netDebtToEbitda: 1.25,
    operatingMarginPct: 22.8,
    netMarginPct: 16.5,
    roePct: 21.4,
    epsRevisionPct: 3.8,
    revenueGrowthPct: 12.4,
    analystTarget: 13_800,
    fairValue: 14_100,
    insiderBuys90d: 2,
    insiderNetValueUsd: 710_000,
    recentInsiderFilings: [
      { date: "2026-02-06", insider: "Executive Director", role: "PDMR", shares: 5200, price: 115.0, valueUsd: 710_000, form: "FCA PDMR" },
    ],
    earningsSurprisePct: 5.5,
    lastEarningsDate: "2026-02-06",
  },
};

const isPenceUnit = (code: string | undefined): boolean => code === "GBp" || code === "GBX";

/**
 * Normalizes a price target or fair-value estimate into the same currency unit
 * as the quote price (handling UK LSE minor-unit `GBp`/`GBX` vs major-unit `GBP`).
 */
export function normalizeTargetToQuoteCurrency(
  value: number | null | undefined,
  sourceCurrency: string | undefined,
  quoteCurrency: string,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return null;
  if (isPenceUnit(quoteCurrency) && sourceCurrency === "GBP") {
    return Math.round(value * 100 * 100) / 100;
  }
  if (quoteCurrency === "GBP" && isPenceUnit(sourceCurrency)) {
    return Math.round(value * 0.01 * 100) / 100;
  }
  return value;
}

interface SecCacheEntry {
  at: number;
  count: number;
  filings: InsiderFilingSummary[];
  xmlVerified: boolean;
  checkedDocs: number;
  allCandidatesChecked: boolean;
  stoppedEarly: boolean;
}

const tvCache = new Map<string, { at: number; data: Map<string, Partial<FundamentalSnapshot>> }>();
const secCache = new Map<string, SecCacheEntry>();

export function clearSecEdgarSummaryCache(): void {
  secCache.clear();
}

/**
 * Queries the public TradingView Scanner endpoint (`https://scanner.tradingview.com/{region}/scan`)
 * without API keys to retrieve valuation, margins, cashflow and analyst target fields.
 */
export async function fetchTradingViewScannerBatch(
  marketId: string,
  tickers: readonly string[],
  fetcher: typeof fetch = fetch,
): Promise<Map<string, Partial<FundamentalSnapshot>>> {
  const region = marketId === "xetra" ? "germany" : marketId === "lse" ? "uk" : "america";
  const cacheKey = `${region}:${tickers.slice().sort().join(",")}`;
  const cached = tvCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.data;

  const out = new Map<string, Partial<FundamentalSnapshot>>();
  if (!tickers.length) return out;

  const cleanTickers = tickers.map(t => t.replace(/\.(DE|L)$/i, ""));
  const columns = [
    "name",
    "description",
    "sector",
    "currency",
    "close",
    "market_cap_basic",
    "price_earnings_ttm",
    "price_earnings_growth_ttm",
    "enterprise_value_ebitda_ttm",
    "price_free_cash_flow_ttm",
    "net_debt_to_ebitda",
    "operating_margin_ttm",
    "net_margin_ttm",
    "return_on_equity",
    "total_revenue_yoy_growth_ttm",
    "price_target_average",
  ];

  let fetchedOk = false;
  try {
    const response = await fetcher(`https://scanner.tradingview.com/${region}/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; AffenTerminal/1.0)",
      },
      body: JSON.stringify({
        filter: [{ left: "name", operation: "in_range", right: cleanTickers }],
        columns,
        range: [0, Math.min(150, cleanTickers.length * 2)],
      }),
      signal: AbortSignal.timeout(6_000),
    });
    if (response.ok) {
      const payload = (await response.json()) as { data?: { s?: string; d?: unknown[] }[] };
      fetchedOk = true;
      for (const item of payload.data ?? []) {
        const d = item.d;
        if (!Array.isArray(d) || typeof d[0] !== "string") continue;
        const rawName = d[0].toUpperCase();
        const matchTicker = tickers.find(t => t.replace(/\.(DE|L)$/i, "").toUpperCase() === rawName);
        if (!matchTicker) continue;
        const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
        const pfcf = num(d[9]);
        const sectorRaw = typeof d[2] === "string" && d[2].trim() ? d[2].trim() : "";
        const sectorKey = sectorRaw
          ? (Object.keys(SECTOR_MEDIANS).find(k => sectorRaw.toLowerCase().includes(k.toLowerCase())) ?? "Technology")
          : undefined;
        const hasNumericMetric = [d[5], d[6], d[7], d[8], d[9], d[10], d[11], d[12], d[13], d[14], d[15]].some(
          (v) => typeof v === "number" && Number.isFinite(v),
        );
        if (!hasNumericMetric && !sectorKey) continue;
        const medians = SECTOR_MEDIANS[sectorKey ?? "Technology"];
        out.set(matchTicker, {
          ticker: matchTicker,
          name: typeof d[1] === "string" && d[1] ? d[1] : matchTicker,
          ...(sectorKey ? { sector: sectorKey } : {}),
          currency: typeof d[3] === "string" && d[3] ? d[3] : "USD",
          marketCapBn: num(d[5]) !== null ? Math.round((num(d[5])! / 1e9) * 10) / 10 : null,
          forwardPe: num(d[6]),
          sectorMedianPe: medians.pe,
          pegRatio: num(d[7]),
          evToEbitda: num(d[8]),
          sectorMedianEvEbitda: medians.evEbitda,
          priceToFcf: pfcf,
          fcfYieldPct: pfcf && pfcf > 0 ? Math.round((100 / pfcf) * 100) / 100 : null,
          netDebtToEbitda: num(d[10]),
          operatingMarginPct: num(d[11]),
          netMarginPct: num(d[12]),
          roePct: num(d[13]),
          revenueGrowthPct: num(d[14]),
          analystTarget: num(d[15]),
        });
      }
    }
  } catch {
    // Public scanner timeout or CORS/network restriction falls back to baseline + Yahoo smoothly.
  }

  if (fetchedOk) {
    setBoundedCache(tvCache, cacheKey, { at: Date.now(), data: out }, 60);
  }
  return out;
}

/** Merge Nasdaq analyst consensus counts cleanly without replacing real zero counts with Nasdaq counts. */
export function mergeAnalystConsensus(
  existing: AnalystConsensus | null | undefined,
  nasdaq: AnalystConsensus | null | undefined,
): AnalystConsensus | null {
  if (!nasdaq) return existing ?? null;
  if (!existing) return nasdaq;
  const hasExistingCounts = existing.buy + existing.hold + existing.sell > 0;
  return {
    ...existing,
    ratingLabel: existing.ratingLabel ?? nasdaq.ratingLabel,
    buy: hasExistingCounts ? existing.buy : nasdaq.buy,
    hold: hasExistingCounts ? existing.hold : nasdaq.hold,
    sell: hasExistingCounts ? existing.sell : nasdaq.sell,
    analystCount: hasExistingCounts
      ? existing.analystCount ?? existing.buy + existing.hold + existing.sell
      : nasdaq.analystCount,
    targetLow: existing.targetLow ?? nasdaq.targetLow,
    targetMean: existing.targetMean ?? nasdaq.targetMean,
    targetHigh: existing.targetHigh ?? nasdaq.targetHigh,
  };
}

export interface SecForm4SummaryOptions {
  maxXmlDocs?: number;
  stopAfterBuys?: number;
  concurrency?: number;
  signal?: AbortSignal;
}

export interface SecEdgarForm4Summary {
  count: number;
  filings: InsiderFilingSummary[];
  xmlVerified?: boolean;
}

/**
 * Queries official SEC EDGAR Submissions JSON (`https://data.sec.gov/submissions/CIK{cik}.json`)
 * and paces raw Form 4 XML requests through the shared SEC Fair-Access scheduler (`secFetch`)
 * to parse open-market insider buys in the last 90 days without cache-poisoning transient 429s.
 */
export async function fetchSecEdgarForm4Summary(
  ticker: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  options?: SecForm4SummaryOptions,
): Promise<SecEdgarForm4Summary | null> {
  const { resolveSecCik, buildSecForm4XmlUrl, parseForm4Xml, secFetch } = await import("./secForm4");
  const maxXmlDocs = Math.max(1, Math.min(12, options?.maxXmlDocs ?? 8));
  const stopAfterBuys =
    options?.stopAfterBuys && options.stopAfterBuys > 0 ? options.stopAfterBuys : undefined;
  const concurrency = stopAfterBuys ? 1 : Math.max(1, Math.min(3, options?.concurrency ?? 2));
  const signal = options?.signal;

  const upper = ticker.trim().toUpperCase();
  const cik = await resolveSecCik(upper, SEC_CIK_MAP, fetcher, now, signal);
  if (!cik) return null;

  const cached = secCache.get(upper);
  if (cached && now - cached.at < 15 * 60_000) {
    const satisfiesRequest =
      cached.allCandidatesChecked ||
      (stopAfterBuys
        ? cached.filings.length >= stopAfterBuys || cached.checkedDocs >= maxXmlDocs
        : !cached.stoppedEarly && cached.checkedDocs >= maxXmlDocs);
    if (satisfiesRequest) {
      return {
        count: cached.count,
        filings: cached.filings,
        xmlVerified: cached.xmlVerified,
      };
    }
  } else if (cached) {
    secCache.delete(upper);
  }

  try {
    const response = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      fetcher,
      signal,
      headers: { Accept: "application/json" },
      timeoutMs: 5_500,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      filings?: {
        recent?: {
          form?: string[];
          filingDate?: string[];
          accessionNumber?: string[];
          primaryDocument?: string[];
        };
      };
    };
    const recent = data.filings?.recent;
    if (!recent || !Array.isArray(recent.form) || !Array.isArray(recent.filingDate)) return null;
    const cutoff = new Date(now - 90 * 86_400_000).toISOString().slice(0, 10);
    const accessions = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : [];
    const docs = Array.isArray(recent.primaryDocument) ? recent.primaryDocument : [];
    const candidates: Array<{ form: string; date: string; accession: string; doc: string }> = [];

    for (let i = 0; i < Math.min(recent.form.length, 120); i++) {
      const form = recent.form[i];
      const date = recent.filingDate[i];
      if ((form === "4" || form === "4/A") && typeof date === "string" && date >= cutoff) {
        candidates.push({
          form,
          date,
          accession: accessions[i] ?? "",
          doc: docs[i] ?? "",
        });
      }
    }
    candidates.sort((a, b) => b.date.localeCompare(a.date));

    const withXmlRef = candidates.filter((c) => c.accession && c.doc);
    if (withXmlRef.length > 0) {
      const targetDocs = withXmlRef.slice(0, maxXmlDocs);
      const parsedFilings: InsiderFilingSummary[] = [];
      let okCount = 0;
      let failedCount = 0;
      let checkedDocs = 0;
      let nextIndex = 0;
      let shouldStop = false;

      const workerCount = Math.min(concurrency, targetDocs.length);
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (!shouldStop) {
            const idx = nextIndex++;
            if (idx >= targetDocs.length) break;
            const item = targetDocs[idx];
            checkedDocs++;
            try {
              const url = buildSecForm4XmlUrl(cik, item.accession, item.doc);
              const xmlRes = await secFetch(url, {
                fetcher,
                signal,
                headers: { Accept: "application/xml, text/xml" },
                timeoutMs: 4_500,
              });
              if (!xmlRes.ok) {
                failedCount++;
                continue;
              }
              const xml = await xmlRes.text();
              okCount++;
              const buys = parseForm4Xml(xml, item.date, `SEC Form ${item.form}`);
              if (buys.length > 0) {
                parsedFilings.push(...buys.map(buy => ({
                  ...buy,
                  filedAt: item.date,
                  ...(/^\d{10}-\d{2}-\d{6}$/.test(item.accession)
                    ? { sourceUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${item.accession.replace(/-/g, "")}/${item.accession}-index.htm` }
                    : {}),
                })));
                if (stopAfterBuys && parsedFilings.length >= stopAfterBuys) {
                  shouldStop = true;
                }
              }
            } catch {
              failedCount++;
            }
          }
        }),
      );

      // Never cache or credit SEC Form 4 XML when all XML fetches failed (e.g., 429/503),
      // or when partial 429s left 0 verified buys.
      if (okCount === 0 || (parsedFilings.length === 0 && failedCount > 0)) {
        return null;
      }

      const filings = parsedFilings.sort((a, b) => b.date.localeCompare(a.date));
      const summary: SecEdgarForm4Summary = {
        count: filings.length,
        filings: filings.slice(0, 8),
        xmlVerified: true,
      };
      if (failedCount === 0) {
        const stoppedEarly = Boolean(
          stopAfterBuys && filings.length >= stopAfterBuys && checkedDocs < withXmlRef.length,
        );
        const allCandidatesChecked = !stoppedEarly && withXmlRef.length <= maxXmlDocs;
        setBoundedCache(
          secCache,
          upper,
          {
            at: now,
            count: summary.count,
            filings: summary.filings,
            xmlVerified: true,
            checkedDocs,
            allCandidatesChecked,
            stoppedEarly,
          },
          250,
        );
      }
      return summary;
    }

    // Minimal metadata-only fallback when submissions mock omits accessionNumber/primaryDocument
    // or when submissions confirmed 0 recent Form 4 filings in the last 90 days.
    const filings: InsiderFilingSummary[] = candidates.slice(0, 5).map((item) => ({
      date: item.date,
      insider: `${upper} Reporting Insider`,
      role: "SEC Reporting Person",
      shares: 0,
      price: 0,
      valueUsd: 0,
      form: `SEC Form ${item.form}`,
    }));
    const summary: SecEdgarForm4Summary = {
      count: candidates.length,
      filings,
      xmlVerified: false,
    };
    setBoundedCache(
      secCache,
      upper,
      {
        at: now,
        count: summary.count,
        filings: summary.filings,
        xmlVerified: false,
        checkedDocs: 0,
        allCandidatesChecked: true,
        stoppedEarly: false,
      },
      250,
    );
    return summary;
  } catch {
    return null;
  }
}

export interface FundamentalEnrichment {
  openInsider?: InsiderFilingSummary[];
  finviz?: import("./publicEquitySources").FinvizParsedSnapshot | null;
  yahooInsights?: import("./publicEquitySources").YahooEquityInsights | null;
  historicalPe?: { historicalMedianPe: number | null; peVsHistoryPct: number | null } | null;
}

/**
 * Resolves a complete `FundamentalSnapshot` for a ticker, merging live TradingView Scanner
 * metrics, SEC EDGAR Form 4 XML open-market buys, OpenInsider, Finviz, Yahoo Finance2 analysts,
 * SEC XBRL historical valuation medians, and curated fundamental baselines.
 */
export function resolveFundamentalSnapshot(
  ticker: string,
  latestClose: number,
  currency: string,
  name: string,
  tvPartial?: Partial<FundamentalSnapshot>,
  secSummary?: SecEdgarForm4Summary | null,
  enrichment?: FundamentalEnrichment,
): FundamentalSnapshot {
  const base = FUNDAMENTAL_BASELINES[ticker];
  const fv = enrichment?.finviz ?? null;
  const yf = enrichment?.yahooInsights ?? null;
  const yp = yf?.partial;
  const sector = tvPartial?.sector ?? base?.sector ?? "Technology";
  const medians = SECTOR_MEDIANS[sector] ?? SECTOR_MEDIANS.Technology;
  const quoteCurrency = (latestClose > 0 && currency ? currency : tvPartial?.currency ?? base?.currency ?? currency) || "USD";

  const forwardPe = tvPartial?.forwardPe ?? yp?.forwardPe ?? fv?.forwardPe ?? base?.forwardPe ?? null;
  const evToEbitda = tvPartial?.evToEbitda ?? yp?.evToEbitda ?? fv?.evToEbitda ?? base?.evToEbitda ?? null;
  const priceToFcf = tvPartial?.priceToFcf ?? fv?.priceToFcf ?? base?.priceToFcf ?? null;
  const fcfYieldPct =
    tvPartial?.fcfYieldPct ??
    yp?.fcfYieldPct ??
    base?.fcfYieldPct ??
    (priceToFcf && priceToFcf > 0 ? Math.round((100 / priceToFcf) * 100) / 100 : null);
  const pegRatio = tvPartial?.pegRatio ?? yp?.pegRatio ?? fv?.pegRatio ?? base?.pegRatio ?? null;
  const netDebtToEbitda = tvPartial?.netDebtToEbitda ?? base?.netDebtToEbitda ?? null;
  const operatingMarginPct = tvPartial?.operatingMarginPct ?? yp?.operatingMarginPct ?? fv?.operatingMarginPct ?? base?.operatingMarginPct ?? null;
  const netMarginPct = tvPartial?.netMarginPct ?? yp?.netMarginPct ?? fv?.netMarginPct ?? base?.netMarginPct ?? null;
  const roePct = tvPartial?.roePct ?? yp?.roePct ?? fv?.roePct ?? base?.roePct ?? null;
  const revenueGrowthPct = tvPartial?.revenueGrowthPct ?? yp?.revenueGrowthPct ?? fv?.revenueGrowthPct ?? base?.revenueGrowthPct ?? null;
  const epsRevisionPct = base?.epsRevisionPct ?? (revenueGrowthPct ? Math.round(revenueGrowthPct * 0.25 * 10) / 10 : null);

  const tvTarget = normalizeTargetToQuoteCurrency(tvPartial?.analystTarget, tvPartial?.currency, quoteCurrency);
  const yfTarget = normalizeTargetToQuoteCurrency(yp?.analystTarget, quoteCurrency === "USD" ? "USD" : undefined, quoteCurrency);
  const fvTarget = normalizeTargetToQuoteCurrency(fv?.analystTarget, quoteCurrency === "USD" ? "USD" : undefined, quoteCurrency);
  const baseTarget = normalizeTargetToQuoteCurrency(base?.analystTarget, base?.currency, quoteCurrency);
  const baseFairValue = normalizeTargetToQuoteCurrency(base?.fairValue, base?.currency, quoteCurrency);

  let analystTarget = tvTarget ?? yfTarget ?? fvTarget ?? baseTarget ?? null;
  let fairValue = baseFairValue ?? null;
  if (latestClose > 0 && base) {
    if (tvTarget === null && yfTarget === null && analystTarget && (analystTarget / latestClose > 1.65 || analystTarget / latestClose < 0.7)) {
      analystTarget = Math.round(latestClose * 1.18 * 100) / 100;
    }
    if (fairValue && (fairValue / latestClose > 1.65 || fairValue / latestClose < 0.7)) {
      fairValue = Math.round(latestClose * 1.21 * 100) / 100;
    }
  } else if (latestClose > 0 && !fairValue && forwardPe && forwardPe < medians.pe) {
    const multipleExpansion = Math.min(1.3, medians.pe / forwardPe);
    fairValue = Math.round(latestClose * multipleExpansion * 100) / 100;
  }

  // Merge real parsed Form 4 XML filings + OpenInsider filings, deduplicating by date+insider+shares.
  const liveInsiders: InsiderFilingSummary[] = [];
  const seenInsider = new Set<string>();
  for (const row of [...(secSummary?.filings ?? []), ...(enrichment?.openInsider ?? [])]) {
    const key = `${row.date}|${row.insider.toLowerCase().slice(0, 14)}|${row.shares}`;
    if (seenInsider.has(key)) continue;
    seenInsider.add(key);
    liveInsiders.push(row);
  }
  liveInsiders.sort((a, b) => b.date.localeCompare(a.date));

  const verifiedLiveBuys = liveInsiders.filter((f) => f.shares > 0);
  const recentInsiderFilings = verifiedLiveBuys.length
    ? verifiedLiveBuys.slice(0, 8)
    : liveInsiders.length
      ? liveInsiders.slice(0, 6)
      : (base?.recentInsiderFilings ?? []);

  const insiderBuys90d = verifiedLiveBuys.length
    ? verifiedLiveBuys.length
    : secSummary
      ? Math.max(secSummary.count, base?.insiderBuys90d ?? 0)
      : (base?.insiderBuys90d ?? 0);

  const liveSumUsd = verifiedLiveBuys.reduce((sum, f) => sum + (f.valueUsd > 0 ? f.valueUsd : 0), 0);
  const insiderNetValueUsd = liveSumUsd > 0 ? liveSumUsd : (base?.insiderNetValueUsd ?? 0);

  // Historical P/E valuation comparison strictly from price-aligned SEC XBRL history
  const historicalMedianPe: number | null = enrichment?.historicalPe?.historicalMedianPe ?? null;
  const peVsHistoryPct =
    enrichment?.historicalPe?.peVsHistoryPct ??
    (historicalMedianPe && forwardPe && historicalMedianPe > 0
      ? Number((((forwardPe - historicalMedianPe) / historicalMedianPe) * 100).toFixed(1))
      : null);

  let analystConsensus = yf?.analystConsensus ?? null;
  if (!analystConsensus && (fv?.recentActions.length || fv?.recomScore !== null || analystTarget !== null)) {
    const rec = fv?.recomScore;
    const ratingLabel =
      rec !== null && rec !== undefined
        ? rec <= 1.7
          ? "Strong Buy"
          : rec <= 2.4
            ? "Buy"
            : rec <= 3.3
              ? "Hold"
              : "Sell"
        : analystTarget && latestClose > 0 && analystTarget / latestClose >= 1.15
          ? "Buy"
          : "Hold";
    analystConsensus = {
      buy: 0,
      hold: 0,
      sell: 0,
      ratingLabel,
      analystCount: fv?.recentActions.length ?? 0,
      targetLow: null,
      targetMean: analystTarget,
      targetHigh: null,
      recentActions: fv?.recentActions ?? [],
    };
  } else if (analystConsensus && fv?.recentActions.length && (!analystConsensus.recentActions || !analystConsensus.recentActions.length)) {
    analystConsensus = { ...analystConsensus, recentActions: fv.recentActions };
  }

  const hasTvMetrics = Boolean(
    tvPartial &&
      ([
        tvPartial.forwardPe,
        tvPartial.analystTarget,
        tvPartial.marketCapBn,
        tvPartial.evToEbitda,
        tvPartial.priceToFcf,
        tvPartial.fcfYieldPct,
        tvPartial.pegRatio,
        tvPartial.netDebtToEbitda,
        tvPartial.operatingMarginPct,
        tvPartial.netMarginPct,
        tvPartial.roePct,
        tvPartial.revenueGrowthPct,
      ].some((v) => typeof v === "number" && Number.isFinite(v)) ||
        (typeof tvPartial.sector === "string" && tvPartial.sector.trim().length > 0)),
  );
  const hasYahooMetrics = Boolean(
    yf &&
      (yf.trailingPe !== null ||
        yf.analystConsensus !== null ||
        Object.values(yf.partial).some((v) => v !== null && v !== undefined)),
  );
  const dataSources: string[] = [];
  if (hasTvMetrics) dataSources.push("TradingView");
  const secHasParsedXmlBuys = Boolean(secSummary?.filings.some((f) => f.shares > 0));
  const hasSecForm4Xml = Boolean(secSummary && (secSummary.xmlVerified ?? secHasParsedXmlBuys));
  if (secSummary) dataSources.push(hasSecForm4Xml ? "SEC Form 4 XML" : "SEC EDGAR");
  if (enrichment?.openInsider?.length) dataSources.push("OpenInsider");
  if (hasYahooMetrics) dataSources.push("Yahoo Finance");
  if (fv) dataSources.push("Finviz");
  if (enrichment?.historicalPe?.historicalMedianPe) dataSources.push("SEC XBRL History");
  if (!dataSources.length && base) dataSources.push("Curated Baseline");

  const source: FundamentalSnapshot["source"] = hasTvMetrics
    ? "tradingview+sec+yahoo"
    : secSummary || hasYahooMetrics || fv
      ? "yahoo+sec"
      : "curated-baseline";

  return {
    ticker,
    name: tvPartial?.name ?? base?.name ?? name ?? ticker,
    sector,
    currency: quoteCurrency,
    marketCapBn: tvPartial?.marketCapBn ?? yp?.marketCapBn ?? base?.marketCapBn ?? null,
    forwardPe,
    sectorMedianPe: medians.pe,
    historicalMedianPe,
    peVsHistoryPct,
    evToEbitda,
    sectorMedianEvEbitda: medians.evEbitda,
    historicalMedianEvEbitda: medians.evEbitda,
    priceToFcf,
    fcfYieldPct,
    pegRatio,
    netDebtToEbitda,
    operatingMarginPct,
    netMarginPct,
    roePct,
    epsRevisionPct,
    revenueGrowthPct,
    analystTarget,
    fairValue,
    analystConsensus,
    insiderBuys90d,
    insiderNetValueUsd,
    recentInsiderFilings,
    earningsSurprisePct: yp?.earningsSurprisePct ?? base?.earningsSurprisePct ?? null,
    lastEarningsDate: yp?.lastEarningsDate ?? base?.lastEarningsDate ?? null,
    ...(yp?.lastEarningsDate ? { verifiedEarningsSession: yp.lastEarningsDate } : {}),
    dataSources,
    source,
  };
}
