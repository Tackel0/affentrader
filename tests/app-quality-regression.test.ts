import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scryptSync } from "node:crypto";
import { NextRequest } from "next/server";

const mockState = vi.hoisted(() => ({
  terminalMarketsError: false,
  extendedTelemetryError: false,
}));

vi.mock("@/lib/server/terminalMarkets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/terminalMarkets")>();
  return {
    ...actual,
    terminalMarkets: async () => {
      if (mockState.terminalMarketsError) throw new Error("Markets feed timed out");
      return actual.terminalMarkets();
    },
  };
});

vi.mock("@/lib/server/osint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/osint")>();
  return {
    ...actual,
    fetchOsintMapData: async () => {
      if (mockState.extendedTelemetryError) {
        return {
          generatedAt: 1_700_000_000_000,
          vessels: [],
          flights: [],
          chokepoints: [],
          routes: [],
          correlatedTickers: [],
          feedStatus: {
            ais: { ok: false, count: 0, provider: "Digitraffic Marine AIS" },
            adsb: { ok: true, count: 0, provider: "adsb.lol" },
          },
          weather: [],
        };
      }
      return actual.fetchOsintMapData();
    },
  };
});

vi.mock("@/lib/server/osintTelemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/osintTelemetry")>();
  return {
    ...actual,
    fetchExtendedOsintTelemetry: async () => {
      if (mockState.extendedTelemetryError) throw new Error("Extended telemetry down");
      return actual.fetchExtendedOsintTelemetry();
    },
  };
});

import { proxy } from "@/proxy";
import { SITE_COOKIE } from "@/lib/server/siteAccess";
import { accessKey, isSameOriginRequest, resetAccessKeyCache } from "@/lib/server/security";
import { POST as alpacaPost } from "@/app/api/alpaca/route";
import { setBoundedCache } from "@/lib/server/cache";
import { fetchTradingViewScannerBatch, mergeAnalystConsensus } from "@/lib/server/fundamentals";
import { decodeEntities } from "@/lib/server/feeds";
import { JsonStore } from "@/lib/server/storage";
import { GET as terminalMarketsGet } from "@/app/api/terminal-markets/route";
import { GET as osintMapGet } from "@/app/api/osint-map/route";
import { createDebouncedStorage, createShallowPersistStorage } from "@/lib/debouncedStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const salt = "a".repeat(32);
const settings = {
  passwordHash: `${salt}:${scryptSync("test-password", salt, 64).toString("hex")}`,
  secret: "b".repeat(64),
};

function stubSiteAccessEnv() {
  vi.stubEnv("AFFENTRADER_SITE_PASSWORD_HASH", settings.passwordHash);
  vi.stubEnv("AFFENTRADER_SITE_SESSION_SECRET", settings.secret);
}

const tempDirs: string[] = [];

function makeTempDir(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("Reverse-proxy security, server stability & data resilience regressions", () => {
  afterEach(() => {
    mockState.terminalMarketsError = false;
    mockState.extendedTelemetryError = false;
    resetAccessKeyCache();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    while (tempDirs.length) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("sets Secure cookie and preserves external Host/HTTPS protocol across reverse-proxy redirects", async () => {
    stubSiteAccessEnv();
    // Unauthenticated request behind Envoy/Azure HTTPS termination normalizing URL to 0.0.0.0:3000
    const gated = await proxy(
      new NextRequest("http://0.0.0.0:3000/?symbol=HL:BTC", {
        headers: {
          host: "terminal.example.com",
          "x-forwarded-proto": "https",
        },
      }),
    );
    expect(gated.status).toBe(303);
    expect(gated.headers.get("location")).toBe(
      "https://terminal.example.com/login?next=%2F%3Fsymbol%3DHL%3ABTC",
    );

    // Valid POST /login behind TLS-terminating proxy emits Secure cookie & external redirect
    const loginRes = await proxy(
      new NextRequest("http://0.0.0.0:3000/login", {
        method: "POST",
        headers: {
          host: "terminal.example.com",
          origin: "https://terminal.example.com",
          "x-forwarded-proto": "https, http",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "password=test-password&next=%2F",
      }),
    );
    expect(loginRes.status).toBe(303);
    expect(loginRes.headers.get("location")).toBe("https://terminal.example.com/");
    expect(loginRes.cookies.get(SITE_COOKIE)?.secure).toBe(true);

    // Malformed Host header (open redirect / userinfo injection) safely falls back to request.url
    const fallbackRedirect = await proxy(
      new NextRequest("http://localhost:3000/", {
        headers: {
          host: "evil.test/@attacker",
        },
      }),
    );
    expect(fallbackRedirect.status).toBe(303);
    expect(fallbackRedirect.headers.get("location")).toMatch(/^http:\/\/localhost:3000\/login\?/);
  });

  it("permits unauthenticated GET/HEAD on PUBLIC_PWA_PATHS while keeping /icon.svg, /api, and POST gated", async () => {
    stubSiteAccessEnv();
    for (const pwaPath of [
      "/manifest.webmanifest",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-maskable-512.png",
      "/icons/apple-touch-icon.png",
    ]) {
      const getRes = await proxy(new NextRequest(`https://terminal.example.com${pwaPath}`, { method: "GET" }));
      expect(getRes.headers.get("x-middleware-next")).toBe("1");
      expect(getRes.headers.get("x-content-type-options")).toBe("nosniff");
      expect(getRes.headers.get("cache-control")).toBe(
        pwaPath === "/manifest.webmanifest" ? "no-store" : "public, max-age=3600",
      );

      const headRes = await proxy(new NextRequest(`https://terminal.example.com${pwaPath}`, { method: "HEAD" }));
      expect(headRes.headers.get("x-middleware-next")).toBe("1");
    }

    // /icon.svg remains gated for pre-auth redirect contract; POST on manifest is blocked; API returns 401
    expect((await proxy(new NextRequest("https://terminal.example.com/icon.svg"))).status).toBe(303);
    expect(
      (await proxy(new NextRequest("https://terminal.example.com/manifest.webmanifest", { method: "POST" }))).status,
    ).toBe(401);
    expect((await proxy(new NextRequest("https://terminal.example.com/api/market"))).status).toBe(401);
  });

  it("validates Host-aware same-origin across proxy.ts and /api/alpaca POST", async () => {
    const proxiedSameOrigin = new NextRequest("http://0.0.0.0:3000/api/alpaca", {
      method: "POST",
      headers: {
        host: "terminal.example.com",
        origin: "https://terminal.example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(isSameOriginRequest(proxiedSameOrigin, { allowMissingOrigin: false })).toBe(true);
    // Passes origin gate on /api/alpaca and reaches input validation (status 400/401, NOT 403)
    const validOriginRes = await alpacaPost(proxiedSameOrigin);
    expect(validOriginRes.status).not.toBe(403);

    // Cross-site header or mismatched Origin MUST still be refused with 403
    const crossSiteReq = new NextRequest("http://0.0.0.0:3000/api/alpaca", {
      method: "POST",
      headers: {
        host: "terminal.example.com",
        origin: "https://terminal.example.com",
        "sec-fetch-site": "cross-site",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect((await alpacaPost(crossSiteReq)).status).toBe(403);

    const evilOriginReq = new NextRequest("http://0.0.0.0:3000/api/alpaca", {
      method: "POST",
      headers: {
        host: "terminal.example.com",
        origin: "https://evil.example.com",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect((await alpacaPost(evilOriginReq)).status).toBe(403);
  });

  it("deduplicates concurrent accessKey() cold starts and serializes atomic JsonStore writes cleanly", async () => {
    const dir = makeTempDir("affentrader-security-");
    vi.stubEnv("AFFENTRADER_DATA", dir);
    vi.stubEnv("NETLIFY", "");
    vi.stubEnv("NETLIFY_BLOBS_CONTEXT", "");
    resetAccessKeyCache();

    // Parallel cold-start calls resolve to the exact same key without EEXIST crash
    const keys = await Promise.all(Array.from({ length: 8 }, () => accessKey()));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^[a-f0-9]{48}$/);

    // Concurrent JsonStore updates serialize via per-call temp files without colliding
    const store = new JsonStore<{ count: number }>("regression-doc", () => ({ count: 0 }), () => dir);
    await Promise.all(
      Array.from({ length: 10 }, (_, idx) => store.update((doc) => ({ count: doc.count + idx + 1 }))),
    );
    expect(await store.read()).toEqual({ count: 55 });
  });

  it("bounds LRU caches, preserves genuine zero analyst counts, and guards XML code point entities", () => {
    // 1. Bounded cache evicts oldest untouched entry and keeps refreshed key warm
    const cache = new Map<string, number>();
    setBoundedCache(cache, "a", 1, 2);
    setBoundedCache(cache, "b", 2, 2);
    setBoundedCache(cache, "a", 10, 2); // refresh "a" -> "b" is oldest
    setBoundedCache(cache, "c", 3, 2); // evicts "b"
    expect([...cache.entries()]).toEqual([
      ["a", 10],
      ["c", 3],
    ]);

    // 2. mergeAnalystConsensus keeps real 0 hold/sell when buy > 0 without mixing Nasdaq counts
    const existingWithZeros = {
      buy: 8,
      hold: 0,
      sell: 0,
      ratingLabel: "Strong Buy",
      analystCount: 8,
      targetLow: null,
      targetMean: null,
      targetHigh: null,
    };
    const nasdaqMixed = {
      buy: 10,
      hold: 4,
      sell: 2,
      ratingLabel: "Moderate Buy",
      analystCount: 16,
      targetLow: 150,
      targetMean: 185,
      targetHigh: 210,
    };
    const merged = mergeAnalystConsensus(existingWithZeros, nasdaqMixed);
    expect(merged).toMatchObject({
      buy: 8,
      hold: 0,
      sell: 0,
      analystCount: 8,
      targetMean: 185,
    });

    // Empty 0/0/0 existing falls back cleanly to Nasdaq
    const emptyExisting = {
      buy: 0,
      hold: 0,
      sell: 0,
      ratingLabel: "",
      analystCount: 0,
      targetLow: null,
      targetMean: null,
      targetHigh: null,
    };
    expect(mergeAnalystConsensus(emptyExisting, nasdaqMixed)).toMatchObject({
      buy: 10,
      hold: 4,
      sell: 2,
      analystCount: 16,
    });

    // 3. decodeEntities does not throw RangeError on out-of-range decimal/hex XML entities
    expect(decodeEntities("A &#99999999; &#x110000; &#x41; &#66;")).toBe("A &#99999999; &#x110000; A B");
  });

  it("does not poison tvCache when TradingView scanner fails and recovers on immediate retry", async () => {
    let calls = 0;
    const customFetcher: typeof fetch = async () => {
      calls++;
      if (calls === 1) {
        return new Response("Gateway Timeout", { status: 504 });
      }
      return Response.json({
        data: [
          {
            s: "NASDAQ:NVDA",
            d: [
              "NVDA",
              "NVIDIA Corp",
              "Electronic Technology",
              "USD",
              140,
              3_400_000_000_000,
              35,
              1.4,
              28,
              40,
              -0.2,
              62,
              55,
              115,
              94,
              165,
            ],
          },
        ],
      });
    };

    const firstAttempt = await fetchTradingViewScannerBatch("us", ["NVDA_NONPOISON"], customFetcher);
    expect(firstAttempt.size).toBe(0);

    // Note: matchTicker compares rawName === ticker.replace(/\.(DE|L)$/i, "").toUpperCase()
    const customFetcherExact: typeof fetch = async () => {
      calls++;
      if (calls === 2) return new Response("Service Unavailable", { status: 503 });
      return Response.json({
        data: [
          {
            s: "NASDAQ:AVGO",
            d: ["AVGO", "Broadcom Inc.", "Technology", "USD", 180, 840_000_000_000, 29, 1.5, 22, 31, 0.8, 38, 30, 42, 34, 210],
          },
        ],
      });
    };
    const failed = await fetchTradingViewScannerBatch("us", ["AVGO"], customFetcherExact);
    expect(failed.size).toBe(0);

    const recovered = await fetchTradingViewScannerBatch("us", ["AVGO"], customFetcherExact);
    expect(recovered.get("AVGO")?.name).toBe("Broadcom Inc.");
    expect(recovered.get("AVGO")?.forwardPe).toBe(29);
  });

  it("returns 503 JSON on terminal-markets failure and structured arrays when extended osint telemetry fails", async () => {
    mockState.terminalMarketsError = true;
    const marketsRes = await terminalMarketsGet();
    expect(marketsRes.status).toBe(503);
    expect(await marketsRes.json()).toEqual({ error: "Markets feed timed out" });

    mockState.extendedTelemetryError = true;
    const osintRes = await osintMapGet();
    expect(osintRes.status).toBe(200);
    const body = await osintRes.json();
    expect(body).toMatchObject({
      marineConditions: [],
      advisories: [],
      aisSources: [],
      adsbSources: ["adsb.lol (/v2/mil, FRA, Hormuz)"],
    });
  });

  it("skips JSON.stringify on hot non-persisted state updates in createShallowPersistStorage", () => {
    const backing = new Map<string, string>();
    const rawStorage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v); },
      removeItem: (k: string) => { backing.delete(k); },
    } as unknown as Storage;
    const debounced = createDebouncedStorage(0, () => rawStorage);
    const persistStorage = createShallowPersistStorage<{ symbol: string; timeframe: string }>(debounced);

    const store = create<{
      symbol: string;
      timeframe: string;
      quotes: Record<string, number>;
      trades: number[];
    }>()(
      persist(
        () => ({
          symbol: "BTCUSDT",
          timeframe: "15m",
          quotes: {} as Record<string, number>,
          trades: [] as number[],
        }),
        {
          name: "perf-test-store",
          storage: persistStorage,
          partialize: (s) => ({ symbol: s.symbol, timeframe: s.timeframe }),
        },
      ),
    );

    const stringifySpy = vi.spyOn(JSON, "stringify");
    try {
      stringifySpy.mockClear();

      // First persisted change triggers serialization
      store.setState({ timeframe: "1h" });
      debounced.flush();
      expect(stringifySpy).toHaveBeenCalledTimes(1);

      // 50 hot market ticks on non-persisted fields MUST trigger 0 JSON.stringify calls
      stringifySpy.mockClear();
      for (let i = 0; i < 50; i++) {
        store.setState({ quotes: { BTCUSDT: 90000 + i }, trades: [i] });
      }
      debounced.flush();
      expect(stringifySpy).toHaveBeenCalledTimes(0);

      // Subsequent persisted change serializes cleanly
      store.setState({ symbol: "ETHUSDT" });
      debounced.flush();
      expect(stringifySpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(backing.get("perf-test-store") ?? "{}").state).toEqual({
        symbol: "ETHUSDT",
        timeframe: "1h",
      });

      // Clearing backing storage invalidates cache skip so re-write still serializes cleanly
      backing.clear();
      debounced.discard();
      store.setState({ symbol: "ETHUSDT" });
      debounced.flush();
      expect(backing.get("perf-test-store")).toContain("ETHUSDT");
    } finally {
      stringifySpy.mockRestore();
    }
  });
});
