import { createHash } from "node:crypto";
import { load } from "cheerio";
import { normalizeSocialTicker, REDDIT_COMMUNITIES, SOCIAL_TRACK_LIMIT, summarizeSocial, validSocialToken, type SocialPost, type SocialResult, type SocialSource, type SocialSourceStatus, type SocialWindow } from "@/lib/terminal/social";
import { HttpError } from "./security";

type Community = (typeof REDDIT_COMMUNITIES)[number];
type ProviderResult = { posts: SocialPost[]; status: SocialSourceStatus };
const REDDIT = "https://www.reddit.com";
const USER_AGENT = "web:affenterminal:1.0 (market research)";
const X_QUERY = '("stocks" OR "aktie" OR "börse" OR "wallstreetbets") has:cashtags -is:retweet';
const RESPONSE_LIMIT = 768 * 1024;
const CACHE_MS = 120_000;
const publicCache = new Map<string, { expires: number; value: ProviderResult }>();
let redditAuth: { token: string; expires: number; client: string } | undefined;

class FeedError extends Error {
  constructor(readonly status: number) { super("Social provider request failed."); }
}

async function readProvider(response: Response): Promise<string> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new FeedError(response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > RESPONSE_LIMIT) {
        await reader.cancel().catch(() => undefined);
        throw new FeedError(502);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

const object = (input: unknown): Record<string, unknown> => typeof input === "object" && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : {};
const textValue = (value: unknown) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

function redditLink(value: string, community: Community) {
  try {
    const url = new URL(value, REDDIT);
    const match = /^\/r\/([^/]+)\/comments\/([a-z0-9]+)(?:\/[a-z0-9_-]*)?(?:\/([a-z0-9]+))?\/?$/i.exec(url.pathname);
    if (url.origin !== REDDIT || match?.[1].toLowerCase() !== community.toLowerCase()) return null;
    return `${REDDIT}${url.pathname}`;
  } catch { return null; }
}

export function parseRedditAtom(source: Community, payload: string): SocialPost[] {
  const $ = load(payload, { xmlMode: true });
  if (!$('feed').length) throw new FeedError(502);
  return $("entry").slice(0, 50).toArray().flatMap(entry => {
    const row = $(entry);
    const url = redditLink(row.find('link[rel="alternate"]').attr("href") ?? row.find("link").attr("href") ?? "", source);
    const id = row.find("id").first().text().trim();
    const at = Date.parse(row.find("published").first().text() || row.find("updated").first().text());
    if (!url || !/^t[13]_[a-z0-9]+$/i.test(id) || !Number.isFinite(at)) return [];
    const html = row.find("content").first().text().slice(0, 20_000);
    const fragment = load(html, {}, false);
    fragment("a,script,style").remove();
    const title = textValue(row.find("title").first().text()).slice(0, 250);
    const text = textValue(fragment.root().text()).slice(0, 500);
    return [{ id, url, at, title, text, source }];
  });
}

function parseRedditListing(source: Community, payload: unknown): SocialPost[] {
  const list = object(object(payload).data).children;
  if (!Array.isArray(list)) throw new FeedError(502);
  return list.slice(0, 50).flatMap(item => {
    const row = object(object(item).data), id = textValue(row.name);
    const url = redditLink(textValue(row.permalink), source);
    if (!url || !/^t[13]_[a-z0-9]+$/i.test(id) || typeof row.created_utc !== "number") return [];
    return [{ id, url, at: row.created_utc * 1000, source, title: textValue(row.title ?? row.link_title).slice(0, 250),
      text: textValue(row.selftext ?? row.body).slice(0, 500) }];
  });
}

export function parseXRecent(payload: unknown): SocialPost[] {
  const root = object(payload), data = root.data;
  if (!Array.isArray(data)) {
    if (object(root.meta).result_count === 0 && !root.errors) return [];
    throw new FeedError(502);
  }
  return data.slice(0, 50).flatMap(item => {
    const row = object(item), id = textValue(row.id), text = textValue(row.text).slice(0, 500);
    const at = Date.parse(textValue(row.created_at));
    if (!/^\d{6,24}$/.test(id) || !text || !Number.isFinite(at)) return [];
    return [{ id, url: `https://x.com/i/web/status/${id}`, at, source: "x" as const, title: "", text }];
  });
}

const result = (source: SocialSource, state: SocialSourceStatus["state"], posts: SocialPost[] = []): ProviderResult => ({
  posts, status: { source, state, samples: new Set(posts.map(post => post.id)).size },
});
const badState = (error: unknown) => error instanceof FeedError && error.status === 429 ? "rate-limited" : "unavailable";

async function redditAccess(fetcher: typeof fetch, signal: AbortSignal, now: number) {
  const id = process.env.AFFENTRADER_REDDIT_CLIENT_ID?.trim();
  const secret = process.env.AFFENTRADER_REDDIT_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  const client = createHash("sha256").update(`${id}:${secret}`).digest("hex");
  if (redditAuth?.client === client && redditAuth.expires > now) return redditAuth.token;
  const response = await fetcher(`${REDDIT}/api/v1/access_token`, {
    method: "POST", signal, redirect: "error", cache: "no-store",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  const body = object(JSON.parse(await readProvider(response)));
  if (!validSocialToken(body.access_token) || typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in)) throw new FeedError(502);
  redditAuth = { token: body.access_token, client, expires: now + Math.max(0, Math.min(3600, body.expires_in) - 60) * 1000 };
  return redditAuth.token;
}

async function readCommunity(source: Community, ticker: string | null, token: string | null, fetcher: typeof fetch, signal: AbortSignal): Promise<ProviderResult> {
  const sections = ticker ? ["search"] : ["new", "comments"];
  const base = `${token ? "https://oauth.reddit.com" : REDDIT}/r/${source}`;
  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: token ? "application/json" : "application/atom+xml" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const feeds = await Promise.allSettled(sections.map(async section => {
    const search = section === "search";
    const url = new URL(token ? `${base}/${section}` : search ? `${base}/search.rss` : `${base}/${section}/.rss`);
    url.searchParams.set("limit", "25");
    if (search && ticker) {
      url.searchParams.set("q", ticker);
      url.searchParams.set("restrict_sr", "on");
      url.searchParams.set("sort", "new");
      url.searchParams.set("t", "week");
    }
    const raw = await readProvider(await fetcher(url, { headers, signal, cache: "no-store", redirect: "error" }));
    return token ? parseRedditListing(source, JSON.parse(raw)) : parseRedditAtom(source, raw);
  }));
  const successful = feeds.filter(feed => feed.status === "fulfilled");
  if (!successful.length) return result(source, feeds.some(feed => feed.status === "rejected" && badState(feed.reason) === "rate-limited") ? "rate-limited" : "unavailable");
  return result(source, successful.length === feeds.length ? "ok" : "partial", successful.flatMap(feed => feed.value));
}

async function readX(ticker: string | null, token: string, hours: SocialWindow, fetcher: typeof fetch, signal: AbortSignal, now: number): Promise<ProviderResult> {
  const url = new URL("https://api.x.com/2/tweets/search/recent");
  url.search = new URLSearchParams({
    query: ticker ? `($${ticker} OR "${ticker}") -is:retweet` : X_QUERY,
    max_results: "50", "tweet.fields": "created_at", start_time: new Date(now - hours * 3_600_000).toISOString(),
  }).toString();
  try {
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal, cache: "no-store", redirect: "error" });
    const body = object(JSON.parse(await readProvider(response)));
    return result("x", object(body.meta).next_token || body.errors ? "partial" : "ok", parseXRecent(body));
  } catch (error) {
    return result("x", error instanceof FeedError && [401, 402, 403].includes(error.status) ? "needs-access" : badState(error));
  }
}

async function cachedResult(key: string, now: number, fn: () => Promise<ProviderResult>) {
  const existing = publicCache.get(key);
  if (existing && existing.expires > now) return existing.value;
  const value = await fn();
  if (value.status.state === "ok" || value.status.state === "partial") {
    value.status.fetchedAt = now;
    publicCache.delete(key);
    publicCache.set(key, { expires: now + CACHE_MS, value });
    if (publicCache.size > 48) publicCache.delete(publicCache.keys().next().value!);
  }
  return value;
}

export async function terminalSocialRequest(input: Record<string, unknown>, signal: AbortSignal, fetcher = fetch, now = Date.now()): Promise<SocialResult> {
  const ticker = normalizeSocialTicker(input.ticker);
  const emptyTicker = input.ticker === undefined || input.ticker === null || input.ticker === "";
  const tracked = input.tracked ?? [];
  const hours = input.hours ?? 24;
  const requestedToken = input.xToken;
  if ((!emptyTicker && !ticker) || !Array.isArray(tracked) || tracked.length > SOCIAL_TRACK_LIMIT || tracked.some(t => !normalizeSocialTicker(t)) ||
    (hours !== 24 && hours !== 72) || (requestedToken !== undefined && !validSocialToken(requestedToken))) throw new HttpError(400, "Ticker, 24/72 Stunden oder X-Zugang prüfen.");
  const trackedTickers = tracked.map(t => normalizeSocialTicker(t)!);
  const configuredToken = process.env.AFFENTRADER_X_BEARER_TOKEN?.trim();
  const xToken = validSocialToken(requestedToken) ? requestedToken : validSocialToken(configuredToken) ? configuredToken : null;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
  const reddit = redditAccess(fetcher, deadline, now);
  const sources = await Promise.all([
    ...REDDIT_COMMUNITIES.map(async source => {
      try {
        const token = await reddit;
        const key = `reddit:${source}:${token ? "oauth" : "rss"}`;
        const latest = cachedResult(`${key}:latest`, now, () => readCommunity(source, null, token, fetcher, deadline));
        if (!ticker) return await latest;
        const searches = await Promise.all([latest, cachedResult(`${key}:${ticker}`, now, () => readCommunity(source, ticker, token, fetcher, deadline))]);
        const covered = searches.filter(feed => feed.status.fetchedAt !== undefined);
        if (!covered.length) return searches.find(feed => feed.status.state === "rate-limited") ?? searches[0];
        const joined = result(source, searches.every(feed => feed.status.state === "ok") ? "ok" : "partial", covered.flatMap(feed => feed.posts));
        joined.status.fetchedAt = Math.min(...covered.map(feed => feed.status.fetchedAt!));
        return joined;
      } catch (error) { return result(source, badState(error)); }
    }),
    xToken ? cachedResult(`x:${createHash("sha256").update(xToken).digest("hex")}:${ticker ?? ""}:${hours}`, now,
      () => readX(ticker, xToken, hours, fetcher, deadline, now)) : Promise.resolve(result("x", "needs-access")),
  ]);
  return { asOf: now, ticker, hours, sources: sources.map(source => source.status),
    ...summarizeSocial(sources.flatMap(source => source.posts), trackedTickers, ticker, hours, now) };
}
