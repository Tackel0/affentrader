import * as cheerio from "cheerio";
import YahooFinance from "yahoo-finance2";
import { setBoundedCache } from "./cache";
import type {
  AnalystConsensus,
  AnalystRatingAction,
  FundamentalSnapshot,
  InsiderFilingSummary,
} from "@/lib/screener/opportunities";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const TTL_MS = 15 * 60_000;
const openInsiderCache = new Map<string, { at: number; filings: InsiderFilingSummary[] }>();
const finvizCache = new Map<string, { at: number; data: FinvizParsedSnapshot | null }>();
const yahooInsightsCache = new Map<string, { at: number; data: YahooEquityInsights | null }>();

let yfClient: InstanceType<typeof YahooFinance> | null = null;
function getYahooClient() {
  if (!yfClient) {
    yfClient = new YahooFinance({
      validation: { logErrors: false },
      suppressNotices: ["yahooSurvey"],
      versionCheck: false,
    });
  }
  return yfClient;
}

export function clearPublicEquityCaches(): void {
  openInsiderCache.clear();
  finvizCache.clear();
  yahooInsightsCache.clear();
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(text: string | undefined): number | null {
  if (!text) return null;
  const clean = text.replace(/[,%$+]/g, "").trim();
  if (!clean || clean === "-" || clean === "N/A") return null;
  const mult = clean.endsWith("B") ? 1e9 : clean.endsWith("M") ? 1e6 : clean.endsWith("K") ? 1e3 : 1;
  const base = mult === 1 ? clean : clean.slice(0, -1);
  const n = Number(base);
  return Number.isFinite(n) ? n * mult : null;
}

/**
 * Pure parser for OpenInsider HTML tables (`<table class="tinytable">`),
 * strictly keeping Purchase (`P - Purchase`) filings across both 17-column
 * `/screener` tables (with `Company Name`) and 12-column ticker tables.
 */
export function parseOpenInsiderHtml(html: string, _ticker: string): InsiderFilingSummary[] {
  if (!html || !html.includes("<table")) return [];
  const $ = cheerio.load(html);
  const table = $("table.tinytable").first();
  const root = table.length ? table : $("table").first();
  if (!root.length) return [];

  const normText = (el: ReturnType<typeof $>): string =>
    el.text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

  const headerMap = new Map<string, number>();
  root.find("tr").first().find("th").each((idx, th) => {
    headerMap.set(normText($(th)).toLowerCase(), idx);
  });

  const out: InsiderFilingSummary[] = [];
  root.find("tr").each((_idx, tr) => {
    const row = $(tr);
    if (row.find("th").length > 0) return;
    const cells = row.find("td").map((_i, td) => normText($(td))).get();
    if (cells.length < 12) return;

    let tradeTypeIdx = headerMap.get("trade type");
    if (tradeTypeIdx === undefined) {
      if (
        cells.length >= 13 &&
        /^(?:P|S|M|A|F|D)\b/i.test(cells[7] ?? "") &&
        !/^(?:P|S|M|A|F|D)\b/i.test(cells[6] ?? "")
      ) {
        tradeTypeIdx = 7;
      } else {
        tradeTypeIdx = 6;
      }
    }
    const shift = tradeTypeIdx - 6;
    const filingDateIdx = headerMap.get("filing date") ?? 1;
    const tradeDateIdx = headerMap.get("trade date") ?? 2;
    const insiderIdx = headerMap.get("insider name") ?? 4 + shift;
    const roleIdx = headerMap.get("title") ?? 5 + shift;
    const priceIdx = headerMap.get("price") ?? 7 + shift;
    const qtyIdx = headerMap.get("qty") ?? 8 + shift;
    const valueIdx = headerMap.get("value") ?? 11 + shift;

    const tradeType = cells[tradeTypeIdx] ?? "";
    if (!/^P\b/i.test(tradeType)) return;

    const date = (cells[tradeDateIdx] || cells[filingDateIdx] || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const insider = cells[insiderIdx] || "Insider";
    const role = cells[roleIdx] || "Officer/Director";
    const price = parseNumber(cells[priceIdx]) ?? 0;
    const shares = Math.abs(Math.round(parseNumber(cells[qtyIdx]) ?? 0));
    const valueUsd = Math.abs(Math.round(parseNumber(cells[valueIdx]) ?? shares * price));
    if (!(shares > 0)) return;
    out.push({
      date,
      insider,
      role,
      shares,
      price: Number(price.toFixed(2)),
      valueUsd,
      form: "OpenInsider P",
    });
  });
  return out;
}

export async function fetchOpenInsiderBuys(
  ticker: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<InsiderFilingSummary[]> {
  const clean = ticker.trim().toUpperCase();
  if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(clean)) return [];
  const cached = openInsiderCache.get(clean);
  if (cached && now - cached.at < TTL_MS) return cached.filings;

  try {
    // OpenInsider serves public screener tables cleanly over HTTP (port 443 times out)
    const url = `http://openinsider.com/screener?s=${encodeURIComponent(clean)}&fd=90&xp=1&xs=0&cnt=20&page=1`;
    const res = await fetcher(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(7_000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const filings = parseOpenInsiderHtml(html, clean).slice(0, 10);
    setBoundedCache(openInsiderCache, clean, { at: now, filings }, 250);
    return filings;
  } catch {
    return [];
  }
}

export interface FinvizParsedSnapshot {
  forwardPe: number | null;
  pegRatio: number | null;
  priceToFcf: number | null;
  evToEbitda: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  roePct: number | null;
  revenueGrowthPct: number | null;
  analystTarget: number | null;
  recomScore: number | null;
  recentActions: AnalystRatingAction[];
}

export function parseFinvizHtml(html: string): FinvizParsedSnapshot | null {
  if (!html || !html.includes("snapshot-table2")) return null;
  const metrics = new Map<string, string>();
  const rowMatches = html.match(/<tr[^>]*class="table-dark-row"[^>]*>([\s\S]*?)<\/tr>/gi) ?? [];
  for (const row of rowMatches) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
    for (let i = 0; i + 1 < cells.length; i += 2) {
      metrics.set(cells[i], cells[i + 1]);
    }
  }
  if (!metrics.size) return null;

  const pToFcf = parseNumber(metrics.get("P/FCF"));
  const recentActions: AnalystRatingAction[] = [];

  // 1) Parse live embedded chartEvent/ratings JSON when present on modern Finviz pages
  const eventRegex = /\{"dateTimestamp":(\d+),"eventType":"chartEvent\/ratings","ratings":(\[[\s\S]*?\])\}/g;
  const embeddedEvents: Array<{ ts: number; ratings: Array<{ action?: string; analyst?: string; rating?: string }> }> = [];
  for (const m of html.matchAll(eventRegex)) {
    const ts = Number(m[1]);
    if (!Number.isFinite(ts)) continue;
    try {
      const ratings = JSON.parse(m[2]) as Array<{ action?: string; analyst?: string; rating?: string }>;
      if (Array.isArray(ratings)) embeddedEvents.push({ ts, ratings });
    } catch {
      /* fallback to HTML table */
    }
  }
  if (embeddedEvents.length > 0) {
    embeddedEvents.sort((a, b) => b.ts - a.ts);
    for (const ev of embeddedEvents.slice(0, 8)) {
      const date = new Date(ev.ts * 1000).toISOString().slice(0, 10);
      for (const r of ev.ratings) {
        const firm = typeof r.analyst === "string" ? stripTags(r.analyst) : "";
        const toGrade = typeof r.rating === "string"
          ? stripTags(r.rating.replace(/\\u0026rarr;|&rarr;/gi, "→"))
          : "";
        const action = typeof r.action === "string" && r.action.trim() ? r.action.trim() : "Rating";
        if (firm) recentActions.push({ date, action, firm, toGrade });
      }
    }
  }

  // 2) Legacy / current HTML ratings table fallback (js-table-ratings or styled-table-new)
  if (!recentActions.length) {
    const ratingsSection =
      html.match(/<table[^>]*class="[^"]*js-table-ratings[^"]*"[^>]*>[\s\S]*?<\/table>/i)?.[0] ??
      html.match(/<table[^>]*class="[^"]*styled-table-new[^"]*"[^>]*>[\s\S]*?(?:Upgrade|Downgrade|Reiterated|Initiated)[\s\S]*?<\/table>/i)?.[0] ??
      "";
    for (const r of ratingsSection.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) ?? []) {
      const cols = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
        stripTags(m[1].replace(/<span[^>]*class="[^"]*avatar[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "")),
      );
      if (cols.length >= 4 && cols[0] && cols[2]) {
        recentActions.push({
          date: cols[0],
          action: cols[1] || "Rating",
          firm: cols[2],
          toGrade: cols[3],
        });
      }
    }
  }

  return {
    forwardPe: parseNumber(metrics.get("Forward P/E")),
    pegRatio: parseNumber(metrics.get("PEG")),
    priceToFcf: pToFcf,
    evToEbitda: parseNumber(metrics.get("EV/EBITDA")),
    operatingMarginPct: parseNumber(metrics.get("Oper. Margin")),
    netMarginPct: parseNumber(metrics.get("Profit Margin")),
    roePct: parseNumber(metrics.get("ROE")),
    revenueGrowthPct: parseNumber(metrics.get("Sales Q/Q")),
    analystTarget: parseNumber(metrics.get("Target Price")),
    recomScore: parseNumber(metrics.get("Recom")),
    recentActions: recentActions.slice(0, 5),
  };
}

export async function fetchFinvizSnapshot(
  ticker: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<FinvizParsedSnapshot | null> {
  const clean = ticker.trim().toUpperCase();
  if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(clean)) return null;
  const cached = finvizCache.get(clean);
  if (cached && now - cached.at < TTL_MS) return cached.data;

  try {
    const res = await fetcher(`https://finviz.com/quote.ashx?t=${encodeURIComponent(clean)}`, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(6_500),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const data = parseFinvizHtml(html);
    setBoundedCache(finvizCache, clean, { at: now, data }, 250);
    return data;
  } catch {
    return null;
  }
}

export interface YahooEquityInsights {
  partial: Partial<FundamentalSnapshot>;
  analystConsensus: AnalystConsensus | null;
  trailingPe: number | null;
}

function ratingLabelFromRec(strongBuy: number, buy: number, hold: number, sell: number, strongSell: number, recKey?: string): string {
  const total = strongBuy + buy + hold + sell + strongSell;
  if (recKey) {
    const clean = recKey.replace(/_/g, " ").trim();
    if (clean && clean !== "none") {
      return clean.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  if (!total) return "Neutral";
  const bullRatio = (strongBuy + buy) / total;
  const bearRatio = (sell + strongSell) / total;
  if (bullRatio >= 0.72) return "Strong Buy";
  if (bullRatio >= 0.5) return "Buy";
  if (bearRatio >= 0.45) return "Sell";
  return "Hold";
}

export function parseYahooQuoteSummary(summary: Record<string, unknown> | null | undefined): YahooEquityInsights | null {
  if (!summary || typeof summary !== "object") return null;
  const fin = (summary.financialData ?? {}) as Record<string, unknown>;
  const stats = (summary.defaultKeyStatistics ?? {}) as Record<string, unknown>;
  const detail = (summary.summaryDetail ?? {}) as Record<string, unknown>;
  const recTrend = ((summary.recommendationTrend as { trend?: Array<Record<string, unknown>> } | undefined)?.trend ?? [])[0] ?? {};
  const upgrades = ((summary.upgradeDowngradeHistory as { history?: Array<Record<string, unknown>> } | undefined)?.history ?? []);
  const earningsHist = ((summary.earningsHistory as { history?: Array<Record<string, unknown>> } | undefined)?.history ?? []);

  const rawVal = (v: unknown): unknown =>
    v && typeof v === "object" && "raw" in (v as Record<string, unknown>)
      ? (v as { raw?: unknown }).raw
      : v;
  const n = (v: unknown): number | null => {
    const val = rawVal(v);
    return typeof val === "number" && Number.isFinite(val) ? val : null;
  };
  const pct = (v: unknown): number | null => {
    const val = n(v);
    return val != null ? Number((val * 100).toFixed(1)) : null;
  };

  const fcf = n(fin.freeCashflow);
  const mcap = n(detail.marketCap) ?? n(stats.enterpriseValue);
  const fcfYieldPct = fcf !== null && mcap && mcap > 0 ? Number(((fcf / mcap) * 100).toFixed(2)) : null;

  const strongBuy = n(recTrend.strongBuy) ?? 0;
  const buy = n(recTrend.buy) ?? 0;
  const hold = n(recTrend.hold) ?? 0;
  const sell = n(recTrend.sell) ?? 0;
  const strongSell = n(recTrend.strongSell) ?? 0;
  const recTotal = strongBuy + buy + hold + sell + strongSell;
  const analystCount = n(fin.numberOfAnalystOpinions) ?? recTotal;

  const targetLow = n(fin.targetLowPrice);
  const targetMean = n(fin.targetMeanPrice) ?? n(fin.targetMedianPrice);
  const targetHigh = n(fin.targetHighPrice);

  const recentActions: AnalystRatingAction[] = [];
  for (const item of upgrades.slice(0, 5)) {
    const firm = typeof item.firm === "string" ? item.firm : "";
    const toGrade = typeof item.toGrade === "string" ? item.toGrade : "";
    const action = typeof item.action === "string" ? item.action : "reit";
    const rawEpoch = rawVal(item.epochGradeDate);
    const epoch = rawEpoch instanceof Date
      ? rawEpoch.toISOString().slice(0, 10)
      : typeof rawEpoch === "number" && Number.isFinite(rawEpoch)
        ? new Date(rawEpoch * 1000).toISOString().slice(0, 10)
        : "";
    if (firm && toGrade) recentActions.push({ date: epoch, firm, toGrade, action });
  }

  const analystConsensus: AnalystConsensus | null =
    recTotal > 0 || targetMean !== null
      ? {
          strongBuy,
          buy: buy + strongBuy,
          hold,
          sell: sell + strongSell,
          strongSell,
          ratingLabel: ratingLabelFromRec(
            strongBuy,
            buy,
            hold,
            sell,
            strongSell,
            typeof fin.recommendationKey === "string" ? fin.recommendationKey : undefined,
          ),
          analystCount,
          targetLow,
          targetMean,
          targetHigh,
          recentActions,
        }
      : null;

  const latestEarn = earningsHist.at(-1) as Record<string, unknown> | undefined;
  const surprisePct = latestEarn ? pct(latestEarn.surprisePercent) : null;
  const earnDateRaw = rawVal(latestEarn?.quarter);
  const lastEarningsDate =
    earnDateRaw instanceof Date
      ? earnDateRaw.toISOString().slice(0, 10)
      : typeof earnDateRaw === "number" && Number.isFinite(earnDateRaw)
        ? new Date(earnDateRaw * 1000).toISOString().slice(0, 10)
        : typeof earnDateRaw === "string"
          ? earnDateRaw.slice(0, 10)
          : null;

  const trailingPe = n(detail.trailingPE);
  const partial: YahooEquityInsights["partial"] = {
    forwardPe: n(stats.forwardPE) ?? n(detail.forwardPE),
    evToEbitda: n(stats.enterpriseToEbitda),
    pegRatio: n(stats.pegRatio),
    fcfYieldPct,
    operatingMarginPct: pct(fin.operatingMargins),
    netMarginPct: pct(fin.profitMargins),
    roePct: pct(fin.returnOnEquity),
    revenueGrowthPct: pct(fin.revenueGrowth),
    analystTarget: targetMean,
    marketCapBn: mcap ? Number((mcap / 1e9).toFixed(2)) : null,
    earningsSurprisePct: surprisePct,
    lastEarningsDate,
    analystConsensus,
  };
  const hasAny =
    trailingPe !== null ||
    analystConsensus !== null ||
    Object.values(partial).some((v) => v !== null);
  if (!hasAny) return null;

  return {
    trailingPe,
    analystConsensus,
    partial,
  };
}

export async function fetchYahooFinanceInsights(
  ticker: string,
  now = Date.now(),
): Promise<YahooEquityInsights | null> {
  const clean = ticker.trim().toUpperCase();
  if (!clean) return null;
  const cached = yahooInsightsCache.get(clean);
  if (cached && now - cached.at < TTL_MS) return cached.data;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const yf = getYahooClient();
    const summary = await Promise.race([
      yf.quoteSummary(
        clean,
        {
          modules: [
            "financialData",
            "defaultKeyStatistics",
            "summaryDetail",
            "recommendationTrend",
            "upgradeDowngradeHistory",
            "earningsHistory",
          ],
        },
        { validateResult: false },
      ),
      new Promise<null>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Yahoo timeout")), 6_500);
      }),
    ]);
    const parsed = parseYahooQuoteSummary(summary as Record<string, unknown> | null);
    setBoundedCache(yahooInsightsCache, clean, { at: now, data: parsed }, 250);
    return parsed;
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
