export const REDDIT_COMMUNITIES = ["mauerstrassenwetten", "wallstreetbetsGER"] as const;
export type SocialSource = "x" | (typeof REDDIT_COMMUNITIES)[number];
export const SOCIAL_SOURCE_LABELS: Record<SocialSource, string> = {
  x: "X", mauerstrassenwetten: "r/mauerstrassenwetten", wallstreetbetsGER: "r/wallstreetbetsGER",
};
export const SOCIAL_TRACK_LIMIT = 20;
export type SocialWindow = 24 | 72;

export interface SocialPost {
  id: string;
  source: SocialSource;
  title: string;
  text: string;
  url: string;
  at: number;
}

export interface SocialSourceStatus {
  source: SocialSource;
  state: "ok" | "partial" | "unavailable" | "needs-access" | "rate-limited";
  samples: number;
  fetchedAt?: number;
}

export interface SocialTrend {
  ticker: string;
  count: number;
  reddit: number;
  x: number;
  latest: number;
}

export interface SocialResult {
  asOf: number;
  hours: SocialWindow;
  ticker: string | null;
  sources: SocialSourceStatus[];
  trends: SocialTrend[];
  posts: (SocialPost & { tickers: string[] })[];
}

const pattern = "[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*";
const tickerPattern = new RegExp(`^${pattern}$`);
const cashTag = new RegExp(`(?<![\\p{L}\\p{N}_$])\\$(${pattern})(?![\\p{L}\\p{N}_])`, "giu");
const bareTag = new RegExp(`(?<![\\p{L}\\p{N}_$@])(${pattern})(?![\\p{L}\\p{N}_])`, "gu");
const ambiguous = new Set(["USA", "USD", "EUR", "GBP", "CHF", "CEO", "CFO", "SEC", "IPO", "ETF", "EPS", "GDP", "FOMC", "DAX"]);
const defaults = ["AAPL", "ACHR", "AMD", "AMZN", "ASML", "ASTS", "BABA", "BAYN", "COIN", "CRWV", "DTE", "GME", "GOOG", "GOOGL", "HIMS", "HOOD", "INTC", "IONQ", "IREN", "MARA", "META", "MSFT", "MSTR", "MU", "NBIS", "NVDA", "OPEN", "PLTR", "QCOM", "RHM", "RIVN", "RKLB", "SAP", "SIE", "SMCI", "SOFI", "SPY", "TSLA", "UBER", "UNH", "VOW3", "VWCE"];

export function normalizeSocialTicker(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const ticker = input.trim().replace(/^\$/, "").toUpperCase();
  return ticker.length <= 15 && tickerPattern.test(ticker) ? ticker : null;
}

export function validSocialToken(input: unknown): input is string {
  return typeof input === "string" && /^[A-Za-z0-9._~+/%=-]{12,512}$/.test(input);
}

export function socialTickers(text: string, watched: ReadonlySet<string>): string[] {
  const result = new Set<string>();
  for (const [, tag] of text.matchAll(cashTag)) {
    const ticker = normalizeSocialTicker(tag);
    if (ticker) result.add(ticker);
  }
  for (const [, ticker] of text.matchAll(bareTag)) {
    if (ticker.length >= 3 && !ambiguous.has(ticker) && watched.has(ticker)) result.add(ticker);
  }
  return [...result];
}

export function summarizeSocial(posts: readonly SocialPost[], tracked: readonly string[], ticker: string | null, hours: SocialWindow, now: number) {
  const watched = new Set([...defaults, ...tracked, ...(ticker ? [ticker] : [])]);
  const earliest = now - hours * 3_600_000;
  const accepted = new Map<string, SocialPost & { tickers: string[] }>();
  for (const post of posts) {
    if (!Number.isFinite(post.at) || post.at < earliest || post.at > now) continue;
    const key = `${post.source}:${post.id}`;
    if (accepted.has(key)) continue;
    const tickers = socialTickers(`${post.title}\n${post.text}`, watched);
    if (tickers.length && (!ticker || tickers.includes(ticker))) accepted.set(key, { ...post, tickers });
  }
  const trends = new Map<string, SocialTrend>();
  for (const post of accepted.values()) {
    for (const symbol of post.tickers) {
      if (ticker && symbol !== ticker) continue;
      const row = trends.get(symbol) ?? { ticker: symbol, count: 0, reddit: 0, x: 0, latest: 0 };
      row.count++;
      if (post.source === "x") row.x++;
      else row.reddit++;
      row.latest = Math.max(row.latest, post.at);
      trends.set(symbol, row);
    }
  }
  return {
    trends: [...trends.values()].sort((a, b) => b.count - a.count || b.latest - a.latest || a.ticker.localeCompare(b.ticker)).slice(0, 24),
    posts: [...accepted.values()].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)).slice(0, 36),
  };
}
