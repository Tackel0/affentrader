import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import type { AlertRule } from "@/types/alerts";
import type { OHLCV } from "@/types/trading";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "affentrader-"));
  process.env.AFFENTRADER_DATA = dir;
  delete process.env.AFFENTRADER_ALLOW_PRIVATE_WEBHOOKS;
  vi.resetModules();
});
afterEach(async () => {
  delete process.env.AFFENTRADER_DATA;
  await rm(dir, { recursive: true, force: true });
});

const rule = (patch: Partial<AlertRule> = {}): AlertRule => ({
  id: "rule-1",
  name: "BTC above 100",
  kind: "technical",
  status: "active",
  scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "15m" },
  condition: {
    op: "leaf",
    leaf: { type: "compare", left: { type: "quote", field: "price" }, comparator: ">", right: { type: "number", value: 100 } },
  },
  frequency: "tick",
  repeat: true,
  cooldownMs: 0,
  sound: false,
  browserNotification: false,
  serverSide: true,
  createdAt: 1,
  ...patch,
});
const quote = (price: number) => ({ price, previous: price, changePercent: 0, volume: 0, high: 0, low: 0 });
const marketAt = (price: number) => ({
  bars: async (): Promise<OHLCV[]> => [],
  quotes: async (symbols: string[]) => Object.fromEntries(symbols.map((s) => [s, quote(price)])),
});

describe("access key", () => {
  it("creates a key once and authorizes only matching requests", async () => {
    const { accessKey, isAuthorized } = await import("@/lib/server/security");
    const key = await accessKey();
    expect(key).toMatch(/^[a-f0-9]{48}$/);
    expect(await readFile(path.join(dir, "access-key.txt"), "utf8")).toContain(key);
    expect(await isAuthorized(new Request("http://x", { headers: { "x-affentrader-key": key } }))).toBe(true);
    const incorrectKey = key.slice(0, -1) + (key.endsWith("0") ? "1" : "0");
    expect(await isAuthorized(new Request("http://x", { headers: { "x-affentrader-key": incorrectKey } }))).toBe(false);
    expect(await isAuthorized(new Request("http://x"))).toBe(false);
  });
  it("rejects oversized and malformed bodies", async () => {
    const { readJson, HttpError } = await import("@/lib/server/security");
    await expect(readJson(new Request("http://x", { method: "POST", body: "{" }))).rejects.toBeInstanceOf(HttpError);
    await expect(readJson(new Request("http://x", { method: "POST", body: "x".repeat(50) }), 10)).rejects.toMatchObject({ status: 413 });
    expect(await readJson(new Request("http://x", { method: "POST", body: '{"a":1}' }))).toEqual({ a: 1 });
  });
});

describe("webhook safety", () => {
  it("flags private, loopback and metadata addresses", async () => {
    const { isPrivateAddress } = await import("@/lib/server/webhooks");
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1", "100.64.0.1"])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("rejects bad schemes, credentials and private targets", async () => {
    const { parseWebhookUrl, assertPublicDestination, WebhookError } = await import("@/lib/server/webhooks");
    expect(() => parseWebhookUrl("ftp://example.com")).toThrow(WebhookError);
    expect(() => parseWebhookUrl("https://user:pw@example.com")).toThrow(/credentials/);
    expect(() => parseWebhookUrl("nonsense")).toThrow();
    await expect(assertPublicDestination(new URL("http://169.254.169.254/latest"))).rejects.toThrow(/private/);
    await expect(assertPublicDestination(new URL("http://127.0.0.1:8080"))).rejects.toThrow(/private/);
    process.env.AFFENTRADER_ALLOW_PRIVATE_WEBHOOKS = "1";
    await expect(assertPublicDestination(new URL("http://127.0.0.1:8080"))).resolves.toBeUndefined();
  });
  it("signs the body and refuses redirects", async () => {
    process.env.AFFENTRADER_ALLOW_PRIVATE_WEBHOOKS = "1";
    const { deliverWebhook } = await import("@/lib/server/webhooks");
    const seen: { headers: Record<string, string>; body: string }[] = [];
    const ok = vi.fn(async (_url: unknown, init: RequestInit) => {
      seen.push({ headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response("ok", { status: 200 });
    });
    const payload = { event: "alert.triggered", rule: { id: "1", name: "n" }, symbol: "BTCUSDT", timeframe: "15m", price: 1, time: 2, message: "m", source: "server" as const };
    await deliverWebhook("http://127.0.0.1:9/hook", "secret", payload, ok as unknown as typeof fetch);
    const { headers, body } = seen[0];
    const expected = createHmac("sha256", "secret").update(`${headers["x-affentrader-timestamp"]}.${body}`).digest("hex");
    expect(headers["x-affentrader-signature"]).toBe(`sha256=${expected}`);
    const redirect = vi.fn(async () => new Response(null, { status: 302 }));
    await expect(deliverWebhook("http://127.0.0.1:9/x", undefined, payload, redirect as unknown as typeof fetch)).rejects.toThrow(/redirect/);
    const bad = vi.fn(async () => new Response("no", { status: 500 }));
    await expect(deliverWebhook("http://127.0.0.1:9/x", undefined, payload, bad as unknown as typeof fetch)).rejects.toThrow(/HTTP 500/);
  });
});

describe("server rules", () => {
  it("uses independent explicit-session history and rebaselines after unavailable source coverage", async () => {
    const service = await import("@/lib/server/alertService"), { tpoAlertSettings } = await import("@/lib/alerts/tpo"), { defaultTpo } = await import("@/lib/orderflow/tpoSettings");
    const day = Date.UTC(2026, 10, 4), minute = 60000, symbol = "YF:AAPL";
    const candle = (time: number, close: number): OHLCV => ({ time, open: close, high: close, low: close, close, volume: 1 });
    const settings = tpoAlertSettings({ ...defaultTpo(), tradingHours: "Custom", customStart: 900, customEnd: 1000, rowSize: 1 });
    await service.upsertRule(rule({ createdAt: day, scope: { type: "symbol", symbol, timeframe: "15m" }, condition: { op: "leaf", leaf: { type: "tpo", level: "poc", direction: "crossing_up", settings } } }));
    let price = 100, at = day + 900 * minute, available = true;
    const tpoHistory = vi.fn(async () => { if (!available) throw new Error("offline"); return { bars: Array.from({ length: 4 }, (_, i) => candle(day + (540 + i * 15) * minute, 100)), basis: "Independent fixture" }; });
    const source = { bars: async () => [candle(day + 870 * minute, 50), candle(day + 885 * minute, 50)],
      quotes: async () => ({ [symbol]: { ...quote(price), time: at } }), tpoHistory };
    expect((await service.evaluateRules(source, at)).fired).toBe(0);
    price = 101; at++; expect((await service.evaluateRules(source, at)).fired).toBe(1);
    expect((await service.listEvents()).events[0].message).toContain("100.5");
    available = false; at++; expect((await service.evaluateRules(source, at)).fired).toBe(0);
    available = true; price = 100; at++; expect((await service.evaluateRules(source, at)).fired).toBe(0);
    price = 101; at++; expect((await service.evaluateRules(source, at)).fired).toBe(1);
    expect(tpoHistory).toHaveBeenCalledWith(expect.objectContaining({ tape: "extended" }), at);
  });
  it("persists following TPO observations across restart and changes profile without a synthetic crossing", async () => {
    let service = await import("@/lib/server/alertService");
    const { tpoAlertSettings } = await import("@/lib/alerts/tpo");
    const minute = 60000, day = 86400000, start = Date.UTC(2026, 9, 27);
    const candles = (at: number, low: number) => Array.from({ length: 12 }, (_, index) => ({ time: at + index * 5 * minute, open: low, high: low + .1, low, close: low + .1, volume: 1 }));
    const history = [...candles(start, .2), ...candles(start + day, .6)];
    await service.upsertRule(rule({ scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "5m" }, trigger: "every_time", condition: {
      op: "leaf", leaf: { type: "tpo", level: "poc", direction: "crossing", settings: { ...tpoAlertSettings(), rowSize: .1, sessionMinutes: 60 } } }, createdAt: start }));
    const market = (price: number, time: number) => ({ bars: async () => history, quotes: async () => ({ BTCUSDT: { ...quote(price), time } }) });
    const at = start + day + 10 * minute;
    expect((await service.evaluateRules(market(.2, at), at)).fired).toBe(0);
    vi.resetModules(); service = await import("@/lib/server/alertService");
    expect((await service.evaluateRules(market(.25, at + 1), at + 1)).fired).toBe(1);
    expect((await service.listEvents()).events[0].message).toContain("POC 0.25");
    const before = start + day + 55 * minute;
    expect((await service.evaluateRules(market(.5, before), before)).fired).toBe(0);
    const boundary = start + day + 60 * minute;
    expect((await service.evaluateRules(market(.5, boundary), boundary)).fired).toBe(0);
    expect((await service.evaluateRules(market(.65, boundary + 1), boundary + 1)).fired).toBe(1);
    expect((await service.listEvents()).events.at(-1)!.message).toContain("POC 0.65");
  });
  it("stops after exactly 15 committed triggers and preserves the stop across concurrent passes and restart", async () => {
    let service = await import("@/lib/server/alertService");
    await service.upsertRule(rule({ trigger: "every_time" }));
    const source = marketAt(110);
    await service.evaluateRules(source, 1000);
    for (let i = 1; i <= 15; i++) expect((await service.evaluateRules(source, 1000 + i)).fired).toBe(1);
    expect((await service.store.read()).rules[0]).toMatchObject({ status: "stopped", stop: { reason: "trigger_rate" } });
    vi.resetModules(); service = await import("@/lib/server/alertService");
    const attempts = await Promise.all([service.evaluateRules(source, 2000), service.evaluateRules(source, 2000)]);
    expect(attempts.map(result => result.fired)).toEqual([0, 0]);
    expect((await service.listEvents()).events).toHaveLength(15);
    await service.controlRule("rule-1", "restart", 3000);
    expect((await service.evaluateRules(source, 3001)).fired).toBe(0);
    expect((await service.evaluateRules(source, 3002)).fired).toBe(1);
    expect((await service.store.read()).rules[0].rate!.recent).toHaveLength(1);
  });
  it("stops watchlist members independently and restarts only their state", async () => {
    const service = await import("@/lib/server/alertService");
    await service.upsertRule(rule({ kind: "watchlist", trigger: "every_time", expiresAt: 1_000_000,
      scope: { type: "watchlist", listId: "w", symbols: ["BTCUSDT", "ETHUSDT"], timeframe: "1m" } }));
    let eth = 90;
    const source = { bars: async () => [], quotes: async () => ({ BTCUSDT: quote(110), ETHUSDT: quote(eth) }) };
    await service.evaluateRules(source, 1000);
    for (let i = 1; i <= 15; i++) await service.evaluateRules(source, 1000 + i);
    const stopped = (await service.store.read()).rules[0];
    expect(stopped.status).toBe("active"); expect(stopped.rate!.stoppedSymbols).toHaveProperty("BTCUSDT");
    eth = 110; expect((await service.evaluateRules(source, 2000)).fired).toBe(1);
    const otherEdge = (await service.store.read()).edges["rule-1:ETHUSDT"];
    await service.controlRule("rule-1", "restart_symbols", 2001);
    const restarted = await service.store.read();
    expect(restarted.edges["rule-1:ETHUSDT"]).toEqual(otherEdge);
    expect(restarted.edges["rule-1:BTCUSDT"]).toBeUndefined();
    expect(restarted.rules[0].rate?.recent).toHaveLength(1);
    expect(restarted.rules[0].lastFired?.ETHUSDT.time).toBe(2000);
    expect((await service.evaluateRules(source, 2002)).fired).toBe(1);
  });
  it("commits at most 1000 watchlist triggers even when the same pass has more matching members", async () => {
    const service = await import("@/lib/server/alertService");
    const symbols = Array.from({ length: 67 }, (_, i) => `S${i}USDT`);
    await service.upsertRule(rule({ kind: "watchlist", trigger: "every_time", expiresAt: 1_000_000,
      scope: { type: "watchlist", listId: "w", symbols, timeframe: "1m" } }));
    const source = { bars: async () => [], quotes: async () => Object.fromEntries(symbols.map(symbol => [symbol, quote(110)])) };
    await service.evaluateRules(source, 1000);
    let total = 0;
    for (let i = 1; i <= 15; i++) total += (await service.evaluateRules(source, 1000 + i)).fired;
    expect(total).toBe(1000);
    const db = await service.store.read();
    expect(db.events).toHaveLength(1000); expect(db.rules[0].rate!.recent).toHaveLength(1000);
    expect(db.rules[0]).toMatchObject({ status: "stopped", stop: { reason: "watchlist_rate" } });
    expect((await service.evaluateRules(source, 5000)).fired).toBe(0);
  });
  it("retains counters on pause/resume and cancels a pre-resume in-flight plan", async () => {
    const service = await import("@/lib/server/alertService");
    await service.upsertRule(rule({ trigger: "every_time" }));
    const source = marketAt(110);
    await service.evaluateRules(source, 1000); await service.evaluateRules(source, 1001);
    let arrived!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { arrived = resolve; });
    const deferred = new Promise<void>(resolve => { release = resolve; });
    const pending = service.evaluateRules({ bars: async () => [], quotes: async symbols => { arrived(); await deferred; return Object.fromEntries(symbols.map(symbol => [symbol, quote(110)])); } }, 1002);
    await started;
    await service.controlRule("rule-1", "pause", 1003); await service.controlRule("rule-1", "resume", 1004);
    release(); expect((await pending).fired).toBe(0);
    expect((await service.store.read()).rules[0].rate!.recent).toHaveLength(1);
    expect((await service.evaluateRules(source, 1005)).fired).toBe(0);
    expect((await service.evaluateRules(source, 1006)).fired).toBe(1);
  });
  it("authenticates narrow control updates and preserves hidden webhook secrets", async () => {
    const service = await import("@/lib/server/alertService");
    process.env.AFFENTRADER_ALLOW_PRIVATE_WEBHOOKS = "1";
    await service.upsertRule(rule({ webhook: { url: "http://127.0.0.1:9/hook", secret: "private-test-secret" }, rate: { recent: [{ symbol: "BTCUSDT", time: 1000 }], stoppedSymbols: {} } }));
    const { PATCH } = await import("@/app/api/alerts/route");
    const { NextRequest } = await import("next/server");
    const { accessKey } = await import("@/lib/server/security");
    const key = await accessKey();
    const request = (body: unknown, authorized = true) => new NextRequest("http://localhost/api/alerts", { method: "PATCH", headers: { "content-type": "application/json", ...(authorized ? { "x-affentrader-key": key } : {}) }, body: JSON.stringify(body) });
    expect((await PATCH(request({ id: "rule-1", action: "pause" }, false))).status).toBe(401);
    const paused = await PATCH(request({ id: "rule-1", action: "pause" }));
    expect(paused.status).toBe(200); expect(JSON.stringify(await paused.json())).not.toContain("private-test-secret");
    expect((await service.store.read()).rules[0].webhook?.secret).toBe("private-test-secret");
    expect((await PATCH(request({ id: "rule-1", action: "resume", symbols: [] }))).status).toBe(400);
    expect((await PATCH(request({ id: "rule-1", action: "resume" }))).status).toBe(200);
    expect((await service.store.read()).rules[0].rate!.recent).toHaveLength(1);
  });
  it("requires a future expiration before restarting a stopped rule and validates durable rate state", async () => {
    const service = await import("@/lib/server/alertService");
    await service.upsertRule(rule({ expiresAt: 2000, status: "stopped", stop: { reason: "trigger_rate", time: 1000 } }));
    await expect(service.controlRule("rule-1", "restart", 2000)).rejects.toThrow(/expiration/);
    expect(() => service.validateRule(rule({ rate: { recent: [], stoppedSymbols: { "bad symbol": 1 } } }))).toThrow(/stopped/);
    await expect(service.controlRule("missing", "restart", 1000)).rejects.toThrow(/not found/);
  });
  it("persists movement rules and their exact candle gates across server restarts", async () => {
    let service = await import("@/lib/server/alertService");
    const condition: AlertRule["condition"] = { op: "leaf", leaf: { type: "movement", operand: { type: "price", field: "close" }, direction: "down", unit: "absolute", amount: 5, bars: 2 } };
    await service.upsertRule(rule({ condition, trigger: "once_per_bar", scope: { type: "symbol", symbol: "HL:xyz:BRENTOIL", timeframe: "1m" } }));
    let price = 99;
    const series = () => [100, 100, price].map((close, i) => ({ time: i * 60_000, open: close, high: close, low: close, close, volume: 1 }));
    const source = { quotes: async () => ({ "HL:xyz:BRENTOIL": quote(price) }), bars: vi.fn(async () => series()) };
    expect((await service.evaluateRules(source, 120_001)).fired).toBe(0);
    price = 95;
    expect((await service.evaluateRules(source, 120_002)).fired).toBe(1);
    expect(source.bars).toHaveBeenLastCalledWith("HL:xyz:BRENTOIL", "1m", 300);
    vi.resetModules(); service = await import("@/lib/server/alertService");
    expect((await service.store.read()).rules[0].condition).toEqual(condition);
    expect((await service.evaluateRules(source, 120_003)).fired).toBe(0);
    expect((await service.listEvents()).events).toHaveLength(1);
    expect((await service.listEvents()).events[0]).toMatchObject({ price: 95, barTime: 120_000, symbol: "HL:xyz:BRENTOIL" });
  });
  it("requests a deep movement lookback once per series instead of truncating to 300 candles", async () => {
    const service = await import("@/lib/server/alertService");
    const condition: AlertRule["condition"] = { op: "leaf", leaf: { type: "movement", operand: { type: "price", field: "close" }, direction: "up", unit: "percent", amount: 5, bars: 1200 } };
    await service.upsertRule(rule({ condition, scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "1m" } }));
    let price = 101;
    const source = { quotes: async () => ({ BTCUSDT: quote(price) }), bars: vi.fn(async (_symbol: string, _timeframe: string, count = 0): Promise<OHLCV[]> => Array.from({ length: count }, (_, i) => {
      const close = i === count - 1 ? price : 100;
      return { time: i * 60_000, open: close, high: close, low: close, close, volume: 1 };
    })) };
    expect((await service.evaluateRules(source, 1202 * 60_000)).fired).toBe(0);
    price = 105;
    expect((await service.evaluateRules(source, 1202 * 60_000 + 1)).fired).toBe(1);
    expect(source.bars).toHaveBeenLastCalledWith("BTCUSDT", "1m", 1202);
    expect((await service.listEvents()).events[0].message).toContain("5.00%");
  });
  it.each(["once_per_minute", "once_per_bar"] as const)("keeps %s firing gates through restart", async trigger => {
    let service = await import("@/lib/server/alertService");
    let at = 1000;
    const source = { quotes: async () => ({ BTCUSDT: quote(110) }), bars: async () => [{ time: at < 900000 ? 0 : 900000, open: 110, high: 110, low: 110, close: 110, volume: 1 }] };
    await service.upsertRule(rule({ trigger }));
    expect((await service.evaluateRules(source, at)).fired).toBe(0);
    expect((await service.evaluateRules(source, ++at)).fired).toBe(1);
    vi.resetModules(); service = await import("@/lib/server/alertService");
    expect((await service.evaluateRules(source, ++at)).fired).toBe(0);
    at = trigger === "once_per_minute" ? 61_001 : 900001;
    expect((await service.evaluateRules(source, at)).fired).toBe(1);
    expect((await service.store.read()).rules[0].lastFired!.BTCUSDT.time).toBe(at);
  });
  it("expires paused and active rules without requesting market data", async () => {
    const service = await import("@/lib/server/alertService");
    await service.upsertRule(rule({ expiresAt: 2000 }));
    await service.upsertRule(rule({ id: "paused", status: "paused", expiresAt: 2000 }));
    const source = { quotes: vi.fn(async () => ({})), bars: vi.fn(async () => []) };
    expect((await service.evaluateRules(source, 2000)).fired).toBe(0);
    expect(source.quotes).not.toHaveBeenCalled();
    expect((await service.store.read()).rules.map(rule => rule.status)).toEqual(["expired", "expired"]);
  });
  it("cannot commit a firing after its expiration passes during a slow request", async () => {
    const service = await import("@/lib/server/alertService");
    await service.upsertRule(rule({ expiresAt: 2020 }));
    await service.evaluateRules(marketAt(90), 1000);
    const source = { quotes: async () => { await new Promise(resolve => setTimeout(resolve, 40)); return { BTCUSDT: quote(110) }; }, bars: async () => [] };
    expect((await service.evaluateRules(source, 2000)).fired).toBe(0);
    const db = await service.store.read(); expect(db.rules[0].status).toBe("expired"); expect(db.events).toEqual([]);
  });
  it("tracks once per watchlist member and preserves remaining observations during dynamic updates", async () => {
    let service = await import("@/lib/server/alertService");
    await service.upsertRule(rule({ trigger: "once", repeat: false, kind: "watchlist", expiresAt: 1_900_000_000_000, scope: { type: "watchlist", listId: "w", symbols: ["BTCUSDT", "ETHUSDT"], timeframe: "15m" } }));
    await service.evaluateRules(marketAt(50), 1000);
    const market = (prices: Record<string, number>) => ({ quotes: async (symbols: string[]) => Object.fromEntries(symbols.map(symbol => [symbol, quote(prices[symbol] ?? 50)])), bars: async () => [] });
    expect((await service.evaluateRules(market({ BTCUSDT: 110 }), 2000)).fired).toBe(1);
    expect((await service.store.read()).rules[0]).toMatchObject({ status: "active", triggeredSymbols: ["BTCUSDT"] });
    vi.resetModules(); service = await import("@/lib/server/alertService");
    const saved = await service.updateWatchlistMembers("rule-1", ["BTCUSDT", "ETHUSDT", "SOLUSDT"], 3000);
    expect(saved.triggeredSymbols).toEqual(["BTCUSDT"]);
    expect((await service.store.read()).edges["rule-1:ETHUSDT"].initialized).toBe(true);
    await service.evaluateRules(market({ BTCUSDT: 110 }), 3000);
    expect((await service.evaluateRules(market({ BTCUSDT: 110, ETHUSDT: 110 }), 4000)).fired).toBe(1);
    expect((await service.store.read()).rules[0].status).toBe("active");
    await service.updateWatchlistMembers("rule-1", ["BTCUSDT", "SOLUSDT"], 5000);
    expect((await service.evaluateRules(market({ BTCUSDT: 110, ETHUSDT: 110, SOLUSDT: 110 }), 6000)).fired).toBe(1);
    const done = await service.store.read();
    expect(done.rules[0].status).toBe("triggered"); expect(done.rules[0].lastFired!.ETHUSDT).toBeUndefined();
    expect(done.edges["rule-1:ETHUSDT"]).toBeUndefined();
    expect((await service.updateWatchlistMembers("rule-1", ["BTCUSDT", "SOLUSDT", "XRPUSDT"], 7000)).status).toBe("active");
  });
  it("authenticates membership patches without exposing webhook credentials", async () => {
    const service = await import("@/lib/server/alertService");
    const route = await import("@/app/api/alerts/route");
    const { NextRequest } = await import("next/server");
    const { accessKey } = await import("@/lib/server/security");
    await service.upsertRule(rule({ kind: "watchlist", scope: { type: "watchlist", listId: "w", symbols: ["BTCUSDT"], timeframe: "1m" }, webhook: { url: "https://example.com/webhook", secret: "hidden" } }));
    const body = JSON.stringify({ id: "rule-1", symbols: ["BTCUSDT", "ETHUSDT"] });
    expect((await route.PATCH(new NextRequest("http://localhost/api/alerts", { method: "PATCH", body }))).status).toBe(401);
    const response = await route.PATCH(new NextRequest("http://localhost/api/alerts", { method: "PATCH", body, headers: { "x-affentrader-key": await accessKey() } }));
    expect(response.status).toBe(200);
    const payload = await response.json(); expect(payload.rule.scope.symbols).toEqual(["BTCUSDT", "ETHUSDT"]); expect(payload.rule.webhook.secret).toBe("••••••••");
  });
  it("persists actual crossing samples across a runner restart", async () => {
    let service = await import("@/lib/server/alertService");
    const crossing = rule({ condition: { op: "leaf", leaf: { type: "compare", left: { type: "quote", field: "price" }, comparator: "crossing_up", right: { type: "number", value: 100 } } } });
    await service.upsertRule(crossing);
    expect((await service.evaluateRules(marketAt(99), 1000)).fired).toBe(0);
    expect((await service.evaluateRules(marketAt(100), 2000)).fired).toBe(1);
    expect((await service.evaluateRules(marketAt(101), 3000)).fired).toBe(0);
    vi.resetModules(); service = await import("@/lib/server/alertService");
    expect((await service.evaluateRules(marketAt(102), 4000)).fired).toBe(0);
    expect((await service.evaluateRules(marketAt(90), 5000)).fired).toBe(0);
    expect((await service.evaluateRules(marketAt(100), 6000)).fired).toBe(1);
    const db = await service.store.read();
    expect(db.events).toHaveLength(2);
    expect(db.edges["rule-1:BTCUSDT"].quotes!["BTCUSDT|15m"].fields.price).toBe(100);
    const saved = JSON.parse(await readFile(path.join(dir, "alerts.json"), "utf8"));
    expect(saved.events.at(-1).time).toBe(saved.edges["rule-1:BTCUSDT"].firedAt);
  });
  it("fires consecutive opposite crossings instead of suppressing the second event", async () => {
    const service = await import("@/lib/server/alertService");
    await service.upsertRule(rule({ condition: { op: "leaf", leaf: { type: "compare", left: { type: "quote", field: "price" }, comparator: "crossing", right: { type: "number", value: 100 } } } }));
    await service.evaluateRules(marketAt(99), 1000);
    expect((await service.evaluateRules(marketAt(101), 2000)).fired).toBe(1);
    expect((await service.evaluateRules(marketAt(99), 3000)).fired).toBe(1);
    expect((await service.evaluateRules(marketAt(99), 4000)).fired).toBe(0);
  });
  it("serializes concurrent evaluation and commits an event together with its observation state", async () => {
    const service = await import("@/lib/server/alertService");
    await service.upsertRule(rule()); await service.evaluateRules(marketAt(90), 1000);
    const results = await Promise.all([service.evaluateRules(marketAt(110), 2000), service.evaluateRules(marketAt(110), 2000)]);
    expect(results.map(result => result.fired).sort()).toEqual([0, 1]);
    const db = await service.store.read(); expect(db.events).toHaveLength(1);
    expect(db.edges["rule-1:BTCUSDT"]).toMatchObject({ initialized: true, met: true, firedAt: 2000 });
  });
  it("does not commit an alert edited or paused while a market request was pending", async () => {
    const service = await import("@/lib/server/alertService");
    await service.upsertRule(rule()); await service.evaluateRules(marketAt(90), 1000);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const run = service.evaluateRules({ bars: async () => [], quotes: async () => { enter(); await pending; return { BTCUSDT: quote(110) }; } }, 2000);
    await entered;
    await service.upsertRule(rule({ status: "paused" }));
    release(); expect((await run).fired).toBe(0);
    const db = await service.store.read(); expect(db.events).toEqual([]); expect(db.edges).toEqual({});
  });
  it("uses confirmed prices for close rules and gates each closed candle durably", async () => {
    let service = await import("@/lib/server/alertService");
    const minute = 60_000, start = 1_800_000_000_000;
    const rows: OHLCV[] = [90, 110].map((close, i) => ({ time: start + (i - 1) * minute, open: close, high: close, low: close, close, volume: 1 }));
    const source = { bars: vi.fn(async () => rows), quotes: async () => ({ BTCUSDT: quote(999) }) };
    await service.upsertRule(rule({ scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "1m" }, frequency: "close", condition: { op: "leaf", leaf: { type: "compare", left: { type: "quote", field: "price" }, comparator: "crossing_up", right: { type: "number", value: 100 } } } }));
    expect((await service.evaluateRules(source, start + 1000)).fired).toBe(0);
    expect((await service.evaluateRules(source, start + 30_000)).fired).toBe(0);
    expect((await service.evaluateRules(source, start + minute)).fired).toBe(1);
    expect((await service.listEvents()).events[0].price).toBe(110);
    expect(source.bars).toHaveBeenCalled();
    vi.resetModules(); service = await import("@/lib/server/alertService");
    expect((await service.evaluateRules(source, start + minute + 15_000)).fired).toBe(0);
  });
  it("keeps established edges through quote outages and baselines data arriving for a new rule", async () => {
    const service = await import("@/lib/server/alertService");
    const missing = { bars: async () => [], quotes: async () => ({}) };
    await service.upsertRule(rule());
    await service.evaluateRules(missing, 1000);
    expect((await service.evaluateRules(marketAt(110), 2000)).fired).toBe(0);
    await service.evaluateRules(missing, 3000);
    expect((await service.evaluateRules(marketAt(120), 4000)).fired).toBe(0);
    await service.evaluateRules(marketAt(90), 5000);
    expect((await service.evaluateRules(marketAt(110), 6000)).fired).toBe(1);
  });
  it("validates rules and rejects tick intervals, bad symbols and unsafe webhooks", async () => {
    const { validateRule } = await import("@/lib/server/alertService");
    expect(validateRule(rule()).serverSide).toBe(true);
    expect(() => validateRule(rule({ name: "" }))).toThrow(/name/);
    expect(() => validateRule(rule({ scope: { type: "symbol", symbol: "bad symbol", timeframe: "15m" } }))).toThrow(/symbol/i);
    expect(() => validateRule(rule({ scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "100T" } }))).toThrow(/time-based/);
    expect(() => validateRule(rule({ webhook: { url: "file:///etc/passwd" } }))).toThrow();
    expect(() => validateRule(rule({ condition: { op: "all", conditions: [] } }))).toThrow(/at least one/);
  });
  it("persists rules across store instances and hides webhook secrets", async () => {
    const service = await import("@/lib/server/alertService");
    await service.upsertRule(rule({ webhook: { url: "https://example.com/h", secret: "s3cret" } }));
    vi.resetModules();
    const again = await import("@/lib/server/alertService");
    const db = await again.store.read();
    expect(db.rules).toHaveLength(1);
    expect(again.publicRule(db.rules[0]).webhook?.secret).toBe("••••••••");
    expect(await again.deleteRule("rule-1")).toBe(true);
    expect((await again.store.read()).rules).toHaveLength(0);
  });
  it("recovers from a corrupt primary file using the backup", async () => {
    const service = await import("@/lib/server/alertService");
    await service.upsertRule(rule());
    await service.upsertRule(rule({ id: "rule-2", name: "second" }));
    await writeFile(path.join(dir, "alerts.json"), "{ not json");
    vi.resetModules();
    const recovered = await import("@/lib/server/alertService");
    const db = await recovered.store.read();
    expect(db.rules.length).toBeGreaterThanOrEqual(1);
  });
  it("fires once per crossing, survives a restart, then fires again after a reset", async () => {
    const service = await import("@/lib/server/alertService");
    await service.upsertRule(rule());
    expect((await service.evaluateRules(marketAt(90), 1000)).fired).toBe(0);
    expect((await service.evaluateRules(marketAt(120), 2000)).fired).toBe(1);
    vi.resetModules();
    const restarted = await import("@/lib/server/alertService");
    expect((await restarted.evaluateRules(marketAt(130), 3000)).fired).toBe(0);
    expect((await restarted.evaluateRules(marketAt(90), 4000)).fired).toBe(0);
    expect((await restarted.evaluateRules(marketAt(140), 5000)).fired).toBe(1);
    const { events } = await restarted.listEvents();
    expect(events).toHaveLength(2);
    expect(events[0].source).toBe("server");
  });
  it("completes a one-shot watchlist rule only after every symbol has matched", async () => {
    const service = await import("@/lib/server/alertService");
    await service.upsertRule(
      rule({ id: "w", repeat: false, kind: "watchlist", scope: { type: "watchlist", listId: "l", symbols: ["BTCUSDT", "ETHUSDT"], timeframe: "15m" } }),
    );
    await service.evaluateRules(marketAt(50), 500);
    const result = await service.evaluateRules(marketAt(500), 1000);
    expect(result.fired).toBe(2);
    expect((await service.store.read()).rules[0].status).toBe("triggered");
    expect((await service.evaluateRules(marketAt(900), 2000)).fired).toBe(0);
  });
  it("delivers webhooks, retries failures with backoff and gives up eventually", async () => {
    process.env.AFFENTRADER_ALLOW_PRIVATE_WEBHOOKS = "1";
    const service = await import("@/lib/server/alertService");
    const webhooks = await import("@/lib/server/webhooks");
    await service.upsertRule(rule({ webhook: { url: "http://127.0.0.1:9/hook" } }));
    await service.evaluateRules(marketAt(90), 500);
    await service.evaluateRules(marketAt(120), 1000);
    const failing = vi.fn(async () => new Response("no", { status: 503 }));
    await service.processDeliveries(1000, failing as unknown as typeof fetch);
    let event = (await service.listEvents()).events[0];
    expect(event.delivery).toMatchObject({ status: "pending", attempts: 1 });
    expect(event.delivery?.nextAttemptAt).toBe(1000 + webhooks.RETRY_DELAYS[0]);
    await service.processDeliveries(1000 + 1, failing as unknown as typeof fetch);
    expect(failing).toHaveBeenCalledTimes(1);
    const working = vi.fn(async () => new Response("ok", { status: 200 }));
    expect(await service.processDeliveries(1000 + webhooks.RETRY_DELAYS[0], working as unknown as typeof fetch)).toBe(1);
    event = (await service.listEvents()).events[0];
    expect(event.delivery).toMatchObject({ status: "delivered", attempts: 2 });
    let at = 10_000_000;
    await service.upsertRule(rule({ id: "r2", webhook: { url: "http://127.0.0.1:9/x" } }));
    await service.evaluateRules(marketAt(90), at - 1);
    await service.evaluateRules(marketAt(120), at);
    for (let i = 0; i < webhooks.MAX_ATTEMPTS; i++) {
      at += 4_000_000;
      await service.processDeliveries(at, failing as unknown as typeof fetch);
    }
    const last = (await service.listEvents()).events.at(-1)!;
    expect(last.delivery?.status).toBe("failed");
    expect(last.delivery?.attempts).toBe(webhooks.MAX_ATTEMPTS);
  });
  it("never exposes queued webhook credentials in the event feed", async () => {
    const service = await import("@/lib/server/alertService");
    await service.recordEvent(
      { ruleId: "x", name: "n", symbol: "BTCUSDT", timeframe: "15m", price: 1, time: 1, message: "m", source: "browser" },
      { url: "https://example.com/h", secret: "topsecret" },
    );
    expect(JSON.stringify((await service.listEvents()).events)).not.toContain("topsecret");
  });
});

describe("server rules on other markets", () => {
  it("upgrades the exchange history cache for a larger depth and reuses it for smaller requests", async () => {
    const { exchangeSource } = await import("@/lib/server/alertService");
    const requests: URL[] = [];
    const fetcher = vi.fn(async (input: unknown) => {
      const url = new URL(String(input)); requests.push(url);
      const end = Number(url.searchParams.get("endTime"));
      const count = Number(url.searchParams.get("limit"));
      const last = Math.floor(end / 60_000) * 60_000;
      return new Response(JSON.stringify(Array.from({ length: count }, (_, i) => [last - (count - 1 - i) * 60_000, "100", "101", "99", "100.5", "2"])), { status: 200 });
    }) as unknown as typeof fetch;
    const source = exchangeSource(fetcher);
    expect(await source.bars("BTCUSDT", "1m", 300)).toHaveLength(300);
    expect(await source.bars("BTCUSDT", "1m", 1202)).toHaveLength(1202);
    const calls = requests.length;
    expect(await source.bars("BTCUSDT", "1m", 500)).toHaveLength(500);
    expect(requests).toHaveLength(calls);
    expect(calls).toBe(3);
    expect(requests.every(url => url.pathname === "/api/v3/klines")).toBe(true);
  });
  it("accepts Hyperliquid and Yahoo symbols", async () => {
    const { validateRule } = await import("@/lib/server/alertService");
    const on = (symbol: string) => rule({ scope: { type: "symbol", symbol, timeframe: "15m" } });
    expect(validateRule(on("HL:BTC")).scope).toMatchObject({ symbol: "HL:BTC" });
    expect(validateRule(on("HL:xyz:TSLA")).scope).toMatchObject({ symbol: "HL:xyz:TSLA" });
    expect(validateRule(on("YF:SIE.DE")).scope).toMatchObject({ symbol: "YF:SIE.DE" });
    expect(() => validateRule(on("HL:bad coin"))).toThrow(/symbol/i);
  });
  it("reads Hyperliquid candles and quotes without calling its own API", async () => {
    const service = await import("@/lib/server/alertService");
    const minute = 60_000;
    const base = Math.floor(Date.now() / minute) * minute;
    const requests: Record<string, unknown>[] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      if (body.type === "candleSnapshot") {
        const req = body.req as { startTime: number; endTime: number };
        const rows = Array.from({ length: 400 }, (_, i) => base - (399 - i) * minute)
          .filter((t) => t >= req.startTime && t <= req.endTime)
          .map((t) => ({ t, o: "100", h: "101", l: "99", c: "100.5", v: "2" }));
        return new Response(JSON.stringify(rows), { status: 200 });
      }
      if (body.type === "perpDexs") return new Response(JSON.stringify([null]), { status: 200 });
      return new Response(
        JSON.stringify([{ universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }] }, [{ markPx: "110", prevDayPx: "100", dayNtlVlm: "1000", dayBaseVlm: "12" }]]),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const source = service.exchangeSource(fetcher);
    const bars = await source.bars("HL:BTC", "1m");
    expect(bars.length).toBe(300);
    expect(bars.at(-1)!.close).toBe(100.5);
    const quotes = await source.quotes(["HL:BTC", "HL:ETH"]);
    expect(quotes["HL:BTC"]).toMatchObject({ price: 110, changePercent: 10, volume: 12, metrics: { volume: { base: 12, quote: 1000 }, range: { high: null, low: null } } });
    expect(quotes["HL:ETH"]).toBeUndefined();
    const ranged = await source.quotes(["HL:BTC"], ["HL:BTC"]);
    expect(ranged["HL:BTC"].metrics!.range).toMatchObject({ complete: false, high: null, low: null, bars: 399 });
    expect(requests.every((r) => typeof r.type === "string")).toBe(true);
  });
  it("evaluates a Hyperliquid rule end to end", async () => {
    const service = await import("@/lib/server/alertService");
    await service.upsertRule(rule({ scope: { type: "symbol", symbol: "HL:BTC", timeframe: "15m" } }));
    const market = (price: number) => ({
      bars: async () => [],
      quotes: async (symbols: string[]) => Object.fromEntries(symbols.map((s) => [s, quote(price)])),
    });
    expect((await service.evaluateRules(market(90), 1000)).fired).toBe(0);
    expect((await service.evaluateRules(market(150), 2000)).fired).toBe(1);
    expect((await service.listEvents()).events[0].symbol).toBe("HL:BTC");
  });
});
