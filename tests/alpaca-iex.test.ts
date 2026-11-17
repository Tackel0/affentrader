import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alpacaError, parseIexBar, parseIexOhlcv, parseIexTrade, validAlpacaCredentials } from "@/lib/market/alpaca";
import { iexSymbol, isSymbolId, providerOf, tickerOf } from "@/lib/symbolId";
import { aggregateIexBars, IexStream, iexHistoryPlan, loadIexBars } from "@/lib/market/alpacaClient";
import { IexCandles, mergeIexSeries } from "@/lib/market/iexCandles";
import { alpacaCredentials, useAlpacaStore } from "@/stores/useAlpacaStore";
import { alpacaBarsRequest } from "@/lib/server/alpaca";
import { POST } from "@/app/api/alpaca/route";
import { MarketService, stripVenue } from "@/lib/market/service";
import { useChartStore } from "@/stores/useChartStore";
import { pineSeries } from "@/lib/alerts/pineRules";
import { createWorkspaceBackup } from "@/lib/workspaceBackup";
import { parseWorkspace } from "@/lib/workspace";
import type { OHLCV } from "@/types/trading";

const credentials = { key: "FIXTURE_KEY", secret: "FIXTURE_SECRET" };
const minute = Date.parse("2026-10-30T14:30:00Z");
const bar = (offset: number, volume = 2): OHLCV => ({ time: minute + offset * 60_000, open: 100, high: 110, low: 90, close: 100 + offset, volume });
const raw = (offset: number, patch: Record<string, unknown> = {}) => ({ T: "b", S: "AAPL", t: new Date(minute + offset * 60_000).toISOString(), o: 100, h: 110, l: 90, c: 100 + offset, v: 2, ...patch });
class Socket {
  static OPEN = 1; static all: Socket[] = []; readyState = 0; sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor(public url: string) { Socket.all.push(this); }
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
let services: MarketService[] = [];
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(minute + 150_000); vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("WebSocket", Socket); Socket.all = []; services = []; useAlpacaStore.getState().disconnect();
  useChartStore.getState().set({ symbol: "IEX:AAPL", timeframe: "1m", quotes: {}, candles: [], trades: [] });
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => String(input) === "/api/alpaca" ? Response.json({ bars: [bar(0), bar(1), bar(2)], nextPage: null }) : Response.json({}, { status: 404 })));
});
afterEach(() => { services.forEach(service => service.stop()); useAlpacaStore.getState().disconnect(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const connect = () => { useAlpacaStore.getState().connect(credentials); const service = new MarketService(); services.push(service); service.start(["IEX:AAPL"], "auto"); const socket = Socket.all.find(socket => socket.url.includes("alpaca"))!; socket.open(); socket.receive([{ T: "success", msg: "authenticated" }]); return { service, socket }; };

describe("Alpaca IEX read-only data", () => {
  it("refreshes a delayed SIP chart without emitting live close alerts", async () => {
    vi.setSystemTime(minute + 17 * 60000);
    let rows = [bar(0)];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/alpaca"
      ? Response.json({ bars: rows, nextPage: null }) : Response.json({}, { status: 404 })));
    useChartStore.getState().set({ symbol: "SIP:AAPL", timeframe: "1m" });
    useAlpacaStore.getState().connect(credentials);
    const service = new MarketService();
    services.push(service);
    service.start(["SIP:AAPL"], "auto");
    await service.history("SIP:AAPL", "1m", 1);
    const updated = vi.fn(), closed = vi.fn(), candleEvent = vi.fn();
    service.subscribe("SIP:AAPL", "1m", updated);
    service.onClose(closed);
    service.onCandleUpdate(candleEvent);
    rows = [bar(0), bar(1)];
    await vi.advanceTimersByTimeAsync(1000);
    expect(updated).toHaveBeenCalledExactlyOnceWith(bar(1));
    expect(useChartStore.getState().candles).toEqual(rows);
    await vi.advanceTimersByTimeAsync(61000);
    expect(updated).toHaveBeenCalledTimes(1);
    expect(closed).not.toHaveBeenCalled();
    expect(candleEvent).not.toHaveBeenCalled();
  });
  it("loads separately identified delayed SIP candles without opening an IEX stream", async () => {
    vi.setSystemTime(minute + 20 * 60000);
    const fetcher = vi.fn(async (url: string, _request?: RequestInit) => url === "/api/alpaca"
      ? Response.json({ bars: [bar(0)], nextPage: null }) : Response.json({}, { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    useChartStore.getState().set({ symbol: "SIP:AAPL" });
    useAlpacaStore.getState().connect(credentials);
    const service = new MarketService();
    services.push(service);
    service.start(["SIP:AAPL"], "auto");
    expect(await service.history("SIP:AAPL", "1m", 1, minute)).toEqual([bar(0)]);
    const request = fetcher.mock.calls.find(([url]) => url === "/api/alpaca")?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({ ticker: "AAPL", feed: "sip", end: minute });
    expect(Socket.all.some(socket => socket.url.includes("alpaca"))).toBe(false);
    expect(isSymbolId("SIP:AAPL")).toBe(true);
    expect(stripVenue("SIP:AAPL")).toBe("SIP:AAPL");
    expect(pineSeries("SIP:AAPL", "1m", []).info.prefix).toBe("SIP");
  });
  it("clamps recent SIP requests and excludes newer bars even if the provider returns them", async () => {
    const now = Date.now();
    const cutoff = now - 16 * 60000;
    const fetcher = vi.fn(async () => Response.json({ bars: { AAPL: [
      raw(0, { t: new Date(cutoff - 60000).toISOString() }), raw(0, { t: new Date(now).toISOString() }),
    ] } }));
    const result = await alpacaBarsRequest({ credentials, ticker: "AAPL", timeframe: "1Min", end: now, limit: 100, feed: "sip" }, fetcher);
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    const params = new URL(url).searchParams;
    expect(params.get("feed")).toBe("sip");
    expect(Date.parse(params.get("end")!)).toBe(cutoff);
    expect(result.bars.map(value => value.time)).toEqual([cutoff - 60000]);
  });
  it("preserves explicit provider identities through symbol validation, venue stripping and Pine metadata", () => {
    expect(iexSymbol(" aapl ")).toBe("IEX:AAPL"); expect(providerOf("IEX:AAPL")).toBe("alpaca"); expect(tickerOf("IEX:BRK.B")).toBe("BRK.B");
    expect(isSymbolId("IEX:BRK.B")).toBe(true); expect(isSymbolId("IEX:../secret")).toBe(false); expect(stripVenue("IEX:AAPL")).toBe("IEX:AAPL");
    expect(pineSeries("IEX:AAPL", "1m", []).info).toMatchObject({ tickerid: "IEX:AAPL", prefix: "IEX", type: "stock", currency: "USD", timezone: "America/New_York" });
  });
  it("parses exchange bars and nanosecond trade clocks without inventing an aggressor side", () => {
    expect(parseIexOhlcv(raw(0))).toEqual(bar(0)); expect(parseIexBar(raw(0, { T: "u" }))).toMatchObject({ correction: true, daily: false });
    const trade = parseIexTrade({ T: "t", S: "AAPL", i: 123, p: 101, s: 4, t: "2026-10-30T14:30:00.123456789Z", c: ["@"] });
    expect(trade).toMatchObject({ symbol: "IEX:AAPL", time: minute + 123, quantity: 4 }); expect(trade).not.toHaveProperty("side");
    for (const patch of [{ l: 120 }, { c: 0 }, { h: NaN }, { v: -1 }, { t: "bad" }]) expect(parseIexOhlcv(raw(0, patch))).toBeNull();
  });
  it("keeps credentials outside serializable state and clears them on disconnect", () => {
    expect(validAlpacaCredentials(credentials)).toBe(true); expect(() => useAlpacaStore.getState().connect({ key: "bad", secret: "bad" })).toThrow();
    useAlpacaStore.getState().connect(credentials); expect(alpacaCredentials()).toEqual(credentials);
    expect(JSON.stringify(useAlpacaStore.getState())).not.toContain("FIXTURE");
    const backup = JSON.stringify(createWorkspaceBackup()); expect(backup).not.toContain("FIXTURE_KEY"); expect(backup).not.toContain("FIXTURE_SECRET"); expect(() => parseWorkspace(backup)).not.toThrow();
    useAlpacaStore.getState().disconnect(); expect(() => alpacaCredentials()).toThrow(/Connect Alpaca/);
  });
  it("restricts the proxy to fixed IEX raw data, forwards credentials only as headers and sanitizes upstream failures", async () => {
    const fetcher = vi.fn(async () => Response.json({ bars: { AAPL: [raw(0)] }, next_page_token: "next" }));
    const result = await alpacaBarsRequest({ credentials, ticker: "AAPL", timeframe: "1Min", end: minute, limit: 100 }, fetcher);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://data.alpaca.markets/v2/stocks/bars?"); expect(url).toContain("feed=iex"); expect(url).toContain("adjustment=raw"); expect(url).not.toContain("FIXTURE");
    expect(init).toMatchObject({ cache: "no-store", redirect: "error", headers: { "APCA-API-KEY-ID": credentials.key, "APCA-API-SECRET-KEY": credentials.secret } });
    expect(result).toEqual({ bars: [bar(0)], nextPage: "next" });
    const failed = () => alpacaBarsRequest({ credentials, ticker: "AAPL", timeframe: "1Min", end: minute, limit: 100 }, vi.fn(async () => new Response("FIXTURE_SECRET", { status: 401 })));
    await expect(failed()).rejects.toThrow("Alpaca authentication failed"); await expect(failed()).rejects.not.toThrow("FIXTURE");
    await expect(alpacaBarsRequest({ credentials, ticker: "../account", timeframe: "1Min", end: minute, limit: 100 }, fetcher)).rejects.toThrow(/Invalid/);
  });
  it("rejects cross-site requests before forwarding and sends no-store errors", async () => {
    const response = await POST(new Request("http://localhost/api/alpaca", { method: "POST", headers: { origin: "https://hostile.example" }, body: "{}" }));
    expect(response.status).toBe(403); expect(response.headers.get("cache-control")).toContain("no-store"); expect(fetch).not.toHaveBeenCalled();
    const invalid = await POST(new Request("http://localhost/api/alpaca", { method: "POST", body: "{}" })); expect(invalid.status).toBe(400);
  });
  it("paginates source bars, sorts/deduplicates them, bounds work and rejects session changes", async () => {
    useAlpacaStore.getState().connect(credentials);
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ bars: [bar(2), bar(1)], nextPage: "page2" })).mockResolvedValueOnce(Response.json({ bars: [bar(1), bar(0)], nextPage: null }));
    const result = await loadIexBars("IEX:AAPL", "1m", 4, minute + 150_000, fetcher);
    expect(result.bars).toEqual([bar(0), bar(1), bar(2)]); expect(JSON.parse(fetcher.mock.calls[1][1].body).pageToken).toBe("page2");
    expect(iexHistoryPlan("4h", 600).wanted).toBe(20_000); expect(() => iexHistoryPlan("1s", 600)).toThrow(); expect(() => iexHistoryPlan("100T", 5)).toThrow();
    const changed = vi.fn(async () => { useAlpacaStore.getState().disconnect(); return Response.json({ bars: [bar(0)] }); });
    await expect(loadIexBars("IEX:AAPL", "1m", 2, minute, changed)).rejects.toThrow(/session changed/);
  });
  it("replaces minute corrections rather than doubling volume, keeps concurrent updates and preserves native daily clocks", () => {
    const source = new IexCandles(), start = source.revision; source.put(bar(1, 8)); source.seed([bar(0), bar(1)], start);
    expect(source.bars("5m")[0].volume).toBe(10); source.put(bar(1, 6)); expect(source.bars("5m")[0].volume).toBe(8);
    const daily = { ...bar(0), time: Date.parse("2026-10-30T04:00:00Z") }; expect(aggregateIexBars([daily], "1D")[0].time).toBe(daily.time);
  });
  it("retains earlier paged bars across streaming updates and excludes a truncated first aggregate at the source capacity", () => {
    expect(mergeIexSeries([bar(-3), bar(-2), bar(0)], [bar(0, 9), bar(1)])).toEqual([bar(-3), bar(-2), bar(0, 9), bar(1)]);
    const full = Array.from({ length: 20_000 }, (_, index) => ({ ...bar(0), time: minute + (index + 1) * 60_000 }));
    const result = aggregateIexBars(full, "5m"); expect(result[0].time).toBe(minute + 300_000);
  });
  it("authenticates before subscribing, enforces 30 symbols, updates subscriptions in place and deduplicates trades", () => {
    const host = { credentials: () => credentials, trade: vi.fn(), bar: vi.fn(), status: vi.fn(), subscription: vi.fn(), gap: vi.fn() };
    const stream = new IexStream(host); stream.setSymbols(Array.from({ length: 32 }, (_, index) => `IEX:S${index}`)); stream.start(); const socket = Socket.all[0];
    socket.open(); expect(socket.sent).toEqual([{ action: "auth", ...credentials }]);
    socket.receive([{ T: "success", msg: "authenticated" }]); expect((socket.sent[1].trades as string[])).toHaveLength(30); expect(host.subscription.mock.calls[0][1]).toHaveLength(2);
    stream.setSymbols(["IEX:AAPL"]); expect(Socket.all).toHaveLength(1); expect(socket.sent.at(-1)).toMatchObject({ action: "subscribe", trades: ["AAPL"] });
    const trade = { T: "t", S: "AAPL", i: 1, p: 100, s: 1, t: new Date(minute).toISOString() }; socket.receive([trade, trade, { ...trade, S: "MSFT" }, raw(0)]);
    expect(host.trade).toHaveBeenCalledTimes(1); expect(host.bar).toHaveBeenCalledTimes(1); stream.stop();
  });
  it("reconnects after transport closure and fences callbacks from an obsolete socket", async () => {
    const host = { credentials: () => credentials, trade: vi.fn(), bar: vi.fn(), status: vi.fn(), subscription: vi.fn(), gap: vi.fn() };
    const stream = new IexStream(host); stream.setSymbols(["IEX:AAPL"]); stream.start(); const old = Socket.all[0], late = old.onmessage!; old.close();
    await vi.advanceTimersByTimeAsync(1000); expect(Socket.all).toHaveLength(2); late({ data: JSON.stringify([raw(0)]) }); expect(host.bar).not.toHaveBeenCalled(); expect(host.gap).toHaveBeenCalledTimes(1);
    stream.stop(); await vi.advanceTimersByTimeAsync(60_000); expect(Socket.all).toHaveLength(2);
  });
  it("stops on authentication/entitlement errors and never echoes the provider's raw message", async () => {
    const host = { credentials: () => credentials, trade: vi.fn(), bar: vi.fn(), status: vi.fn(), subscription: vi.fn(), gap: vi.fn() };
    const stream = new IexStream(host); stream.start(); Socket.all[0].receive([{ T: "error", code: 401, msg: "FIXTURE_SECRET" }]);
    expect(host.status).toHaveBeenLastCalledWith("error", alpacaError(401)); await vi.advanceTimersByTimeAsync(60_000); expect(Socket.all).toHaveLength(1);
  });
  it("delivers real-price observations without classified ticks/depth, and candle corrections do not replay closes", async () => {
    const { service, socket } = connect(), tick = vi.fn(), close = vi.fn(), candle = vi.fn(), quote = vi.fn();
    service.onTick(tick); service.onClose(close); service.onCandleUpdate(candle); service.onQuote(quote);
    await service.history("IEX:AAPL", "1m", 3); expect(close).not.toHaveBeenCalled();
    socket.receive([{ T: "t", S: "AAPL", i: 1, p: 105, s: 10, t: new Date(minute + 151_000).toISOString() }]);
    expect(quote).toHaveBeenCalledTimes(1); expect(useChartStore.getState().quotes["IEX:AAPL"]).toMatchObject({ price: 105, time: minute + 151_000, priceBasis: "trade", metrics: { volume: { base: null, currency: "USD" }, range: { period: "observed", complete: false } } });
    expect(tick).not.toHaveBeenCalled(); expect(service.tradesFor("IEX:AAPL")).toEqual([]); expect(useChartStore.getState().orderBook).toBeNull();
    socket.receive([raw(2, { v: 9 })]); expect(close).toHaveBeenCalledTimes(1); expect(close.mock.calls[0][2]).toMatchObject({ time: minute + 120_000, volume: 9 });
    socket.receive([raw(1, { T: "u", v: 12 })]); expect(close).toHaveBeenCalledTimes(1); expect(service.barsFor("IEX:AAPL", "1m")[1].volume).toBe(12); expect(candle).toHaveBeenCalledTimes(2);
  });
  it("does not let an old interrupted history request replace recovered data", async () => {
    const { service, socket } = connect(); let resolve: (value: Response) => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
    const old = service.history("IEX:AAPL", "1m", 3); const rejected = expect(old).rejects.toThrow(/connection changed/);
    socket.close(); await vi.advanceTimersByTimeAsync(1000); await service.history("IEX:AAPL", "1m", 3);
    resolve(Response.json({ bars: [{ ...bar(0), close: 109 }], nextPage: null })); await rejected;
    expect(service.barsFor("IEX:AAPL", "1m")[0].close).toBe(100);
  });
  it("requires a fresh session after disconnect and never falls back to generated data in auto mode", async () => {
    const service = new MarketService(); services.push(service); service.start(["IEX:AAPL"], "auto");
    await expect(service.history("IEX:AAPL", "1m", 3)).rejects.toThrow(/Connect Alpaca/); await vi.advanceTimersByTimeAsync(20_000);
    expect(service.tradesFor("IEX:AAPL")).toEqual([]); expect(useChartStore.getState().quotes["IEX:AAPL"]).toBeUndefined();
  });
  it("keeps the IEX socket and chart generation intact for quote-only watchlist edits", async () => {
    const { service, socket } = connect(); await service.history("IEX:AAPL", "1m", 3);
    const epoch = useChartStore.getState().feedEpoch, bars = service.barsFor("IEX:AAPL", "1m");
    service.start(["IEX:AAPL"], "auto", ["IEX:MSFT"]);
    expect(Socket.all.filter(value => value.url.includes("alpaca"))).toHaveLength(1); expect(socket.sent.at(-1)).toMatchObject({ action: "subscribe", trades: ["MSFT"] });
    expect(useChartStore.getState().feedEpoch).toBe(epoch); expect(service.barsFor("IEX:AAPL", "1m")).toEqual(bars);
  });
  it("preserves actual native backward pages when the next IEX minute arrives", async () => {
    const { service, socket } = connect(); await service.velaFeed.load({ symbol: "IEX:AAPL", timeframe: "1m", bars: 3 });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ bars: [bar(-3), bar(-2), bar(-1)], nextPage: null }));
    await service.velaFeed.loadRange!({ symbol: "IEX:AAPL", timeframe: "1m" }, { to: minute - 1, limit: 3 });
    expect(service.barsFor("IEX:AAPL", "1m")).toHaveLength(6);
    socket.receive([raw(2, { v: 10 })]);
    expect(service.barsFor("IEX:AAPL", "1m")).toHaveLength(6); expect(service.barsFor("IEX:AAPL", "1m")[0].time).toBe(minute - 180_000);
    expect(await service.velaFeed.symbolInfo!({ symbol: "IEX:AAPL" })).toMatchObject({ type: "stock", timezone: "America/New_York", currency: "USD" });
  });
  it("closes an aggregated five-minute bar once, after every minute is replaced, despite a failing candle subscriber", async () => {
    const { service, socket } = connect(), close = vi.fn(), healthy = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    service.onClose(close); service.onCandleUpdate(() => { throw new Error("fixture consumer"); }); service.onCandleUpdate(healthy);
    await service.history("IEX:AAPL", "5m", 1); expect(close).not.toHaveBeenCalled();
    vi.setSystemTime(minute + 300_000); socket.receive([raw(3), raw(4), raw(4), raw(3, { T: "u", v: 8 })]);
    expect(close).toHaveBeenCalledTimes(1); expect(close.mock.calls[0][2]).toMatchObject({ time: minute, volume: 10 });
    expect(service.barsFor("IEX:AAPL", "5m")[0].volume).toBe(16); expect(healthy).toHaveBeenCalledTimes(4);
  });
  it("rejects session-only IEX symbols for server rules, including nested mixed-market conditions", async () => {
    const { validateRule } = await import("@/lib/server/alertService");
    const leaf = { op: "leaf", leaf: { type: "compare", left: { type: "quote", field: "price" }, comparator: ">", right: { type: "number", value: 100 } } };
    const rule = { id: "fixture-rule", name: "Fixture", kind: "technical", status: "active", scope: { type: "symbol", symbol: "IEX:AAPL", timeframe: "1m" }, condition: leaf, frequency: "tick", repeat: true, cooldownMs: 0, sound: false, browserNotification: false, serverSide: true, createdAt: 1 };
    expect(() => validateRule(rule)).toThrow(/session-only/);
    expect(() => validateRule({ ...rule, scope: { ...rule.scope, symbol: "BTCUSDT" }, condition: { ...leaf, leaf: { ...leaf.leaf, symbol: "IEX:AAPL" } } })).toThrow(/session-only/);
  });
});
