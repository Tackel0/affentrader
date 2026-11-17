import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseVolume, basicMetrics, candleDayRange, DAY_MS, MINUTE_MS, nonnegative, notionalVolume, pendingRange, quoteRange } from "@/lib/market/quoteMetrics";
import { clearHyperliquidCache, hyperliquidAssets, hyperliquidRange } from "@/lib/server/hyperliquid";
import { columnValue, sortEntries, watchlistCsv } from "@/lib/watchlist";
import { evaluateCondition, requiredQuoteRanges } from "@/lib/alerts/rules";
import { BrowserRuleEngine } from "@/lib/alerts/browserEngine";
import { parseAssets } from "@/lib/market/hyperliquid";
import type { OHLCV, Quote } from "@/types/trading";
import type { AlertRule, Condition } from "@/types/alerts";

const now = 1_800_000_000_000;
const bars = (to = now): OHLCV[] => Array.from({ length: 1440 }, (_, i) => ({ time: to - DAY_MS + i * MINUTE_MS, open: 100, high: i === 0 ? 200 : 110, low: i === 1 ? 50 : 90, close: 101, volume: 2 }));
const makeQuote = (): Quote => ({ symbol: "HL:BTC", price: 105, previous: 104, change: 5, changePercent: 5, high: 110, low: 90, volume: 12, history: [100, 105], time: now, simulated: false,
  metrics: { ...basicMetrics("HL:BTC", 12, 1000, 110, 90, "24h", now), range: pendingRange(now) } });
const comparison: Condition = { op: "leaf", leaf: { type: "compare", left: { type: "quote", field: "high" }, comparator: ">", right: { type: "number", value: 150 } } };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); clearHyperliquidCache(); });
afterEach(() => vi.useRealTimers());

describe("quote unit and period provenance", () => {
  it("retains independently reported base and notional quantities", () => {
    const quote = makeQuote();
    expect(baseVolume(quote)).toBe(12);
    expect(notionalVolume(quote)).toBe(1000);
    expect(columnValue("quoteVolume", quote)).toBe(1000);
    quote.price = 10_000;
    expect(columnValue("quoteVolume", quote)).toBe(1000);
    quote.metrics!.volume.base = null;
    expect(baseVolume(quote)).toBeNull();
    delete quote.metrics;
    expect(notionalVolume(quote)).toBeNull();
  });
  it("parses venue base volume without deriving it from the last price", () => {
    const asset = parseAssets({ universe: [{ name: "BTC" }] }, [{ markPx: "100", dayNtlVlm: "1000", dayBaseVlm: "12" }], "")[0];
    expect(asset).toMatchObject({ baseVolume: 12, volume: 1000, asOf: now });
    expect(parseAssets({ universe: [{ name: "BTC" }] }, [{ markPx: "100", dayNtlVlm: "1000" }], "")[0].baseVolume).toBeNull();
  });
  it.each([undefined, null, "", "  ", "bad", Infinity, -1])("rejects missing or invalid quantities: %s", value => expect(nonnegative(value)).toBeNull());
  it("preserves legitimate zero volume", () => {
    expect(nonnegative("0")).toBe(0);
    const quote = makeQuote(); quote.metrics!.volume.base = 0;
    expect(columnValue("volume", quote)).toBe(0);
  });
  it("uses the actual spot quote currency and keeps unknown currencies unspecified", () => {
    expect(basicMetrics("ETHBTC", 12, 0.5, 1, 0.1, "24h").volume.currency).toBe("BTC");
    expect(basicMetrics("YF:UNKNOWN", null, null, 1, 0.1, "session").volume.currency).toBe("");
  });
  it("sorts unavailable metrics last and exports their provenance and empty values", () => {
    const missing = makeQuote(), known = makeQuote();
    known.symbol = "HL:ETH";
    known.metrics!.range = candleDayRange(bars(), now);
    const quotes = { "HL:BTC": missing, "HL:ETH": known };
    expect(sortEntries(Object.keys(quotes), quotes, { column: "high", direction: "desc" })).toEqual(["HL:ETH", "HL:BTC"]);
    const [header, row] = watchlistCsv(["HL:BTC"], quotes).split("\r\n").map(line => line.split(","));
    const cells = Object.fromEntries(header.map((name, i) => [name, row[i]]));
    expect(cells).toMatchObject({ high: "", low: "", base_volume: "12", notional_volume: "1000", notional_currency: "USD", volume_period: "24h", range_resolution: "1m", range_complete: "false" });
  });
});

describe("complete closed-minute day windows", () => {
  it("takes extrema from all 1440 closed candles, excluding the open minute and expired candles", () => {
    const rows = bars();
    rows.push({ ...rows[0], time: now, high: 10_000 }, { ...rows[0], time: now - DAY_MS - MINUTE_MS, low: 1 });
    expect(candleDayRange(rows, now)).toMatchObject({ high: 200, low: 50, complete: true, bars: 1440, from: now - DAY_MS, to: now });
  });
  it.each(["gap", "duplicate", "unaligned", "inconsistent", "nonfinite"])("does not publish an incomplete or invalid window: %s", kind => {
    const rows = bars();
    if (kind === "gap") rows.splice(400, 1);
    if (kind === "duplicate") rows[400] = rows[399];
    if (kind === "unaligned") rows[400].time++;
    if (kind === "inconsistent") rows[400].high = 99;
    if (kind === "nonfinite") rows[400].close = NaN;
    expect(candleDayRange(rows, now)).toMatchObject({ high: null, low: null, complete: false, bars: 1439 });
  });
  it("makes expired minute-window extrema unavailable", () => {
    const quote = makeQuote(); quote.metrics!.range = candleDayRange(bars(), now);
    expect(quoteRange(quote)).toEqual({ high: 200, low: 50 });
    vi.setSystemTime(now + 3 * MINUTE_MS);
    expect(quoteRange(quote)).toEqual({ high: null, low: null });
  });
});

describe("day-window request lifecycle", () => {
  const makeFetcher = () => vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { req } = JSON.parse(String(init?.body)) as { req: { startTime: number; endTime: number } };
    const rows = bars(Math.floor((req.endTime + 1) / MINUTE_MS) * MINUTE_MS).filter(bar => bar.time >= req.startTime && bar.time <= req.endTime);
    return new Response(JSON.stringify(rows.map(b => ({ t: b.time, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }))));
  });
  it("coalesces requests and incrementally expires old extrema on the next minute", async () => {
    const fetcher = makeFetcher();
    const [first, same] = await Promise.all([hyperliquidRange("BTC", fetcher, now), hyperliquidRange("BTC", fetcher, now)]);
    expect(first).toBe(same);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first.high).toBe(200);
    const next = await hyperliquidRange("BTC", fetcher, now + 2 * MINUTE_MS);
    expect(next).toMatchObject({ high: 110, low: 90, complete: true, bars: 1440 });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]!.body)).req.startTime).toBe(now - MINUTE_MS);
    expect(await hyperliquidRange("BTC", fetcher, now + 2 * MINUTE_MS)).toBe(next);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("retries a full window after a previously incomplete result", async () => {
    const fetcher = makeFetcher();
    fetcher.mockResolvedValueOnce(new Response("[]"));
    expect((await hyperliquidRange("BTC", fetcher, now)).complete).toBe(false);
    expect((await hyperliquidRange("BTC", fetcher, now + MINUTE_MS)).complete).toBe(true);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]!.body)).req.startTime).toBe(now + MINUTE_MS - DAY_MS);
  });
  it("releases failed requests so a later refresh can recover", async () => {
    const fetcher = makeFetcher(); fetcher.mockRejectedValueOnce(new Error("network"));
    await expect(hyperliquidRange("BTC", fetcher, now)).rejects.toThrow("network");
    expect((await hyperliquidRange("BTC", fetcher, now)).complete).toBe(true);
    await expect(hyperliquidRange("bad coin", fetcher, now)).rejects.toThrow("Invalid coin");
  });
  it("does not let a slower old request overwrite a newer cached window", async () => {
    const releases = new Map<number, (response: Response) => void>();
    const fetcher = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>(resolve => {
      const { req } = JSON.parse(String(init?.body)); releases.set(req.endTime + 1, resolve);
    }));
    const older = hyperliquidRange("BTC", fetcher, now), newer = hyperliquidRange("BTC", fetcher, now + MINUTE_MS);
    const response = (to: number) => new Response(JSON.stringify(bars(to).map(b => ({ t: b.time, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }))));
    releases.get(now + MINUTE_MS)!(response(now + MINUTE_MS));
    const latest = await newer;
    releases.get(now)!(response(now)); await older;
    expect(await hyperliquidRange("BTC", fetcher, now + MINUTE_MS)).toBe(latest);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("limits concurrent candle windows and lets queued work proceed", async () => {
    const releases: (() => void)[] = [];
    const fetcher = vi.fn(() => new Promise<Response>(resolve => releases.push(() => resolve(new Response("[]")))));
    const tasks = ["BTC", "ETH", "SOL"].map(coin => hyperliquidRange(coin, fetcher, now));
    expect(fetcher).toHaveBeenCalledTimes(2);
    releases[0]();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    releases[1](); releases[2]();
    expect((await Promise.all(tasks)).every(range => !range.complete && range.high === null)).toBe(true);
  });
  it("keeps public snapshot timestamps through cache hits and coalesces registry fetches", async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const { type } = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(type === "perpDexs" ? [null] : [{ universe: [{ name: "BTC" }] }, [{ markPx: "100", dayBaseVlm: "12", dayNtlVlm: "1000" }]]));
    });
    const [first, same] = await Promise.all([hyperliquidAssets(fetcher), hyperliquidAssets(fetcher)]);
    expect(first).toBe(same); expect(fetcher).toHaveBeenCalledTimes(2);
    vi.setSystemTime(now + 30_000);
    expect((await hyperliquidAssets(fetcher))[0].asOf).toBe(now);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("range alert availability", () => {
  it("finds range dependencies in nested and cross-symbol conditions", () => {
    expect(requiredQuoteRanges({ op: "any", conditions: [comparison, { op: "leaf", leaf: { type: "band", symbol: "HL:ETH", operand: { type: "quote", field: "low" }, low: 1, high: 2, mode: "inside" } }] }, { symbol: "HL:BTC", timeframe: "1m" })).toEqual(["HL:BTC", "HL:ETH"]);
  });
  it("does not reset an established edge during missing data or fire on recovery", () => {
    const quote = makeQuote(); quote.metrics!.range = candleDayRange(bars(), now);
    const rule: AlertRule = { id: "r", name: "Range high", kind: "technical", status: "active", scope: { type: "symbol", symbol: "HL:BTC", timeframe: "1m" }, condition: comparison, frequency: "tick", repeat: true, cooldownMs: 0, sound: false, browserNotification: false, serverSide: false, createdAt: now };
    const fire = vi.fn();
    const engine = new BrowserRuleEngine({ rules: () => [rule], bars: () => [], quote: () => quote, ensure: async () => [], fire });
    engine.prime();
    quote.metrics!.range = pendingRange(now);
    expect(evaluateCondition(comparison, { symbol: "HL:BTC", timeframe: "1m" }, () => ({ bars: [], quote }))).toMatchObject({ met: false, incomplete: true });
    vi.setSystemTime(now + 1000); engine.onPrice("HL:BTC");
    quote.metrics!.range = candleDayRange(bars(), now);
    vi.setSystemTime(now + 2000); engine.onPrice("HL:BTC");
    expect(fire).not.toHaveBeenCalled();
  });
});
