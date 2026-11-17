/**
 * Keyless public data feeds: crypto news (RSS), the economic calendar, the
 * Nasdaq earnings and dividend calendars and US Treasury yields. Each parser
 * is a pure function over the raw response so it can be tested with fixtures;
 * the fetchers add a timeout, a browser-like user agent and a short cache.
 */
export interface NewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
  published: number;
  summary: string;
  /** Exchange symbols whose coin is named in the headline. */
  symbols: string[];
}

export const NEWS_FEEDS: { source: string; url: string }[] = [
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss" },
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { source: "Decrypt", url: "https://decrypt.co/feed" },
];

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&#8217;": "’",
  "&#8216;": "‘",
  "&#8220;": "“",
  "&#8221;": "”",
  "&#8211;": "–",
  "&#8212;": "—",
  "&hellip;": "…",
};

function safeCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => safeCodePoint(parseInt(hex, 16), match))
    .replace(/&#(\d+);/g, (match, dec) => ENTITIES[match] ?? safeCodePoint(Number(dec), match))
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => ENTITIES[m] ?? m);
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return match ? match[1] : "";
}

/** Coins named in a headline, by ticker or common name. */
const COIN_NAMES: Record<string, string> = {
  bitcoin: "BTCUSDT",
  btc: "BTCUSDT",
  ethereum: "ETHUSDT",
  ether: "ETHUSDT",
  eth: "ETHUSDT",
  solana: "SOLUSDT",
  sol: "SOLUSDT",
  xrp: "XRPUSDT",
  ripple: "XRPUSDT",
  dogecoin: "DOGEUSDT",
  doge: "DOGEUSDT",
  bnb: "BNBUSDT",
  cardano: "ADAUSDT",
  ada: "ADAUSDT",
  avalanche: "AVAXUSDT",
  avax: "AVAXUSDT",
  chainlink: "LINKUSDT",
  polkadot: "DOTUSDT",
  litecoin: "LTCUSDT",
  shiba: "SHIBUSDT",
  uniswap: "UNIUSDT",
  aave: "AAVEUSDT",
  near: "NEARUSDT",
  cosmos: "ATOMUSDT",
  tron: "TRXUSDT",
  toncoin: "TONUSDT",
  sui: "SUIUSDT",
};

export function symbolsIn(text: string): string[] {
  const found = new Set<string>();
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/))
    if (COIN_NAMES[word]) found.add(COIN_NAMES[word]);
  return [...found];
}

export function parseRss(xml: string, source: string, max = 40): NewsItem[] {
  const items: NewsItem[] = [];
  for (const match of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const block = match[0];
    const title = stripHtml(tag(block, "title"));
    const link = stripHtml(tag(block, "link")) || stripHtml(tag(block, "guid"));
    const published = Date.parse(stripHtml(tag(block, "pubDate")) || stripHtml(tag(block, "dc:date")));
    if (!title || !/^https?:\/\//.test(link) || !Number.isFinite(published)) continue;
    const summary = stripHtml(tag(block, "description") || tag(block, "content:encoded")).slice(0, 280);
    items.push({
      id: `${source}:${link}`,
      title,
      link,
      source,
      published,
      summary,
      symbols: symbolsIn(title),
    });
    if (items.length >= max) break;
  }
  return items;
}

export type Impact = "high" | "medium" | "low" | "holiday";
export interface EconomicEvent {
  id: string;
  title: string;
  country: string;
  time: number;
  impact: Impact;
  forecast: string;
  previous: string;
  actual: string;
}

export function parseEconomicCalendar(rows: unknown): EconomicEvent[] {
  if (!Array.isArray(rows)) return [];
  const impacts: Record<string, Impact> = { high: "high", medium: "medium", low: "low", holiday: "holiday" };
  const out: EconomicEvent[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const time = Date.parse(String(r.date));
    if (!Number.isFinite(time) || typeof r.title !== "string") continue;
    out.push({
      id: `${time}:${r.country}:${r.title}`,
      title: r.title,
      country: String(r.country ?? ""),
      time,
      impact: impacts[String(r.impact ?? "").toLowerCase()] ?? "low",
      forecast: String(r.forecast ?? ""),
      previous: String(r.previous ?? ""),
      actual: String(r.actual ?? ""),
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

export interface EarningsEvent {
  symbol: string;
  name: string;
  time: string;
  epsForecast: string;
  lastYearEps: string;
  marketCap: string;
  fiscalQuarter: string;
}

export function parseEarnings(json: unknown): EarningsEvent[] {
  const rows = (json as { data?: { rows?: Record<string, string>[] } })?.data?.rows;
  if (!Array.isArray(rows)) return [];
  const labels: Record<string, string> = {
    "time-pre-market": "Before open",
    "time-after-hours": "After close",
    "time-not-supplied": "Time not supplied",
  };
  return rows.map((r) => ({
    symbol: r.symbol ?? "",
    name: r.name ?? "",
    time: labels[r.time] ?? r.time ?? "",
    epsForecast: r.epsForecast ?? "",
    lastYearEps: r.lastYearEPS ?? "",
    marketCap: r.marketCap ?? "",
    fiscalQuarter: r.fiscalQuarterEnding ?? "",
  }));
}

export interface DividendEvent {
  symbol: string;
  name: string;
  exDate: string;
  payment: string;
  amount: number;
  yield: string;
}

export function parseDividends(json: unknown): DividendEvent[] {
  const rows = (json as { data?: { calendar?: { rows?: Record<string, string>[] } } })?.data?.calendar?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    symbol: r.symbol ?? "",
    name: r.companyName ?? "",
    exDate: r.dividend_Ex_Date ?? "",
    payment: r.payment_Date ?? "",
    amount: Number(String(r.dividend_Rate ?? "").replace(/[$,]/g, "")) || 0,
    yield: r.indicated_Annual_Dividend ?? "",
  }));
}

export const YIELD_TENORS = [
  { key: "BC_1MONTH", label: "1M", months: 1 },
  { key: "BC_2MONTH", label: "2M", months: 2 },
  { key: "BC_3MONTH", label: "3M", months: 3 },
  { key: "BC_6MONTH", label: "6M", months: 6 },
  { key: "BC_1YEAR", label: "1Y", months: 12 },
  { key: "BC_2YEAR", label: "2Y", months: 24 },
  { key: "BC_3YEAR", label: "3Y", months: 36 },
  { key: "BC_5YEAR", label: "5Y", months: 60 },
  { key: "BC_7YEAR", label: "7Y", months: 84 },
  { key: "BC_10YEAR", label: "10Y", months: 120 },
  { key: "BC_20YEAR", label: "20Y", months: 240 },
  { key: "BC_30YEAR", label: "30Y", months: 360 },
] as const;

export interface YieldCurve {
  date: string;
  /** Percent yield by tenor label (null when not published that day). */
  values: Record<string, number | null>;
}

/** Parse the Treasury "daily yield curve" OData/Atom feed, oldest first. */
export function parseTreasuryYields(xml: string): YieldCurve[] {
  const curves: YieldCurve[] = [];
  for (const entry of xml.matchAll(/<entry>[\s\S]*?<\/entry>/gi)) {
    const block = entry[0];
    const date = /<d:NEW_DATE[^>]*>([^<]+)</i.exec(block)?.[1]?.slice(0, 10);
    if (!date) continue;
    const values: Record<string, number | null> = {};
    for (const tenor of YIELD_TENORS) {
      const raw = new RegExp(`<d:${tenor.key}[^>]*>([^<]*)<`, "i").exec(block)?.[1];
      const value = raw === undefined || raw === "" ? null : Number(raw);
      values[tenor.label] = value !== null && Number.isFinite(value) ? value : null;
    }
    curves.push({ date, values });
  }
  return curves.sort((a, b) => a.date.localeCompare(b.date));
}

const UA = { "user-agent": "Mozilla/5.0 (compatible; affentrader/1.0)", accept: "*/*" };
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function text(url: string, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(url, { headers: UA, signal: AbortSignal.timeout(15_000), cache: "no-store", redirect: "follow" });
  if (!response.ok) throw new Error(`${new URL(url).hostname} responded with HTTP ${response.status}`);
  return response.text();
}

export function clearFeedCache() {
  cache.clear();
}

export async function fetchNews(fetcher: typeof fetch = fetch): Promise<{ items: NewsItem[]; failed: string[] }> {
  return cached("news", 5 * 60_000, async () => {
    const failed: string[] = [];
    const lists = await Promise.all(
      NEWS_FEEDS.map(async (feed) => {
        try {
          return parseRss(await text(feed.url, fetcher), feed.source);
        } catch {
          failed.push(feed.source);
          return [];
        }
      }),
    );
    const seen = new Set<string>();
    const items = lists
      .flat()
      .sort((a, b) => b.published - a.published)
      .filter((n) => (seen.has(n.link) ? false : (seen.add(n.link), true)))
      .slice(0, 80);
    if (!items.length && failed.length) throw new Error("No news source is reachable right now.");
    return { items, failed };
  });
}

export async function fetchEconomicCalendar(
  week: "this" | "next",
  fetcher: typeof fetch = fetch,
): Promise<EconomicEvent[]> {
  return cached(`economic:${week}`, 30 * 60_000, async () =>
    parseEconomicCalendar(
      JSON.parse(await text(`https://nfs.faireconomy.media/ff_calendar_${week}week.json`, fetcher)),
    ),
  );
}

export async function fetchEarnings(date: string, fetcher: typeof fetch = fetch): Promise<EarningsEvent[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must be YYYY-MM-DD.");
  return cached(`earnings:${date}`, 60 * 60_000, async () =>
    parseEarnings(JSON.parse(await text(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, fetcher))),
  );
}

export async function fetchDividends(date: string, fetcher: typeof fetch = fetch): Promise<DividendEvent[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must be YYYY-MM-DD.");
  return cached(`dividends:${date}`, 60 * 60_000, async () =>
    parseDividends(JSON.parse(await text(`https://api.nasdaq.com/api/calendar/dividends?date=${date}`, fetcher))),
  );
}

export async function fetchYields(fetcher: typeof fetch = fetch, now = new Date()): Promise<YieldCurve[]> {
  return cached("yields", 60 * 60_000, async () => {
    const months = [now, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))];
    const curves: YieldCurve[] = [];
    for (const month of months) {
      const key = `${month.getUTCFullYear()}${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
      try {
        curves.push(
          ...parseTreasuryYields(
            await text(
              `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${key}`,
              fetcher,
            ),
          ),
        );
      } catch {
        /* the earlier month is optional */
      }
    }
    if (!curves.length) throw new Error("Treasury yield data is unavailable.");
    return curves.sort((a, b) => a.date.localeCompare(b.date));
  });
}

export const EQUITY_MACRO_NEWS_FEEDS: { source: string; url: string }[] = [
  { source: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex" },
  { source: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { source: "CNBC Markets", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { source: "Investing.com", url: "https://www.investing.com/rss/news.rss" },
];

const EQUITY_TOPICS: Array<[RegExp, string]> = [
  [/\b(apple|aapl)\b/i, "YF:AAPL"],
  [/\b(nvidia|nvda)\b/i, "YF:NVDA"],
  [/\b(microsoft|msft)\b/i, "YF:MSFT"],
  [/\b(alphabet|google|googl)\b/i, "YF:GOOGL"],
  [/\b(amazon|amzn)\b/i, "YF:AMZN"],
  [/\b(meta\s+platforms|\bmeta\b)\b/i, "YF:META"],
  [/\b(tesla|tsla)\b/i, "YF:TSLA"],
  [/\b(amd|advanced\s+micro)\b/i, "YF:AMD"],
  [/\b(palantir|pltr)\b/i, "YF:PLTR"],
  [/\b(exxon|xom)\b/i, "YF:XOM"],
  [/\b(chevron|cvx)\b/i, "YF:CVX"],
  [/\b(oil|crude|brent|wti|opec|tanker)\b/i, "YF:CL=F"],
  [/\b(gold|bullion)\b/i, "YF:GC=F"],
  [/\b(treasury|yield|fed|fomc|powell|cpi|inflation)\b/i, "YF:^TNX"],
  [/\b(s&p\s*500|sp500|nasdaq|spy|qqq)\b/i, "YF:SPY"],
  [/\b(dax|xetra|sap|siemens|rheinmetall)\b/i, "YF:SAP.DE"],
];

export function equitySymbolsIn(text: string): string[] {
  const found = new Set<string>(symbolsIn(text));
  for (const [pattern, sym] of EQUITY_TOPICS) {
    if (pattern.test(text)) found.add(sym);
  }
  return [...found];
}

export async function fetchMarketNews(
  scope: "all" | "crypto" | "equities" = "all",
  fetcher: typeof fetch = fetch,
): Promise<{ items: NewsItem[]; failed: string[] }> {
  if (scope === "crypto") return fetchNews(fetcher);
  return cached(`market-news:${scope}`, 3 * 60_000, async () => {
    const sources = scope === "equities" ? EQUITY_MACRO_NEWS_FEEDS : [...EQUITY_MACRO_NEWS_FEEDS, ...NEWS_FEEDS];
    const settled = await Promise.allSettled(
      sources.map(async (feed) => parseRss(await text(feed.url, fetcher), feed.source)),
    );
    const items: NewsItem[] = [];
    const failed: string[] = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") {
        for (const item of r.value) {
          items.push({
            ...item,
            symbols: equitySymbolsIn(`${item.title} ${item.summary}`),
          });
        }
      } else {
        failed.push(sources[i].source);
      }
    });
    if (!items.length) throw new Error("No market news feeds are reachable right now.");
    const seen = new Set<string>();
    const merged = items
      .sort((a, b) => b.published - a.published)
      .filter((item) => {
        const key = item.title.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 80);
    return { items: merged, failed };
  });
}
