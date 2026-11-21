import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { scryptSync } from "node:crypto";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { createSiteSession, SITE_COOKIE } from "@/lib/server/siteAccess";
import { accessKey, resetAccessKeyCache, resetApiRateLimit } from "@/lib/server/security";
import { deliverWebhook } from "@/lib/server/webhooks";
import { clearFeedCache } from "@/lib/server/feeds";
import { clearMacroPulseCache } from "@/lib/server/macroAndSentimentSources";
import { clearHyperliquidCache } from "@/lib/server/hyperliquid";
import { clearScreenerCache } from "@/lib/server/screener";
import { clearStockHeatmapCache } from "@/lib/server/stockHeatmap";
import { clearYahooCache } from "@/lib/server/yahoo";
import { GET as healthGet } from "@/app/api/health/route";
import { GET as feedsGet } from "@/app/api/feeds/route";
import { GET as hyperliquidGet } from "@/app/api/hyperliquid/route";
import { GET as bybitGet } from "@/app/api/bybit/route";
import {
  DELETE as libraryDelete,
  GET as libraryGet,
  POST as libraryPost,
  PUT as libraryPut,
} from "@/app/api/library/route";
import { DELETE as pushDelete, GET as pushGet, POST as pushPost } from "@/app/api/push/route";
import { GET as screenerGet } from "@/app/api/screener/route";
import { GET as stockBaseGet, POST as stockBasePost } from "@/app/api/stock-base/route";
import { GET as heatmapGet } from "@/app/api/stock-heatmap/route";
import { DELETE as syncDelete, GET as syncGet, PUT as syncPut } from "@/app/api/sync/route";
import { GET as capmGet } from "@/app/api/terminal-capm/route";
import { GET as yahooGet } from "@/app/api/yahoo/route";
import {
  DELETE as alertsDelete,
  PATCH as alertsPatch,
  POST as alertsPost,
  PUT as alertsPut,
} from "@/app/api/alerts/route";
import { POST as eventsPost } from "@/app/api/alerts/events/route";

const TEST_SALT = "a".repeat(32);
const TEST_HASH = `${TEST_SALT}:${scryptSync("pw-check", TEST_SALT, 64).toString("hex")}`;
const TEST_SECRET = "b".repeat(64);
const PINE_SOURCE = '//@version=6\nindicator("Route Test", overlay=true)\nplot(close)';

let tempDir = "";

function stubSiteAuth() {
  vi.stubEnv("AFFENTRADER_SITE_PASSWORD_HASH", TEST_HASH);
  vi.stubEnv("AFFENTRADER_SITE_SESSION_SECRET", TEST_SECRET);
  return createSiteSession({ passwordHash: TEST_HASH, secret: TEST_SECRET });
}

function makeDailyYahooChartJson(
  symbol: string,
  opts: { currency?: string; timezone?: string; count?: number; offsetSlope?: number } = {},
) {
  const currency = opts.currency ?? "USD";
  const timezone = opts.timezone ?? "America/New_York";
  const count = opts.count ?? 90;
  const slope = opts.offsetSlope ?? 0.35;
  const anchorSec = Math.floor((Date.now() - 2 * 86_400_000) / 86_400_000) * 86_400 + 15 * 3600;
  const timestamps: number[] = [];
  const open: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const close: number[] = [];
  const adjclose: number[] = [];
  const volume: number[] = [];

  for (let i = count - 1; i >= 0; i--) {
    const idx = count - 1 - i;
    const t = anchorSec - i * 86_400;
    const base = 100 + idx * slope + ((idx * 7) % 5) * 0.6;
    const c = Number((base + (idx % 2 === 0 ? 0.5 : -0.3)).toFixed(2));
    const o = Number(base.toFixed(2));
    const h = Number((Math.max(o, c) + 1.2).toFixed(2));
    const l = Number((Math.min(o, c) - 1.1).toFixed(2));
    timestamps.push(t);
    open.push(o);
    high.push(h);
    low.push(l);
    close.push(c);
    adjclose.push(c);
    volume.push(1_250_000 + idx * 1000);
  }

  return {
    chart: {
      result: [
        {
          meta: {
            symbol,
            shortName: `${symbol} Corp`,
            exchangeName: "NMS",
            currency,
            instrumentType: "EQUITY",
            exchangeTimezoneName: timezone,
            regularMarketPrice: close.at(-1),
            chartPreviousClose: close[0],
            regularMarketDayHigh: high.at(-1),
            regularMarketDayLow: low.at(-1),
            regularMarketVolume: volume.at(-1),
            regularMarketTime: timestamps.at(-1),
            gmtoffset: -18000,
            dataGranularity: "1d",
          },
          timestamp: timestamps,
          indicators: {
            quote: [{ open, high, low, close, volume }],
            adjclose: [{ adjclose }],
          },
        },
      ],
      error: null,
    },
  };
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "affentrader-routes-"));
  vi.stubEnv("AFFENTRADER_DATA", tempDir);
  resetAccessKeyCache();
  resetApiRateLimit();
  clearFeedCache();
  clearMacroPulseCache();
  clearHyperliquidCache();
  clearScreenerCache();
  clearStockHeatmapCache();
  clearYahooCache();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetAccessKeyCache();
  resetApiRateLimit();
  clearFeedCache();
  clearMacroPulseCache();
  clearHyperliquidCache();
  clearScreenerCache();
  clearStockHeatmapCache();
  clearYahooCache();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = "";
});

describe("proxy CSP, /sw.js & /api/health rate-limit exemption", () => {
  it("enforces full authenticated CSP directives, /sw.js CSP, and exempts /api/health after API rate exhaustion", async () => {
    const token = stubSiteAuth();
    const headers = { cookie: `${SITE_COOKIE}=${token}` };

    const pageRes = await proxy(new NextRequest("http://localhost:3000/terminal", { headers }));
    const csp = pageRes.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("https://data-api.binance.vision");
    expect(csp).toContain("https://api.kraken.com");
    expect(csp).toContain("wss://data-stream.binance.vision");
    expect(csp).toContain("wss://ws.kraken.com");
    expect(csp).toContain("wss://api.hyperliquid.xyz");
    expect(csp).toContain("wss://stream.data.alpaca.markets");

    const swRes = await proxy(new NextRequest("http://localhost:3000/sw.js", { method: "GET" }));
    expect(swRes.headers.get("x-middleware-next")).toBe("1");
    expect(swRes.headers.get("cache-control")).toBe("no-store");
    expect(swRes.headers.get("content-security-policy")).toBe(
      "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'",
    );

    // Exhaust both API rate buckets for this session token
    for (let i = 0; i < 60; i++) {
      expect((await proxy(new NextRequest("http://localhost:3000/api/screener", { headers }))).headers.get("x-middleware-next")).toBe("1");
    }
    expect((await proxy(new NextRequest("http://localhost:3000/api/screener", { headers }))).status).toBe(429);
    for (let i = 0; i < 240; i++) {
      expect((await proxy(new NextRequest("http://localhost:3000/api/alerts", { headers }))).headers.get("x-middleware-next")).toBe("1");
    }
    expect((await proxy(new NextRequest("http://localhost:3000/api/alerts", { headers }))).status).toBe(429);

    // /api/health GET & HEAD must stay exempt and return 200
    const healthProxy = await proxy(new NextRequest("http://localhost:3000/api/health", { method: "GET", headers }));
    expect(healthProxy.headers.get("x-middleware-next")).toBe("1");
    const healthHandler = await healthGet(new NextRequest("http://localhost:3000/api/health", { headers }));
    expect(healthHandler.status).toBe(200);
  });
});

describe("/api/feeds route coverage", () => {
  it("serves news (all/crypto/equities), economic, earnings, dividends, yields, macro and rejects invalid queries", async () => {
    const rssXml = `<rss><channel><item><title>Bitcoin ETF &amp; Apple rally</title><link>https://example.com/item-1</link><pubDate>Wed, 18 Nov 2026 10:00:00 GMT</pubDate><description>BTC and AAPL gain.</description></item></channel></rss>`;
    const yieldsXml = `<feed><entry><d:NEW_DATE>2026-11-17T00:00:00</d:NEW_DATE><d:BC_10YEAR>4.21</d:BC_10YEAR><d:BC_2YEAR>4.02</d:BC_2YEAR></entry></feed>`;
    const chartJson = makeDailyYahooChartJson("^GSPC", { count: 10 });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("faireconomy")) {
          return new Response(JSON.stringify([{ date: "2026-11-18T13:30:00Z", title: "CPI", country: "USD", impact: "High" }]), { status: 200 });
        }
        if (url.includes("nasdaq.com/api/calendar/earnings")) {
          return new Response(JSON.stringify({ data: { rows: [{ symbol: "NVDA", name: "NVIDIA", time: "time-after-hours" }] } }), { status: 200 });
        }
        if (url.includes("nasdaq.com/api/calendar/dividends")) {
          return new Response(JSON.stringify({ data: { calendar: { rows: [{ symbol: "AAPL", companyName: "Apple", dividend_Rate: "$0.25" }] } } }), { status: 200 });
        }
        if (url.includes("home.treasury.gov")) {
          return new Response(yieldsXml, { status: 200 });
        }
        if (url.includes("fred.stlouisfed.org")) {
          return new Response("DATE,VALUE\n2026-11-17,4.50\n", { status: 200 });
        }
        if (url.includes("alternative.me")) {
          return new Response(JSON.stringify({ data: [{ value: "62", value_classification: "Greed", timestamp: "1763460000" }] }), { status: 200 });
        }
        if (url.includes("finance.yahoo.com")) {
          return new Response(JSON.stringify(chartJson), { status: 200 });
        }
        return new Response(rssXml, { status: 200 });
      }),
    );

    const newsAll = await feedsGet(new NextRequest("http://localhost/api/feeds?kind=news&scope=all"));
    expect(newsAll.status).toBe(200);
    expect((await newsAll.json()).items.length).toBeGreaterThan(0);

    const newsCrypto = await feedsGet(new NextRequest("http://localhost/api/feeds?kind=news&scope=crypto"));
    expect(newsCrypto.status).toBe(200);

    const newsEq = await feedsGet(new NextRequest("http://localhost/api/feeds?kind=news&scope=equities"));
    expect(newsEq.status).toBe(200);

    const econ = await feedsGet(new NextRequest("http://localhost/api/feeds?kind=economic&week=next"));
    expect(econ.status).toBe(200);
    expect((await econ.json()).events).toHaveLength(1);

    const earn = await feedsGet(new NextRequest("http://localhost/api/feeds?kind=earnings&date=2026-11-18"));
    expect(earn.status).toBe(200);
    expect((await earn.json()).events[0].symbol).toBe("NVDA");

    const div = await feedsGet(new NextRequest("http://localhost/api/feeds?kind=dividends&date=2026-11-18"));
    expect(div.status).toBe(200);
    expect((await div.json()).events[0].symbol).toBe("AAPL");

    const yields = await feedsGet(new NextRequest("http://localhost/api/feeds?kind=yields"));
    expect(yields.status).toBe(200);
    expect((await yields.json()).curves.length).toBeGreaterThan(0);

    const macro = await feedsGet(new NextRequest("http://localhost/api/feeds?kind=macro"));
    expect(macro.status).toBe(200);
    const macroBody = await macro.json();
    expect(macroBody.fearGreed.value).toBe(62);
    expect(macroBody.fred.length).toBeGreaterThan(0);

    expect((await feedsGet(new NextRequest("http://localhost/api/feeds?kind=bad"))).status).toBe(400);
    expect((await feedsGet(new NextRequest("http://localhost/api/feeds?kind=dividends&date=2026/11/18"))).status).toBe(400);
  });
});

describe("/api/hyperliquid route coverage", () => {
  it("serves assets, candles, and range while enforcing 400 validation and sanitized 503", async () => {
    const now = Date.now();
    const minuteMs = Math.floor(now / 60_000) * 60_000;
    const candles = Array.from({ length: 5 }, (_, i) => ({
      t: minuteMs - (5 - i) * 60_000,
      T: minuteMs - (4 - i) * 60_000 - 1,
      o: "90000",
      h: "90100",
      l: "89900",
      c: "90050",
      v: "12.5",
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const reqBody = JSON.parse(String(init?.body ?? "{}")) as { type?: string };
        if (reqBody.type === "perpDexs") {
          return new Response(JSON.stringify([null]), { status: 200 });
        }
        if (reqBody.type === "metaAndAssetCtxs") {
          return new Response(
            JSON.stringify([
              { universe: [{ name: "BTC", szDecimals: 5 }] },
              [{ markPx: "91000", prevDayPx: "89500", dayNtlVlm: "125000000" }],
            ]),
            { status: 200 },
          );
        }
        if (reqBody.type === "candleSnapshot") {
          return new Response(JSON.stringify(candles), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      }),
    );

    const assetsRes = await hyperliquidGet(new NextRequest("http://localhost/api/hyperliquid?kind=assets"));
    expect(assetsRes.status).toBe(200);
    expect((await assetsRes.json()).assets[0].coin).toBe("BTC");

    const candlesRes = await hyperliquidGet(
      new NextRequest(`http://localhost/api/hyperliquid?kind=candles&coin=BTC&interval=1m&start=${minuteMs - 300_000}&end=${minuteMs}`),
    );
    expect(candlesRes.status).toBe(200);
    expect((await candlesRes.json()).candles).toHaveLength(5);

    const rangeRes = await hyperliquidGet(new NextRequest("http://localhost/api/hyperliquid?kind=range&coin=BTC"));
    expect(rangeRes.status).toBe(200);
    expect((await rangeRes.json()).range).toBeDefined();

    // 400 validation errors
    expect((await hyperliquidGet(new NextRequest("http://localhost/api/hyperliquid?kind=unknown"))).status).toBe(400);
    expect((await hyperliquidGet(new NextRequest("http://localhost/api/hyperliquid?kind=range&coin=bad!"))).status).toBe(400);
    expect((await hyperliquidGet(new NextRequest(`http://localhost/api/hyperliquid?kind=candles&coin=BTC&interval=bad&start=1000&end=2000`))).status).toBe(400);
    expect((await hyperliquidGet(new NextRequest(`http://localhost/api/hyperliquid?kind=candles&coin=BTC&interval=1m&start=5000&end=1000`))).status).toBe(400);

    // 503 sanitized on upstream error
    clearHyperliquidCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 502 })));
    const failRes = await hyperliquidGet(new NextRequest("http://localhost/api/hyperliquid?kind=range&coin=BTC"));
    expect(failRes.status).toBe(503);
    expect(await failRes.json()).toEqual({ error: "Hyperliquid is unavailable." });
  });
});

describe("/api/library route coverage", () => {
  it("supports publish, invite access, mine=1, likes, updates, delete, and auth/input validation", async () => {
    const key = await accessKey();
    const readerToken = "c".repeat(32);

    // Unauthorized publish/mine/PUT/DELETE fail with 401
    expect((await libraryGet(new NextRequest("http://localhost/api/library?mine=1"))).status).toBe(401);
    expect(
      (
        await libraryPost(
          new NextRequest("http://localhost/api/library", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "Unauth", source: PINE_SOURCE }),
          }),
        )
      ).status,
    ).toBe(401);

    // Publish public + invite-only scripts
    const pubRes = await libraryPost(
      new NextRequest("http://localhost/api/library", {
        method: "POST",
        headers: { "x-affentrader-key": key, "content-type": "application/json" },
        body: JSON.stringify({ title: "Public Trend", author: "Ada", kind: "indicator", visibility: "public", source: PINE_SOURCE }),
      }),
    );
    expect(pubRes.status).toBe(200);
    const pubId = (await pubRes.json()).script.id as string;

    const invRes = await libraryPost(
      new NextRequest("http://localhost/api/library", {
        method: "POST",
        headers: { "x-affentrader-key": key, "content-type": "application/json" },
        body: JSON.stringify({ title: "Private Alpha", author: "Ada", kind: "strategy", visibility: "invite", source: PINE_SOURCE }),
      }),
    );
    expect(invRes.status).toBe(200);
    const invBody = await invRes.json();
    const invId = invBody.script.id as string;
    const inviteCode = invBody.invite as string;

    // Public list omits invite-only
    const listRes = await libraryGet(new NextRequest("http://localhost/api/library?q=Trend&kind=indicator&limit=10"));
    expect(listRes.status).toBe(200);
    expect((await listRes.json()).scripts.map((s: { id: string }) => s.id)).toEqual([pubId]);

    // mine=1 with key includes both
    const mineRes = await libraryGet(new NextRequest("http://localhost/api/library?mine=1", { headers: { "x-affentrader-key": key } }));
    expect(mineRes.status).toBe(200);
    expect((await mineRes.json()).scripts).toHaveLength(2);

    // Invite access & invalid invite validation
    expect((await libraryGet(new NextRequest(`http://localhost/api/library?id=${invId}`))).status).toBe(404);
    expect((await libraryGet(new NextRequest(`http://localhost/api/library?invite=${encodeURIComponent(inviteCode)}`))).status).toBe(200);
    expect((await libraryGet(new NextRequest(`http://localhost/api/library?invite=${"z".repeat(257)}`))).status).toBe(400);

    // Like action
    const likeRes = await libraryPost(
      new NextRequest("http://localhost/api/library", {
        method: "POST",
        headers: { "x-affentrader-reader": readerToken, "content-type": "application/json" },
        body: JSON.stringify({ action: "like", id: pubId, liked: true }),
      }),
    );
    expect(likeRes.status).toBe(200);
    expect(await likeRes.json()).toEqual({ likes: 1, liked: true });

    expect(
      (
        await libraryPost(
          new NextRequest("http://localhost/api/library", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "like", id: pubId }),
          }),
        )
      ).status,
    ).toBe(400);

    // Non-object POST body -> 400
    expect(
      (
        await libraryPost(
          new NextRequest("http://localhost/api/library", {
            method: "POST",
            headers: { "x-affentrader-key": key, "content-type": "application/json" },
            body: "[]",
          }),
        )
      ).status,
    ).toBe(400);

    // PUT update + DELETE
    const putRes = await libraryPut(
      new NextRequest("http://localhost/api/library", {
        method: "PUT",
        headers: { "x-affentrader-key": key, "content-type": "application/json" },
        body: JSON.stringify({ id: pubId, title: "Public Trend v2", source: `${PINE_SOURCE}\nplot(open)`, notes: "v2" }),
      }),
    );
    expect(putRes.status).toBe(200);
    expect((await putRes.json()).script.version).toBe(2);

    const delRes = await libraryDelete(
      new NextRequest(`http://localhost/api/library?id=${pubId}`, {
        method: "DELETE",
        headers: { "x-affentrader-key": key },
      }),
    );
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ removed: true });
  });
});

describe("/api/push route coverage", () => {
  it("supports GET publicKey, authenticated subscribe/test/delete, 401/400 guards, and sanitized 500", async () => {
    const getRes = await pushGet();
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).publicKey.length).toBeGreaterThan(40);

    const sub = {
      endpoint: "https://push.example.com/sub/1",
      keys: {
        p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
        auth: "tBHItJI5svbpez7KI4CCXg",
      },
    };

    expect(
      (
        await pushPost(
          new NextRequest("http://localhost/api/push", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ subscription: sub }),
          }),
        )
      ).status,
    ).toBe(401);
    expect((await pushDelete(new NextRequest(`http://localhost/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" }))).status).toBe(401);

    const key = await accessKey();
    const postRes = await pushPost(
      new NextRequest("http://localhost/api/push", {
        method: "POST",
        headers: { "x-affentrader-key": key, "content-type": "application/json" },
        body: JSON.stringify({ subscription: sub }),
      }),
    );
    expect(postRes.status).toBe(200);
    expect(await postRes.json()).toEqual({ subscribed: true });

    const badSub = await pushPost(
      new NextRequest("http://localhost/api/push", {
        method: "POST",
        headers: { "x-affentrader-key": key, "content-type": "application/json" },
        body: JSON.stringify({ subscription: { endpoint: "http://bad" } }),
      }),
    );
    expect(badSub.status).toBe(400);

    const delRes = await pushDelete(
      new NextRequest(`http://localhost/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`, {
        method: "DELETE",
        headers: { "x-affentrader-key": key },
      }),
    );
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ removed: true });

    // Isolated test-push + 500 error catch sanitization
    vi.resetModules();
    vi.doMock("@/lib/server/push", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/server/push")>();
      return {
        ...actual,
        vapidKeys: vi.fn(async () => {
          throw new Error("INTERNAL_VAPID_DISK_ERR");
        }),
        sendPush: vi.fn(async () => ({ sent: 1, removed: 0 })),
      };
    });
    try {
      const { GET: isolatedGet, POST: isolatedPost } = await import("@/app/api/push/route");
      const errRes = await isolatedGet();
      expect(errRes.status).toBe(500);
      expect(await errRes.json()).toEqual({ error: "Push service error." });

      const testRes = await isolatedPost(
        new NextRequest("http://localhost/api/push", {
          method: "POST",
          headers: { "x-affentrader-key": key, "content-type": "application/json" },
          body: JSON.stringify({ test: true }),
        }),
      );
      expect(testRes.status).toBe(200);
      expect(await testRes.json()).toEqual({ sent: 1, removed: 0 });
    } finally {
      vi.doUnmock("@/lib/server/push");
      vi.resetModules();
    }
  });
});

describe("/api/screener, /api/stock-heatmap & /api/stock-base route coverage", () => {
  it("returns 200 screener results for binance and hyperliquid mocks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("ticker/24hr")) {
          return new Response(
            JSON.stringify([
              {
                symbol: "BTCUSDT",
                lastPrice: "91000",
                highPrice: "92000",
                lowPrice: "89000",
                priceChangePercent: "2.1",
                quoteVolume: "18000000",
                volume: "200",
                count: 5000,
              },
            ]),
            { status: 200 },
          );
        }
        const body = JSON.parse(String(init?.body ?? "{}")) as { type?: string };
        if (body.type === "perpDexs") return new Response(JSON.stringify([null]), { status: 200 });
        return new Response(
          JSON.stringify([
            { universe: [{ name: "ETH", szDecimals: 4 }] },
            [{ markPx: "3200", prevDayPx: "3100", dayNtlVlm: "9500000" }],
          ]),
          { status: 200 },
        );
      }),
    );

    const binanceRes = await screenerGet(new NextRequest("http://localhost/api/screener?market=binance&limit=5&minTurnover=1000"));
    expect(binanceRes.status).toBe(200);
    expect((await binanceRes.json()).rows[0].symbol).toBe("BTCUSDT");

    const hlRes = await screenerGet(new NextRequest("http://localhost/api/screener?market=hyperliquid&limit=5&minTurnover=1000"));
    expect(hlRes.status).toBe(200);
    expect((await hlRes.json()).rows[0].symbol).toBe("HL:ETH");
  });

  it("returns 200 for /api/stock-heatmap across us, xetra, and lse markets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              { d: ["AAPL", "Apple Inc.", 225, 1.4, 42000000, 3400000000000, "Electronic Technology", 9500000000] },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    for (const m of ["us", "xetra", "lse"]) {
      const res = await heatmapGet(new Request(`http://localhost/api/stock-heatmap?market=${m}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rows).toHaveLength(1);
      expect(body.sectors).toEqual(["Electronic Technology"]);
    }
  });

  it("covers /api/stock-base GET 200/400/503 and POST 200/400/503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const m = url.match(/\/chart\/([^?]+)/);
        const sym = m ? decodeURIComponent(m[1]) : "SPY";
        return new Response(JSON.stringify(makeDailyYahooChartJson(sym, { count: 90 })), { status: 200 });
      }),
    );

    const getOk = await stockBaseGet(new Request("http://localhost/api/stock-base?market=us&page=0"));
    expect(getOk.status).toBe(200);
    const getBody = await getOk.json();
    expect(getBody.market).toBe("us");
    expect(getBody.evaluated).toBeGreaterThan(0);

    const postOk = await stockBasePost(
      new Request("http://localhost/api/stock-base", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ market: "us", tickers: ["AAPL"] }),
      }),
    );
    expect(postOk.status).toBe(200);
    expect((await postOk.json()).attempted).toBe(1);

    expect((await stockBaseGet(new Request("http://localhost/api/stock-base?market=mars"))).status).toBe(400);
    expect((await stockBasePost(new Request("http://localhost/api/stock-base", { method: "POST", body: JSON.stringify({ market: "mars", tickers: ["AAPL"] }) }))).status).toBe(400);

    clearYahooCache();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("INTERNAL_YAHOO_FAILURE"); }));
    const getFail = await stockBaseGet(new Request("http://localhost/api/stock-base?market=xetra&page=0"));
    expect(getFail.status).toBe(503);
    expect(JSON.stringify(await getFail.json())).not.toContain("INTERNAL_YAHOO_FAILURE");

    clearYahooCache();
    const postFail = await stockBasePost(
      new Request("http://localhost/api/stock-base", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ market: "us", tickers: ["AAPL"] }),
      }),
    );
    expect(postFail.status).toBe(503);
    expect(JSON.stringify(await postFail.json())).not.toContain("INTERNAL_YAHOO_FAILURE");
  });
});

describe("/api/sync HTTP route coverage", () => {
  it("enforces key auth, peek, pull, PUT 200/400/409/413, and DELETE", async () => {
    const syncKey = "d".repeat(48);
    const validPayload = JSON.stringify({ version: 1, chart: {}, watchlists: {}, alerts: {} });

    expect((await syncGet(new NextRequest("http://localhost/api/sync"))).status).toBe(401);
    expect((await syncPut(new NextRequest("http://localhost/api/sync", { method: "PUT", body: "{}" }))).status).toBe(401);
    expect((await syncDelete(new NextRequest("http://localhost/api/sync", { method: "DELETE" }))).status).toBe(401);

    const peekEmpty = await syncGet(
      new NextRequest("http://localhost/api/sync?peek=1", { headers: { "x-affentrader-sync": syncKey } }),
    );
    expect(peekEmpty.status).toBe(200);
    expect(await peekEmpty.json()).toEqual({ revision: 0, updatedAt: 0, device: "", data: null });

    const putOk = await syncPut(
      new NextRequest("http://localhost/api/sync", {
        method: "PUT",
        headers: { "x-affentrader-sync": syncKey, "content-type": "application/json" },
        body: JSON.stringify({ data: validPayload, baseRevision: 0, device: "desktop" }),
      }),
    );
    expect(putOk.status).toBe(200);
    expect((await putOk.json()).revision).toBe(1);

    const peekFull = await syncGet(
      new NextRequest("http://localhost/api/sync?peek=1", { headers: { "x-affentrader-sync": syncKey } }),
    );
    const peekBody = await peekFull.json();
    expect(peekBody).toMatchObject({ revision: 1, device: "desktop" });
    expect(typeof peekBody.updatedAt).toBe("number");
    expect("data" in peekBody).toBe(false);

    const pullRes = await syncGet(
      new NextRequest("http://localhost/api/sync", { headers: { "x-affentrader-sync": syncKey } }),
    );
    expect(pullRes.status).toBe(200);
    expect((await pullRes.json()).data).toBe(validPayload);

    // 409 conflict over HTTP route must NOT expose current.data
    const conflictRes = await syncPut(
      new NextRequest("http://localhost/api/sync", {
        method: "PUT",
        headers: { "x-affentrader-sync": syncKey, "content-type": "application/json" },
        body: JSON.stringify({ data: validPayload, baseRevision: 0, device: "mobile" }),
      }),
    );
    expect(conflictRes.status).toBe(409);
    const conflictBody = await conflictRes.json();
    expect(conflictBody.current).toMatchObject({ revision: 1, device: "desktop" });
    expect("data" in conflictBody.current).toBe(false);

    // Non-object body -> 400; > MAX_SYNC_BYTES -> 413
    expect(
      (
        await syncPut(
          new NextRequest("http://localhost/api/sync", {
            method: "PUT",
            headers: { "x-affentrader-sync": syncKey, "content-type": "application/json" },
            body: "[]",
          }),
        )
      ).status,
    ).toBe(400);

    expect(
      (
        await syncPut(
          new NextRequest("http://localhost/api/sync", {
            method: "PUT",
            headers: { "x-affentrader-sync": syncKey, "content-type": "application/json" },
            body: JSON.stringify({ data: "x".repeat(8_000_001), baseRevision: 1, device: "desktop" }),
          }),
        )
      ).status,
    ).toBe(413);

    const delRes = await syncDelete(
      new NextRequest("http://localhost/api/sync", {
        method: "DELETE",
        headers: { "x-affentrader-sync": syncKey },
      }),
    );
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ deleted: true });
    expect(
      await (await syncGet(new NextRequest("http://localhost/api/sync", { headers: { "x-affentrader-sync": syncKey } }))).json(),
    ).toEqual({ revision: 0, updatedAt: 0, device: "", data: null });
  });
});

describe("/api/terminal-capm & /api/yahoo route coverage", () => {
  it("computes /api/terminal-capm 200 and handles 400, 422 currency mismatch, 422 insufficient bars, and 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const sym = decodeURIComponent(url.match(/\/chart\/([^?]+)/)?.[1] ?? "");
        if (sym === "SAP.DE") {
          return new Response(JSON.stringify(makeDailyYahooChartJson("SAP.DE", { currency: "EUR", timezone: "Europe/Berlin" })), { status: 200 });
        }
        if (sym === "SHORT") {
          return new Response(JSON.stringify(makeDailyYahooChartJson("SHORT", { count: 15 })), { status: 200 });
        }
        if (sym === "^GSPC") {
          return new Response(JSON.stringify(makeDailyYahooChartJson("^GSPC", { currency: "USD", offsetSlope: 0.25 })), { status: 200 });
        }
        return new Response(JSON.stringify(makeDailyYahooChartJson(sym || "AAPL", { currency: "USD", offsetSlope: 0.45 })), { status: 200 });
      }),
    );

    const okRes = await capmGet(new Request("http://localhost/api/terminal-capm?ticker=AAPL&market=us&rf=4"));
    expect(okRes.status).toBe(200);
    const body = await okRes.json();
    expect(body).toMatchObject({ ticker: "AAPL", benchmark: "S&P 500", currency: "USD", riskFree: 4 });
    expect(typeof body.beta).toBe("number");
    expect(body.observations).toBeGreaterThanOrEqual(29);

    expect((await capmGet(new Request("http://localhost/api/terminal-capm?ticker=bad!&market=us"))).status).toBe(400);
    expect((await capmGet(new Request("http://localhost/api/terminal-capm?ticker=AAPL&market=mars"))).status).toBe(400);
    expect((await capmGet(new Request("http://localhost/api/terminal-capm?ticker=AAPL&market=us&rf=55"))).status).toBe(400);
    expect((await capmGet(new Request("http://localhost/api/terminal-capm?ticker=AAPL&market=us&rf=-25"))).status).toBe(400);

    expect((await capmGet(new Request("http://localhost/api/terminal-capm?ticker=SAP.DE&market=us"))).status).toBe(422);
    expect((await capmGet(new Request("http://localhost/api/terminal-capm?ticker=SHORT&market=us"))).status).toBe(422);

    clearYahooCache();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("INTERNAL_YAHOO_TIMEOUT"); }));
    const errRes = await capmGet(new Request("http://localhost/api/terminal-capm?ticker=AAPL&market=us"));
    expect(errRes.status).toBe(503);
    expect(await errRes.json()).toEqual({ error: "Yahoo Finance daily history is unavailable for this analysis." });
  });

  it("handles /api/yahoo chart, spark, search 200 and length/param 400 validations", async () => {
    const chartJson = makeDailyYahooChartJson("AAPL", { count: 10 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v8/finance/chart/")) {
          return new Response(JSON.stringify(chartJson), { status: 200 });
        }
        if (url.includes("/v8/finance/spark")) {
          return new Response(
            JSON.stringify({ AAPL: { timestamp: [1_700_000_000], close: [225.4], chartPreviousClose: 222.0 } }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ quotes: [{ symbol: "AAPL", shortname: "Apple Inc.", exchDisp: "NASDAQ", quoteType: "EQUITY" }] }),
          { status: 200 },
        );
      }),
    );

    const chartRes = await yahooGet(new NextRequest("http://localhost/api/yahoo?kind=chart&symbol=AAPL&interval=1d&period1=1700000000&period2=1700800000"));
    expect(chartRes.status).toBe(200);
    expect((await chartRes.json()).rows).toHaveLength(10);

    const sparkRes = await yahooGet(new NextRequest("http://localhost/api/yahoo?kind=spark&symbols=AAPL,MSFT"));
    expect(sparkRes.status).toBe(200);
    expect((await sparkRes.json()).quotes.AAPL.price).toBe(225.4);

    const searchRes = await yahooGet(new NextRequest("http://localhost/api/yahoo?kind=search&q=apple"));
    expect(searchRes.status).toBe(200);
    expect((await searchRes.json()).hits[0].symbol).toBe("AAPL");

    expect((await yahooGet(new NextRequest("http://localhost/api/yahoo?kind=bad"))).status).toBe(400);
    expect((await yahooGet(new NextRequest("http://localhost/api/yahoo?kind=chart&symbol=bad!&interval=1d&period1=1700000000&period2=1700800000"))).status).toBe(400);
    expect((await yahooGet(new NextRequest(`http://localhost/api/yahoo?kind=spark&symbols=${"A,".repeat(260)}A`))).status).toBe(400);
    expect((await yahooGet(new NextRequest(`http://localhost/api/yahoo?kind=search&q=${"a".repeat(129)}`))).status).toBe(400);
  });
});

describe("edge regressions on /api/market, /api/alerts, and webhooks", () => {
  it("covers /api/market 200 resources and 400 validation paths", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/klines")) {
          return new Response(JSON.stringify([[1_700_000_000_000, "90000", "90500", "89500", "90200", "10", 1_700_000_060_000, "902000", 5, "5", "451000", "0"]]), { status: 200 });
        }
        if (url.includes("/aggTrades")) {
          return new Response(JSON.stringify([{ a: 1, p: "90200", q: "0.1", f: 1, l: 1, T: 1_700_000_000_000, m: false, M: true }]), { status: 200 });
        }
        if (url.includes("/ticker/24hr")) {
          return new Response(JSON.stringify({ symbol: "BTCUSDT", lastPrice: "90200" }), { status: 200 });
        }
        if (url.includes("/ticker/price")) {
          return new Response(JSON.stringify({ symbol: "BTCUSDT", price: "90200" }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            symbols: [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING" }],
          }),
          { status: 200 },
        );
      }),
    );

    const { GET: marketGet } = await import("@/app/api/market/route");
    expect((await marketGet(new NextRequest("http://localhost/api/market?resource=klines&symbol=BTCUSDT&interval=1m&limit=10"))).status).toBe(200);
    expect((await marketGet(new NextRequest("http://localhost/api/market?resource=aggTrades&symbol=BTCUSDT&limit=10"))).status).toBe(200);
    expect((await marketGet(new NextRequest("http://localhost/api/market?resource=ticker/24hr&symbol=BTCUSDT"))).status).toBe(200);
    expect((await marketGet(new NextRequest("http://localhost/api/market?resource=ticker/price&symbol=BTCUSDT"))).status).toBe(200);
    expect((await marketGet(new NextRequest("http://localhost/api/market?resource=exchangeInfo"))).status).toBe(200);

    expect((await marketGet(new NextRequest("http://localhost/api/market?resource=bad"))).status).toBe(400);
    expect((await marketGet(new NextRequest("http://localhost/api/market?resource=ticker/price&symbol=bad!"))).status).toBe(400);
    expect((await marketGet(new NextRequest("http://localhost/api/market?resource=aggTrades"))).status).toBe(400);
    expect((await marketGet(new NextRequest("http://localhost/api/market?resource=aggTrades&symbol=BTCUSDT&limit=1001"))).status).toBe(400);
  });

  it("rejects null/array readJson bodies and sanitizes 500 catches on alerts & events routes", async () => {
    const key = await accessKey();
    const headers = { "x-affentrader-key": key, "content-type": "application/json" };

    for (const badBody of ["null", "[]"]) {
      expect((await alertsPut(new NextRequest("http://localhost/api/alerts", { method: "PUT", headers, body: badBody }))).status).toBe(400);
      expect((await alertsPatch(new NextRequest("http://localhost/api/alerts", { method: "PATCH", headers, body: badBody }))).status).toBe(400);
      expect((await alertsPost(new NextRequest("http://localhost/api/alerts", { method: "POST", headers, body: badBody }))).status).toBe(400);
      expect((await eventsPost(new NextRequest("http://localhost/api/alerts/events", { method: "POST", headers, body: badBody }))).status).toBe(400);
    }

    expect(
      (
        await alertsDelete(
          new NextRequest("http://localhost/api/alerts", {
            method: "DELETE",
            headers: { "x-affentrader-key": key },
          }),
        )
      ).status,
    ).toBe(400);

    vi.resetModules();
    vi.doMock("@/lib/server/alertService", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/server/alertService")>();
      return {
        ...actual,
        store: { read: vi.fn(async () => { throw new Error("INTERNAL_STORE_STACK"); }) },
        deleteRule: vi.fn(async () => { throw new Error("INTERNAL_DELETE_STACK"); }),
        listEvents: vi.fn(async () => { throw new Error("INTERNAL_EVENTS_STACK"); }),
      };
    });
    try {
      const { GET: isolatedGet, DELETE: isolatedDelete } = await import("@/app/api/alerts/route");
      const { GET: isolatedEventsGet } = await import("@/app/api/alerts/events/route");

      const getFail = await isolatedGet(new NextRequest("http://localhost/api/alerts", { headers: { "x-affentrader-key": key } }));
      expect(getFail.status).toBe(500);
      expect(await getFail.json()).toEqual({ error: "Alert service error." });

      const delFail = await isolatedDelete(new NextRequest("http://localhost/api/alerts?id=r1", { method: "DELETE", headers: { "x-affentrader-key": key } }));
      expect(delFail.status).toBe(500);
      expect(await delFail.json()).toEqual({ error: "Alert service error." });

      const evFail = await isolatedEventsGet(new NextRequest("http://localhost/api/alerts/events", { headers: { "x-affentrader-key": key } }));
      expect(evFail.status).toBe(500);
      expect(await evFail.json()).toEqual({ error: "Alert service error." });
    } finally {
      vi.doUnmock("@/lib/server/alertService");
      vi.resetModules();
    }
  });

  it("cancels webhook response bodies on both 302 redirects and 500 errors", async () => {
    vi.stubEnv("AFFENTRADER_ALLOW_PRIVATE_WEBHOOKS", "1");
    for (const status of [302, 500]) {
      const cancel = vi.fn(async () => undefined);
      const mockFetcher = vi.fn(async () => ({
        status,
        ok: false,
        body: { cancel },
      })) as unknown as typeof fetch;

      await expect(
        deliverWebhook(
          "http://127.0.0.1:9/hook",
          undefined,
          {
            event: "alert.test",
            rule: { id: "r", name: "R" },
            symbol: "BTCUSDT",
            timeframe: "1m",
            price: 100,
            time: 1000,
            message: "err",
            source: "server",
          },
          mockFetcher,
        ),
      ).rejects.toThrow();
      expect(cancel).toHaveBeenCalledTimes(1);
    }
  });
});

describe("Bybit market route", () => {
  it("normalizes checked native candles and instruments for the exact exchange category", async () => {
    const upstream = vi.fn(async (url: string) => {
      const query = new URL(url);
      const list = query.pathname.endsWith("/kline") ?
        [["120000", "101", "104", "100", "102", "20"], ["60000", "99", "102", "98", "100", "12"], ["0", "1", "1", "1", "1", "1"]] :
        [{ symbol: "BTCUSDT", priceFilter: { tickSize: "0.1" }, lotSizeFilter: { qtyStep: "0.001" } }];
      return Response.json({ retCode: 0, result: { list } });
    });
    vi.stubGlobal("fetch", upstream);
    try {
      const read = (query: string) => bybitGet(new NextRequest(`http://localhost/api/bybit?${query}`));
      const symbol = encodeURIComponent("BYBIT:LINEAR:BTCUSDT");
      expect((await read(`kind=candles&symbol=${symbol}&interval=1&limit=0`)).status).toBe(400);
      expect((await read("kind=tickers&category=invalid")).status).toBe(400);
      expect(upstream).not.toHaveBeenCalled();
      const history = await read(`kind=candles&symbol=${symbol}&interval=1&limit=1000&end=120000`);
      expect(await history.json()).toEqual({ candles: [[60000, 99, 102, 98, 100, 12], [120000, 101, 104, 100, 102, 20]] });
      const instrument = await read(`kind=instrument&symbol=${symbol}`);
      expect(await instrument.json()).toEqual({ tickSize: 0.1, quantityStep: 0.001 });
      expect(upstream.mock.calls.map(([url]) => new URL(url).searchParams.get("category"))).toEqual(["linear", "linear"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
