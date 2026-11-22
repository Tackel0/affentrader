import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { scryptSync } from "node:crypto";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { createSiteSession, SITE_COOKIE } from "@/lib/server/siteAccess";
import { accessKey, HttpError, isSameOriginRequest, readJson, resetAccessKeyCache, resetApiRateLimit } from "@/lib/server/security";
import { logError, logInfo, logWarn, redactForLog } from "@/lib/server/logger";
import { isPrivateAddress, parseWebhookUrl, resolvePublicAddresses, deliverWebhook, WebhookError } from "@/lib/server/webhooks";
import { parseMaritimeAdvisoriesRss } from "@/lib/server/osintTelemetry";
import { clearFeedCache, parseRss } from "@/lib/server/feeds";
import { clearScreenerCache } from "@/lib/server/screener";
import { clearYahooCache } from "@/lib/server/yahoo";
import { clearHyperliquidCache } from "@/lib/server/hyperliquid";
import { pushSync, SyncError } from "@/lib/server/sync";
import { publishScript } from "@/lib/server/library";
import { GET as healthGet, HEAD as healthHead } from "@/app/api/health/route";
import { GET as alertsGet, DELETE as alertsDelete, PATCH as alertsPatch, POST as alertsPost, PUT as alertsPut } from "@/app/api/alerts/route";
import { GET as eventsGet, POST as eventsPost } from "@/app/api/alerts/events/route";
import { DELETE as pushDelete, POST as pushPost } from "@/app/api/push/route";
import { GET as libraryGet, PUT as libraryPut, DELETE as libraryDelete } from "@/app/api/library/route";
import { PUT as syncPut } from "@/app/api/sync/route";
import { GET as screenerGet } from "@/app/api/screener/route";
import { GET as heatmapGet } from "@/app/api/stock-heatmap/route";
import { GET as feedsGet } from "@/app/api/feeds/route";
import { GET as hyperliquidGet } from "@/app/api/hyperliquid/route";
import { GET as yahooGet } from "@/app/api/yahoo/route";
import { GET as stockBaseGet, POST as stockBasePost } from "@/app/api/stock-base/route";
import { GET as oppsGet, POST as oppsPost } from "@/app/api/terminal-opportunities/route";
import { GET as fundamentalsGet } from "@/app/api/terminal-fundamentals/route";

const TEST_SALT = "a".repeat(32);
const TEST_HASH = `${TEST_SALT}:${scryptSync("pw-check", TEST_SALT, 64).toString("hex")}`;
const TEST_SECRET = "b".repeat(64);

let tempDir = "";

function stubSiteAuth() {
  vi.stubEnv("AFFENTRADER_SITE_PASSWORD_HASH", TEST_HASH);
  vi.stubEnv("AFFENTRADER_SITE_SESSION_SECRET", TEST_SECRET);
  return createSiteSession({ passwordHash: TEST_HASH, secret: TEST_SECRET });
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "affentrader-sec-"));
  vi.stubEnv("AFFENTRADER_DATA", tempDir);
  resetAccessKeyCache();
  resetApiRateLimit();
  clearFeedCache();
  clearScreenerCache();
  clearYahooCache();
  clearHyperliquidCache();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetAccessKeyCache();
  resetApiRateLimit();
  clearFeedCache();
  clearScreenerCache();
  clearYahooCache();
  clearHyperliquidCache();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = "";
});

describe("/api/health & proxy hardening", () => {
  it("allows unauthenticated GET/HEAD /api/health without creating access-key.txt or leaking runner internals", async () => {
    stubSiteAuth();
    vi.stubEnv("CONTAINER_APP_REVISION", "rev-42");

    const proxiedGet = await proxy(new NextRequest("http://localhost:3000/api/health", { method: "GET" }));
    expect(proxiedGet.headers.get("x-middleware-next")).toBe("1");
    expect(proxiedGet.headers.get("cache-control")).toBe("no-store");
    expect(proxiedGet.headers.get("x-content-type-options")).toBe("nosniff");
    expect(proxiedGet.headers.get("x-frame-options")).toBe("DENY");

    const proxiedHead = await proxy(new NextRequest("http://localhost:3000/api/health", { method: "HEAD" }));
    expect(proxiedHead.headers.get("x-middleware-next")).toBe("1");

    const res = await healthGet(new NextRequest("http://localhost:3000/api/health"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: "ok", revision: "rev-42" });
    expect(typeof body.timestamp).toBe("string");
    expect(body.uptimeSec).toBeUndefined();
    expect(body.runner).toBeUndefined();

    // Unauthenticated GET /api/health with bogus x-affentrader-key must return 200 public payload without creating .data/access-key.txt
    const bogusKeyRes = await healthGet(
      new NextRequest("http://localhost:3000/api/health", {
        headers: { "x-affentrader-key": "bogus" },
      }),
    );
    expect(bogusKeyRes.status).toBe(200);
    const bogusKeyBody = await bogusKeyRes.json();
    expect(bogusKeyBody).toMatchObject({ ok: true, status: "ok", revision: "rev-42" });
    expect(bogusKeyBody.uptimeSec).toBeUndefined();
    expect(bogusKeyBody.runner).toBeUndefined();

    const headRes = await healthHead();
    expect(headRes.status).toBe(200);
    expect(headRes.headers.get("cache-control")).toBe("no-store");

    // Unauthenticated health probe (with or without bogus key header) must not materialize .data/access-key.txt
    await expect(access(path.join(tempDir, "access-key.txt"))).rejects.toThrow();

    // Cross-origin POST /api/health is rejected in open mode, and returns 401 when site password gate is enabled
    expect((await proxy(new NextRequest("http://localhost:3000/api/health", { method: "POST", headers: { origin: "https://evil.example" } }))).status).toBe(403);
    vi.stubEnv("AFFENTRADER_REQUIRE_SITE_PASSWORD", "1");
    expect((await proxy(new NextRequest("http://localhost:3000/api/health", { method: "POST" }))).status).toBe(401);
    vi.stubEnv("AFFENTRADER_REQUIRE_SITE_PASSWORD", "");
  });

  it("allows GET /api/health even when site access env vars are unset", async () => {
    vi.stubEnv("AFFENTRADER_SITE_PASSWORD_HASH", "");
    vi.stubEnv("AFFENTRADER_SITE_SESSION_SECRET", "");
    const proxied = await proxy(new NextRequest("http://localhost:3000/api/health", { method: "GET" }));
    expect(proxied.headers.get("x-middleware-next")).toBe("1");
  });

  it("includes uptimeSec and sanitized runner metadata on authenticated /api/health", async () => {
    const token = stubSiteAuth();
    const res = await healthGet(
      new NextRequest("http://localhost:3000/api/health", {
        headers: { cookie: `${SITE_COOKIE}=${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.uptimeSec).toBe("number");
    expect("runner" in body).toBe(true);

    const key = await accessKey();
    const keyRes = await healthGet(
      new Request("http://localhost:3000/api/health", {
        headers: { "x-affentrader-key": key },
      }),
    );
    expect(keyRes.status).toBe(200);
    const keyBody = await keyRes.json();
    expect(typeof keyBody.uptimeSec).toBe("number");

    // When alertRunner has errors, only sanitized errorCount is exposed (never raw lastErrors text)
    vi.resetModules();
    vi.doMock("@/lib/server/alertRunner", () => ({
      runnerStatus: () => ({
        running: true,
        startedAt: 1000,
        lastRunAt: 2000,
        lastDurationMs: 50,
        lastEvaluated: 3,
        lastFired: 1,
        lastErrors: ["SECRET_INTERNAL_STACK_ERR"],
        intervalMs: 15000,
        runs: 5,
      }),
    }));
    try {
      const { GET: isolatedHealthGet } = await import("@/app/api/health/route");
      const runnerRes = await isolatedHealthGet(
        new NextRequest("http://localhost:3000/api/health", {
          headers: { cookie: `${SITE_COOKIE}=${token}` },
        }),
      );
      expect(runnerRes.status).toBe(200);
      const runnerBody = await runnerRes.json();
      expect(runnerBody.runner).toEqual({
        running: true,
        startedAt: 1000,
        lastRunAt: 2000,
        lastDurationMs: 50,
        lastEvaluated: 3,
        lastFired: 1,
        intervalMs: 15000,
        runs: 5,
        errorCount: 1,
      });
      expect(JSON.stringify(runnerBody)).not.toContain("SECRET_INTERNAL_STACK_ERR");
    } finally {
      vi.doUnmock("@/lib/server/alertRunner");
      vi.resetModules();
    }
  });

  it("sets CSP, Permissions-Policy, and X-Frame-Options on authenticated pages and APIs", async () => {
    const token = stubSiteAuth();

    const httpPage = await proxy(
      new NextRequest("http://localhost:3000/", {
        headers: { cookie: `${SITE_COOKIE}=${token}` },
      }),
    );
    expect(httpPage.headers.get("x-frame-options")).toBe("DENY");
    expect(httpPage.headers.get("permissions-policy")).toContain("camera=()");
    const httpCsp = httpPage.headers.get("content-security-policy") ?? "";
    expect(httpCsp).toContain("default-src 'self'");
    expect(httpCsp).toContain("wss://data-stream.binance.vision");
    expect(httpCsp).toContain("wss://ws.kraken.com");
    expect(httpCsp).toContain("wss://api.hyperliquid.xyz");
    expect(httpCsp).toContain("wss://stream.data.alpaca.markets");
    expect(httpCsp).toContain("frame-ancestors 'none'");
    expect(httpCsp).not.toContain("upgrade-insecure-requests");

    const httpsPage = await proxy(
      new NextRequest("https://terminal.example.com/", {
        headers: { cookie: `${SITE_COOKIE}=${token}`, "x-forwarded-proto": "https" },
      }),
    );
    expect(httpsPage.headers.get("content-security-policy")).toContain("upgrade-insecure-requests");

    const apiRes = await proxy(
      new NextRequest("https://terminal.example.com/api/market?resource=ticker/24hr", {
        headers: { cookie: `${SITE_COOKIE}=${token}` },
      }),
    );
    expect(apiRes.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    expect(apiRes.headers.get("x-frame-options")).toBe("DENY");

    expect(
      isSameOriginRequest(
        new Request("http://localhost:3000/api/alpaca", {
          method: "POST",
          headers: { host: "LocalHost:3000", origin: "http://localhost:3000" },
        }),
      ),
    ).toBe(true);
  });

  it("rate limits authenticated API requests with 429 and Retry-After (including trailing-slash heavy routes)", async () => {
    const token = stubSiteAuth();
    const headers = { cookie: `${SITE_COOKIE}=${token}` };

    // Heavy tier limit is 60/min (including trailing slash /api/screener/)
    for (let i = 0; i < 60; i++) {
      const ok = await proxy(new NextRequest("http://localhost:3000/api/screener/", { headers }));
      expect(ok.headers.get("x-middleware-next")).toBe("1");
    }
    const blockedHeavy = await proxy(new NextRequest("http://localhost:3000/api/terminal-opportunities", { headers }));
    expect(blockedHeavy.status).toBe(429);
    expect(Number(blockedHeavy.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);

    // Read tier has an independent 240/min bucket
    for (let i = 0; i < 240; i++) {
      const ok = await proxy(new NextRequest("http://localhost:3000/api/alerts", { headers }));
      expect(ok.headers.get("x-middleware-next")).toBe("1");
    }
    const blockedRead = await proxy(new NextRequest("http://localhost:3000/api/alerts", { headers }));
    expect(blockedRead.status).toBe(429);
    expect(Number(blockedRead.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });
});

describe("structured logger & redaction", () => {
  it("redacts credentials, query secrets, bearer tokens, Web Push keys.auth, user-only URLs, circular refs, and error stacks", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const cyclic: Record<string, unknown> = { ok: "value", secret: "top-secret-123" };
    cyclic.self = cyclic;

    const err = Object.assign(
      new Error("Failed fetching https://user:pw123@api.test/v1?apiKey=secretkey&token=tok999 Bearer jwt.token.sig"),
      { secret: "hidden", status: 503 },
    );

    logError("test.err", err, {
      password: "raw-password",
      "x-affentrader-key": "k123",
      nested: cyclic,
    });
    logWarn("test.warn", { items: Array.from({ length: 25 }, (_, i) => i) });
    logInfo("test.info", { url: new URL("https://bob:pass@example.com/hook?secret=abc") });

    const logged = JSON.parse(String(errSpy.mock.calls[0][0]));
    expect(logged.level).toBe("error");
    expect(logged.event).toBe("test.err");
    expect(logged.password).toBe("[REDACTED]");
    expect(logged["x-affentrader-key"]).toBe("[REDACTED]");
    expect(logged.nested.secret).toBe("[REDACTED]");
    expect(logged.nested.self).toBe("[Circular]");
    expect(logged.error.stack).toBeUndefined();
    expect(logged.error.message).not.toContain("pw123");
    expect(logged.error.message).not.toContain("secretkey");
    expect(logged.error.message).not.toContain("tok999");
    expect(logged.error.message).not.toContain("jwt.token.sig");
    expect(logged.error.status).toBe(503);

    const warned = JSON.parse(String(warnSpy.mock.calls[0][0]));
    expect(warned.items).toHaveLength(21);
    expect(warned.items[20]).toContain("5 more");

    const infoed = JSON.parse(String(infoSpy.mock.calls[0][0]));
    expect(infoed.url).toBe("https://[REDACTED]:[REDACTED]@example.com/hook?secret=[REDACTED]");

    const pushAndPrefixed = redactForLog({
      sub: {
        endpoint: "https://push.test/1",
        keys: { p256dh: "PUB_KEY_VAL", auth: "AUTH_SECRET_VALUE" },
      },
      userOnlyUrl: "https://my_secret_token@api.test/v1",
      prefixedQuery:
        "https://api.test/v1?access_token=ACC_TOK_123&client_secret=CS_456&refresh_token=RT_789&api_key=AK_000",
    }) as {
      sub: { keys: { p256dh: string; auth: string } };
      userOnlyUrl: string;
      prefixedQuery: string;
    };
    expect(pushAndPrefixed.sub.keys.p256dh).toBe("[REDACTED]");
    expect(pushAndPrefixed.sub.keys.auth).toBe("[REDACTED]");
    expect(pushAndPrefixed.userOnlyUrl).toBe("https://[REDACTED]@api.test/v1");
    expect(pushAndPrefixed.prefixedQuery).toBe(
      "https://api.test/v1?access_token=[REDACTED]&client_secret=[REDACTED]&refresh_token=[REDACTED]&api_key=[REDACTED]",
    );
    expect(JSON.stringify(pushAndPrefixed)).not.toContain("AUTH_SECRET_VALUE");
    expect(JSON.stringify(pushAndPrefixed)).not.toContain("my_secret_token");
    expect(JSON.stringify(pushAndPrefixed)).not.toContain("ACC_TOK_123");

    expect(redactForLog("x".repeat(600))).toHaveLength(500);
  });
});

describe("readJson streaming bounds & object enforcement", () => {
  it("cancels oversized chunked streams without content-length and rejects non-object JSON", async () => {
    let cancelled = false;
    const hugeStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(128)));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(readJson(new Request("http://localhost/api", { method: "POST", body: hugeStream, duplex: "half" } as RequestInit), 256)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);

    for (const nonObject of ["[]", '"hello"', "123", "true", "null", ""]) {
      await expect(
        readJson(new Request("http://localhost/api", { method: "POST", body: nonObject })),
      ).rejects.toBeInstanceOf(HttpError);
    }
  });
});

describe("webhook SSRF & DNS rebinding protection", () => {
  it("blocks expanded IPv4/IPv6 private, documentation, Teredo, ORCHID, NAT64, 6to4, and zone-ID addresses", async () => {
    for (const bad of [
      "0.0.0.0",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "fe80::1",
      "fec0::1",
      "fc00::1",
      "100::1",
      "2001::1",
      "2001:0:4136:e378:8000:63bf:3fff:fdd2",
      "2001:10::1",
      "2001:20::1",
      "2001:db8::1",
      "2001:2::1",
      "ff02::1",
      "::ffff:7f00:1",
      "::ffff:169.254.169.254",
      "64:ff9b::127.0.0.1",
      "64:ff9b:1::1",
      "2002:7f00:1::1",
      "fe80::1%eth0",
    ]) {
      expect(isPrivateAddress(bad)).toBe(true);
    }
    for (const good of ["1.1.1.1", "93.184.216.34", "::ffff:8.8.8.8", "2606:4700:4700::1111"]) {
      expect(isPrivateAddress(good)).toBe(false);
    }
    expect(() => parseWebhookUrl("http://[fe80::1%25eth0]/hook")).toThrow();

    for (const specialIpv6Url of [
      "http://[2001::1]/hook",
      "http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/hook",
      "http://[2001:10::1]/hook",
      "http://[2001:20::1]/hook",
    ]) {
      await expect(resolvePublicAddresses(parseWebhookUrl(specialIpv6Url))).rejects.toThrow(WebhookError);
    }
  });

  it("delivers via pinned socket transport on default path, fast-rejects 302 with unclosed body, and cancels fetcher streams", async () => {
    const cancel = vi.fn(async () => undefined);
    const mockFetcher = vi.fn(async () => ({
      status: 200,
      ok: true,
      body: { cancel },
    })) as unknown as typeof fetch;

    vi.stubEnv("AFFENTRADER_ALLOW_PRIVATE_WEBHOOKS", "1");
    await deliverWebhook(
      "http://127.0.0.1:9/hook",
      "sec",
      {
        event: "alert.test",
        rule: { id: "r", name: "R" },
        symbol: "BTCUSDT",
        timeframe: "1m",
        price: 100,
        time: 1000,
        message: "ok",
        source: "server",
      },
      mockFetcher,
    );
    expect(cancel).toHaveBeenCalledTimes(1);

    // Real TCP roundtrip through pinnedPost (no fetcher override)
    let seenBody = "";
    let seenSig = "";
    let statusToSend = 200;
    let holdOpenOn302 = false;
    const openResponses = new Set<import("node:http").ServerResponse>();
    const server = createServer((req, res) => {
      seenSig = String(req.headers["x-affentrader-signature"] ?? "");
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seenBody = Buffer.concat(chunks).toString("utf8");
        res.statusCode = statusToSend;
        if (statusToSend === 302) res.setHeader("location", "http://127.0.0.1:9/");
        if (statusToSend === 302 && holdOpenOn302) {
          openResponses.add(res);
          res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
          res.write("redirecting...");
          // Intentionally keep response body open to test fast 3xx abort in pinnedPost
          return;
        }
        res.end("ok");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    try {
      const addr = server.address() as { port: number };
      await deliverWebhook(`http://127.0.0.1:${addr.port}/hook`, "real-sec", {
        event: "alert.test",
        rule: { id: "r", name: "R" },
        symbol: "BTCUSDT",
        timeframe: "1m",
        price: 100,
        time: 1000,
        message: "pinned",
        source: "server",
      });
      expect(seenSig).toMatch(/^sha256=[a-f0-9]{64}$/);
      expect(JSON.parse(seenBody)).toMatchObject({ message: "pinned" });

      statusToSend = 302;
      holdOpenOn302 = true;
      const startedAt = Date.now();
      await expect(
        deliverWebhook(`http://127.0.0.1:${addr.port}/hook`, undefined, {
          event: "alert.test",
          rule: { id: "r", name: "R" },
          symbol: "BTCUSDT",
          timeframe: "1m",
          price: 100,
          time: 1000,
          message: "redir-open-body",
          source: "server",
        }),
      ).rejects.toSatisfy((err: unknown) => err instanceof WebhookError && /redirected/i.test(err.message));
      expect(Date.now() - startedAt).toBeLessThan(1000);
    } finally {
      for (const r of openResponses) r.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("pins resolved public DNS addresses and never performs a second DNS lookup (prevents rebinding)", async () => {
    vi.resetModules();
    const lookupMock = vi
      .fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);

    let capturedLookup: ((h: string, o: unknown, cb: (e: unknown, a: unknown, f?: number) => void) => void) | undefined;
    const fakeRequest = {
      on: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    };
    const requestMock = vi.fn((_url: unknown, opts: { lookup?: typeof capturedLookup }, onRes: (res: unknown) => void) => {
      capturedLookup = opts.lookup;
      queueMicrotask(() => {
        onRes({
          statusCode: 200,
          resume: vi.fn(),
          on: vi.fn((ev: string, fn: () => void) => {
            if (ev === "end") queueMicrotask(fn);
          }),
        });
      });
      return fakeRequest;
    });

    vi.doMock("node:dns/promises", () => ({ lookup: lookupMock }));
    vi.doMock("node:http", () => ({ default: { request: requestMock } }));

    try {
      const { deliverWebhook: isolatedDeliver } = await import("@/lib/server/webhooks");
      await isolatedDeliver("http://rebind.example.com/hook", undefined, {
        event: "alert.test",
        rule: { id: "r", name: "R" },
        symbol: "BTCUSDT",
        timeframe: "1m",
        price: 100,
        time: 1000,
        message: "pin-check",
        source: "server",
      });
      expect(lookupMock).toHaveBeenCalledTimes(1);
      expect(requestMock).toHaveBeenCalledTimes(1);
      expect(capturedLookup).toBeTypeOf("function");

      const allAddrs = await new Promise<unknown>((resolve, reject) => {
        capturedLookup!("rebind.example.com", { all: true }, (err, res) => (err ? reject(err) : resolve(res)));
      });
      expect(allAddrs).toEqual([{ address: "93.184.216.34", family: 4 }]);
      expect(lookupMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock("node:dns/promises");
      vi.doUnmock("node:http");
      vi.resetModules();
    }
  });
});

describe("osintTelemetry, feeds, sync, library, and API route validation", () => {
  it("strips non-http(s) and credentialed RSS links in parseMaritimeAdvisoriesRss and feeds.parseRss", () => {
    const xml = `<rss><channel>
      <item><title>Bad JS</title><link>javascript:alert(1)</link><guid>g1</guid><pubDate>Wed, 18 Nov 2026 10:00:00 GMT</pubDate></item>
      <item><title>Bad Auth</title><link>https://u:p@example.com/a</link><guid>g2</guid><pubDate>Wed, 18 Nov 2026 10:00:00 GMT</pubDate></item>
      <item><title>Bad User Auth</title><link>https://secretuser@example.com/b</link><guid>g2b</guid><pubDate>Wed, 18 Nov 2026 10:00:00 GMT</pubDate></item>
      <item><title>Good Link</title><link>https://example.com/advisory</link><guid>g3</guid><pubDate>Wed, 18 Nov 2026 10:00:00 GMT</pubDate></item>
    </channel></rss>`;
    const parsed = parseMaritimeAdvisoriesRss(xml, "Test");
    expect(parsed.map((item) => item.link)).toEqual(["", "", "", "https://example.com/advisory"]);

    const feedItems = parseRss(xml, "Test");
    expect(feedItems.map((item) => item.link)).toEqual(["https://example.com/advisory"]);
  });

  it("strips workspace data from concurrent 409 sync conflicts and validates PUT sync & direct pushSync baseRevision", async () => {
    const key = "1".repeat(32);
    const payload = JSON.stringify({ version: 1, chart: {}, watchlists: {}, alerts: {} });

    for (const invalidRev of [Number.NaN, -1, 1.5]) {
      await expect(pushSync(key, { data: payload, baseRevision: invalidRev, device: "dev-bad" })).rejects.toSatisfy(
        (err: unknown) => err instanceof SyncError && err.status === 400,
      );
    }

    await pushSync(key, { data: payload, baseRevision: 0, device: "dev-1" });

    await expect(pushSync(key, { data: payload, baseRevision: 0, device: "dev-2" })).rejects.toSatisfy(
      (err: unknown) => err instanceof SyncError && err.status === 409 && !("data" in (err.current ?? {})),
    );

    // Concurrent race at same baseRevision=1: one succeeds, the other hits store.update's 409 without .data
    const results = await Promise.allSettled([
      pushSync(key, { data: payload, baseRevision: 1, device: "dev-a" }),
      pushSync(key, { data: payload, baseRevision: 1, device: "dev-b" }),
    ]);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toBeDefined();
    expect(rejected!.reason).toBeInstanceOf(SyncError);
    expect((rejected!.reason as SyncError).status).toBe(409);
    expect((rejected!.reason as SyncError).current).toBeDefined();
    expect("data" in ((rejected!.reason as SyncError).current ?? {})).toBe(false);

    const badRev = await syncPut(
      new NextRequest("http://localhost/api/sync", {
        method: "PUT",
        headers: { "x-affentrader-sync": key, "content-type": "application/json" },
        body: JSON.stringify({ data: payload, baseRevision: "abc", device: "dev-2" }),
      }),
    );
    expect(badRev.status).toBe(400);

    const badDev = await syncPut(
      new NextRequest("http://localhost/api/sync", {
        method: "PUT",
        headers: { "x-affentrader-sync": key, "content-type": "application/json" },
        body: JSON.stringify({ data: payload, baseRevision: 1, device: { bad: true } }),
      }),
    );
    expect(badDev.status).toBe(400);
  });

  it("guards NaN limit, oversized ids, and Object.prototype property ids on /api/library", async () => {
    await publishScript({
      title: "Sample Script",
      description: "Test",
      author: "Tester",
      kind: "indicator",
      tags: ["test"],
      visibility: "public",
      source: "//@version=6\nindicator('Sample')\nplot(close)",
      notes: "",
    });

    const nanLimitRes = await libraryGet(new NextRequest("http://localhost/api/library?limit=abc"));
    expect(nanLimitRes.status).toBe(200);
    expect((await nanLimitRes.json()).scripts).toHaveLength(1);

    const longId = "a".repeat(129);
    const key = await accessKey();
    expect((await libraryGet(new NextRequest(`http://localhost/api/library?id=${longId}`))).status).toBe(400);
    expect(
      (
        await libraryPut(
          new NextRequest("http://localhost/api/library", {
            method: "PUT",
            headers: { "x-affentrader-key": key, "content-type": "application/json" },
            body: JSON.stringify({ id: longId, title: "X" }),
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await libraryDelete(
          new NextRequest(`http://localhost/api/library?id=${longId}`, {
            method: "DELETE",
            headers: { "x-affentrader-key": key },
          }),
        )
      ).status,
    ).toBe(400);

    for (const protoId of ["constructor", "toString", "__proto__"]) {
      const putProto = await libraryPut(
        new NextRequest("http://localhost/api/library", {
          method: "PUT",
          headers: { "x-affentrader-key": key, "content-type": "application/json" },
          body: JSON.stringify({ id: protoId, title: "Prototype Probe" }),
        }),
      );
      expect(putProto.status).toBe(404);

      const getOwnerProto = await libraryGet(
        new NextRequest(`http://localhost/api/library?id=${encodeURIComponent(protoId)}&owner=1`, {
          headers: { "x-affentrader-key": key },
        }),
      );
      expect(getOwnerProto.status).toBe(404);

      const delProto = await libraryDelete(
        new NextRequest(`http://localhost/api/library?id=${encodeURIComponent(protoId)}`, {
          method: "DELETE",
          headers: { "x-affentrader-key": key },
        }),
      );
      expect(delProto.status).toBe(200);
      expect(await delProto.json()).toEqual({ removed: false });
    }
  });

  it("validates query/body inputs and sanitizes 503 responses across API routes (including upstream errors containing validation keywords)", async () => {
    const key = await accessKey();
    const authHeaders = { "x-affentrader-key": key, "content-type": "application/json" };

    // Alerts & events & push validation
    expect((await alertsPut(new NextRequest("http://localhost/api/alerts", { method: "PUT", headers: authHeaders, body: JSON.stringify({ rule: "bad" }) }))).status).toBe(400);
    expect((await alertsDelete(new NextRequest(`http://localhost/api/alerts?id=${"x".repeat(129)}`, { method: "DELETE", headers: { "x-affentrader-key": key } }))).status).toBe(400);
    expect((await alertsPatch(new NextRequest("http://localhost/api/alerts", { method: "PATCH", headers: authHeaders, body: JSON.stringify({ id: "x".repeat(129), action: "pause" }) }))).status).toBe(400);
    expect((await alertsPost(new NextRequest("http://localhost/api/alerts", { method: "POST", headers: authHeaders, body: JSON.stringify({ action: "test", webhook: { url: "https://example.com", secret: 123 } }) }))).status).toBe(400);
    expect((await eventsGet(new NextRequest("http://localhost/api/alerts/events?after=abc", { headers: { "x-affentrader-key": key } }))).status).toBe(400);
    expect(
      (
        await eventsPost(
          new NextRequest("http://localhost/api/alerts/events", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
              event: { ruleId: "r1", name: "N", symbol: "BTCUSDT", timeframe: "1m", price: "NaN" },
              webhook: { url: "https://example.com/hook" },
            }),
          }),
        )
      ).status,
    ).toBe(400);
    expect((await pushDelete(new NextRequest("http://localhost/api/push?endpoint=http://insecure.test", { method: "DELETE", headers: { "x-affentrader-key": key } }))).status).toBe(400);
    expect((await pushPost(new NextRequest("http://localhost/api/push", { method: "POST", headers: authHeaders, body: "[]" }))).status).toBe(400);

    // Market proxy bounds & invalid exchangeInfo guard
    const { GET: marketGet } = await import("@/app/api/market/route");
    expect((await marketGet(new NextRequest("http://localhost/api/market?resource=klines&symbol=BTCUSDT&interval=1m&limit=abc"))).status).toBe(400);
    expect((await marketGet(new NextRequest("http://localhost/api/market?resource=klines&symbol=BTCUSDT&interval=1m&limit=1001"))).status).toBe(400);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    const badCatalog = await marketGet(new NextRequest("http://localhost/api/market?resource=exchangeInfo"));
    expect(badCatalog.status).toBe(503);

    // Upstream failure must never leak raw error message on screener, stock-heatmap, feeds, hyperliquid, yahoo
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("INTERNAL_UPSTREAM_HOST: secret-path"); }));

    expect((await screenerGet(new NextRequest("http://localhost/api/screener?market=invalid"))).status).toBe(400);
    expect((await screenerGet(new NextRequest("http://localhost/api/screener?limit=abc"))).status).toBe(400);
    expect((await screenerGet(new NextRequest("http://localhost/api/screener?minTurnover=-5"))).status).toBe(400);
    expect((await screenerGet(new NextRequest("http://localhost/api/screener?timeframe=100T"))).status).toBe(400);
    const screenerFail = await screenerGet(new NextRequest("http://localhost/api/screener?market=binance"));
    expect(screenerFail.status).toBe(503);
    expect(await screenerFail.json()).toEqual({ error: "Screener service is unavailable." });

    expect((await heatmapGet(new Request("http://localhost/api/stock-heatmap?market=mars"))).status).toBe(400);
    const heatmapFail = await heatmapGet(new Request("http://localhost/api/stock-heatmap?market=us"));
    expect(heatmapFail.status).toBe(503);
    expect(await heatmapFail.json()).toEqual({ error: "Sector heatmap unavailable." });

    expect((await feedsGet(new NextRequest("http://localhost/api/feeds?kind=news&scope=invalid"))).status).toBe(400);
    expect((await feedsGet(new NextRequest("http://localhost/api/feeds?kind=economic&week=invalid"))).status).toBe(400);
    expect((await feedsGet(new NextRequest("http://localhost/api/feeds?kind=earnings&date=bad"))).status).toBe(400);
    const feedsFail = await feedsGet(new NextRequest("http://localhost/api/feeds?kind=yields"));
    expect(feedsFail.status).toBe(503);
    expect(await feedsFail.json()).toEqual({ error: "Feed unavailable." });

    expect((await hyperliquidGet(new NextRequest("http://localhost/api/hyperliquid?kind=candles&coin=BTC&interval=1m&start=abc&end=1000"))).status).toBe(400);
    const hlFail = await hyperliquidGet(new NextRequest("http://localhost/api/hyperliquid?kind=assets"));
    expect(hlFail.status).toBe(503);
    expect(await hlFail.json()).toEqual({ error: "Hyperliquid is unavailable." });

    expect((await yahooGet(new NextRequest("http://localhost/api/yahoo?kind=chart&symbol=AAPL&interval=1d&period1=abc&period2=10"))).status).toBe(400);
    expect((await yahooGet(new NextRequest("http://localhost/api/yahoo?kind=chart&symbol=AAPL&interval=1d&period1=1&period2=2&extended=yes"))).status).toBe(400);
    expect((await yahooGet(new NextRequest("http://localhost/api/yahoo?kind=spark&symbols="))).status).toBe(400);
    const yahooFail = await yahooGet(new NextRequest("http://localhost/api/yahoo?kind=chart&symbol=AAPL&interval=1d&period1=1700000000&period2=1700100000"));
    expect(yahooFail.status).toBe(503);
    expect(await yahooFail.json()).toEqual({ error: "Yahoo Finance is unavailable." });

    // Upstream errors containing validation substrings ('interval', 'not found', 'Invalid', 'window') must still return sanitized 503
    for (const trickyMsg of [
      "Upstream interval not found: https://user:secret_pass@internal.host/window",
      "Invalid upstream socket at https://user:secret_pass@internal.host/window",
    ]) {
      clearScreenerCache();
      clearYahooCache();
      clearHyperliquidCache();
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(trickyMsg); }));

      const scrTricky = await screenerGet(new NextRequest("http://localhost/api/screener?market=binance"));
      expect(scrTricky.status).toBe(503);
      const scrBody = JSON.stringify(await scrTricky.json());
      expect(scrBody).not.toContain("secret_pass");
      expect(scrBody).not.toContain("internal.host");

      const yfTricky = await yahooGet(
        new NextRequest("http://localhost/api/yahoo?kind=chart&symbol=AAPL&interval=1d&period1=1700000000&period2=1700100000"),
      );
      expect(yfTricky.status).toBe(503);
      const yfBody = JSON.stringify(await yfTricky.json());
      expect(yfBody).not.toContain("secret_pass");
      expect(yfBody).not.toContain("internal.host");

      const hlTricky = await hyperliquidGet(
        new NextRequest("http://localhost/api/hyperliquid?kind=candles&coin=BTC&interval=1m&start=1700000000000&end=1700000600000"),
      );
      expect(hlTricky.status).toBe(503);
      const hlBody = JSON.stringify(await hlTricky.json());
      expect(hlBody).not.toContain("secret_pass");
      expect(hlBody).not.toContain("internal.host");
    }

    // stock-base & terminal-opportunities GET page and POST readJson limits
    expect((await stockBaseGet(new Request("http://localhost/api/stock-base?page=-1"))).status).toBe(400);
    expect((await stockBaseGet(new Request("http://localhost/api/stock-base?page=abc"))).status).toBe(400);
    expect((await stockBasePost(new Request("http://localhost/api/stock-base", { method: "POST", body: "x".repeat(3000) }))).status).toBe(413);
    expect((await stockBasePost(new Request("http://localhost/api/stock-base", { method: "POST", body: "[]" }))).status).toBe(400);

    expect((await oppsGet(new Request("http://localhost/api/terminal-opportunities?page=-1"))).status).toBe(400);
    expect((await oppsGet(new Request("http://localhost/api/terminal-opportunities?page=abc"))).status).toBe(400);
    expect((await oppsPost(new Request("http://localhost/api/terminal-opportunities", { method: "POST", body: "x".repeat(3000) }))).status).toBe(413);
    expect((await oppsPost(new Request("http://localhost/api/terminal-opportunities", { method: "POST", body: "[]" }))).status).toBe(400);

    expect((await fundamentalsGet(new Request("http://localhost/api/terminal-fundamentals?ticker=AAPL&market=mars"))).status).toBe(400);
  });

  it("sanitizes /api/osint-map 503 errors without leaking upstream details", async () => {
    vi.resetModules();
    vi.doMock("@/lib/server/osint", () => ({
      fetchOsintMapData: vi.fn(async () => {
        throw new Error("INTERNAL_AIS_TOKEN_FAILURE");
      }),
    }));
    vi.doMock("@/lib/server/osintTelemetry", () => ({
      fetchExtendedOsintTelemetry: vi.fn(async () => null),
    }));
    try {
      const { GET: osintGet } = await import("@/app/api/osint-map/route");
      const res = await osintGet();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "OSINT map feed unavailable." });
    } finally {
      vi.doUnmock("@/lib/server/osint");
      vi.doUnmock("@/lib/server/osintTelemetry");
      vi.resetModules();
    }
  });
});
