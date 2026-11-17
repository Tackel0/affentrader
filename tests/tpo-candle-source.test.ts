import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TpoCandlePool, TpoCandleSource, tpoExplicitTape, type TpoSourceRequest } from "@/lib/orderflow/tpoCandleSource";
import { defaultTpo } from "@/lib/orderflow/tpoSettings";
import { createTpoCache, tpoWindow } from "@/lib/orderflow/tpoModel";
import { clearMarketSessions, marketSessions, registerMarketSessions } from "@/lib/market/sessionWindows";
import type { YahooLoad, YahooLoadRequest } from "@/lib/market/yahooClient";
import { parseMeta } from "@/lib/market/yahoo";
const day = Date.UTC(2026, 10, 4), m = 60000, bar = (time: number, high = 102) => ({ time, open: 100, high, low: 99, close: 101, volume: 2 });
const regular = [[day + 870 * m, day + 1260 * m]] as [number, number][], extended = [[day + 540 * m, day + 1500 * m]] as [number, number][];
const all = Array.from({ length: 28 }, (_, i) => bar(day + (540 + i * 15) * m));
const chart = all.filter(b => b.time >= regular[0][0]);
const request = (patch: Partial<TpoSourceRequest> = {}): TpoSourceRequest => ({ symbol: "YF:AAPL", timeframe: "15m", style: { ...defaultTpo(), tradingHours: "Extended hours (ETH)" },
  bars: chart, epoch: "1:0", replay: false, adjustDividends: false, ...patch });
const payload = (bars = all): YahooLoad => ({ bars, meta: { ...parseMeta({ symbol: "AAPL" }), sessions: { regular, extended } }, events: { dividends: [], splits: [] } });
const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
const owners: TpoCandleSource[] = [];
function owner(pool: TpoCandlePool, repaint = vi.fn()) { const source = new TpoCandleSource(repaint, pool); owners.push(source); return source; }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(day + 990 * m); });
afterEach(() => { owners.splice(0).forEach(source => source.reset()); clearMarketSessions(); vi.useRealTimers(); });
it("loads extended source candles beside an RTH base without changing chart data or its calendar", async () => {
  registerMarketSessions("YF:AAPL", { regular, extended: [] }, "regular"); const before = marketSessions("YF:AAPL"), original = JSON.stringify(chart);
  const loader = vi.fn(async (_r: YahooLoadRequest) => payload()), source = owner(new TpoCandlePool(loader));
  expect(source.read(request()).status).toBe("loading"); await flush();
  const read = source.read(request()); expect(read.status).toBe("ready");
  if (read.status !== "ready") throw new Error("missing snapshot");
  expect(read.value.bars).toHaveLength(28); expect(loader.mock.calls[0][0]).toMatchObject({ extended: true });
  expect(JSON.stringify(chart)).toBe(original); expect(marketSessions("YF:AAPL")).toBe(before);
  expect(createTpoCache().read(read.value.bars, request().style, "15m", "YF:AAPL", read.value.calendar)[0].start).toBe(extended[0][0]);
});
it("keeps initial viewport navigation safe before the independent ETH calendar arrives", () => {
  registerMarketSessions("YF:AAPL", { regular, extended: [] }, "regular");
  expect(tpoWindow(chart, request().style, "YF:AAPL")).toEqual({ from: chart[0].time, to: chart.at(-1)!.time + 30 * m });
  expect(() => createTpoCache().read(chart, request().style, "15m", "YF:AAPL")).toThrow(/extended-hours calendar/);
});
it("can restore a host viewport when its regular candles contain no pre-market timestamps", () => {
  const range = tpoWindow(chart, { ...defaultTpo(), tradingHours: "Pre-market" }, "YF:AAPL");
  expect(range).toBeDefined(); expect(range!.from).toBeLessThanOrEqual(chart.at(-1)!.time); expect(range!.to).toBeGreaterThan(chart.at(-1)!.time);
});
it("keeps Full day, Week/Month, continuous venues and simulation on their original candles", () => {
  const loader = vi.fn(async () => payload()), source = owner(new TpoCandlePool(loader));
  for (const patch of [{ style: defaultTpo() }, { style: { ...request().style, sessionPeriod: "Week" as const } }, { symbol: "KRK:BTC/USD" }, { simulation: true }]) {
    const read = source.read(request(patch)); expect(read.status).toBe("ready"); if (read.status === "ready") expect(read.value.bars).toBe(chart);
  }
  expect(loader).not.toHaveBeenCalled();
  expect(tpoExplicitTape("YF:AAPL", { tradingHours: "Regular hours (RTH)" })).toBe("regular");
  expect(tpoExplicitTape("YF:AAPL", { tradingHours: "London" })).toBe("extended");
});
it("coalesces equal requests and keeps different instance tapes/calendars separate", async () => {
  const loader = vi.fn(async (r: YahooLoadRequest) => payload(r.extended ? all : chart)), pool = new TpoCandlePool(loader);
  const a = owner(pool), b = owner(pool), c = owner(pool);
  a.read(request()); b.read(request()); c.read(request({ style: { ...defaultTpo(), tradingHours: "Regular hours (RTH)" } })); await flush();
  expect(loader).toHaveBeenCalledTimes(2);
  const left = a.read(request()), right = c.read(request({ style: { ...defaultTpo(), tradingHours: "Regular hours (RTH)" } }));
  if (left.status !== "ready" || right.status !== "ready") throw new Error("missing snapshot");
  expect(left.value.calendar?.mode).toBe("extended"); expect(right.value.calendar?.mode).toBe("regular");
  expect(right.value.bars).toHaveLength(chart.length);
});
it("fences obsolete market/epoch requests and detached owners", async () => {
  const resolves: ((value: YahooLoad) => void)[] = [], loader = vi.fn(() => new Promise<YahooLoad>(resolve => resolves.push(resolve))), repaint = vi.fn(), source = owner(new TpoCandlePool(loader), repaint);
  source.read(request()); source.read(request({ epoch: "2:0", symbol: "YF:MSFT" })); resolves[0](payload()); await flush();
  expect(repaint).not.toHaveBeenCalled(); expect(source.read(request({ epoch: "2:0", symbol: "YF:MSFT" })).status).toBe("loading");
  source.reset(); resolves[1](payload()); await flush(); expect(repaint).not.toHaveBeenCalled();
});
it("refreshes a quiet live chart without trade events and retries a failed snapshot", async () => {
  const loader = vi.fn(async () => payload()), repaint = vi.fn(), source = owner(new TpoCandlePool(loader), repaint);
  source.read(request()); await flush(); expect(repaint).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(15000); expect(repaint).toHaveBeenCalledTimes(2);
  loader.mockRejectedValueOnce(new Error("offline")); source.read(request()); await flush();
  expect(source.read(request())).toMatchObject({ status: "error", message: "offline" });
  await vi.advanceTimersByTimeAsync(15000); source.read(request()); await flush(); expect(source.read(request()).status).toBe("ready");
  expect(loader).toHaveBeenCalledTimes(3);
});
it("uses only complete Replay source bars and the actual revealed partial candle", async () => {
  const through = day + 900 * m, future = [...all, bar(through + 15 * m, 9999)], loader = vi.fn(async () => payload(future));
  const source = owner(new TpoCandlePool(loader)), partial = { ...bar(through, 103), close: 102 }, args = request({ replay: true, through, bars: [...chart.filter(b => b.time < through), partial] });
  source.read(args); await flush(); const first = source.read(args); if (first.status !== "ready") throw new Error("missing snapshot");
  expect(first.value.bars.at(-1)).toEqual(partial); expect(first.value.bars.every(b => b.high < 9999)).toBe(true);
  const backward = source.read({ ...args, through: through - 15 * m, bars: args.bars.slice(0, -1) });
  if (backward.status !== "ready") throw new Error("missing snapshot");
  expect(backward.value.bars.every(b => b.time <= through - 15 * m)).toBe(true); expect(loader).toHaveBeenCalledTimes(1);
});
it("withholds independent Replay data when its revealed boundary is unknown", () => {
  const loader = vi.fn(async () => payload()), source = owner(new TpoCandlePool(loader));
  expect(source.read(request({ replay: true, through: null })).status).toBe("loading"); expect(loader).not.toHaveBeenCalled();
});
it("rejects invalid Custom minutes before requesting provider history", () => {
  const loader = vi.fn(async () => payload()), source = owner(new TpoCandlePool(loader));
  expect(source.read(request({ style: { ...defaultTpo(), tradingHours: "Custom", customStart: 1260 } }))).toMatchObject({ status: "error" });
  expect(loader).not.toHaveBeenCalled();
});
it("withholds an expired live snapshot while refreshing after a suspended tab wakes", async () => {
  const loader = vi.fn(async () => payload()), source = owner(new TpoCandlePool(loader));
  source.read(request()); await flush(); expect(source.read(request()).status).toBe("ready");
  vi.setSystemTime(day + 1050 * m);
  expect(source.read(request()).status).toBe("loading"); await flush(); expect(source.read(request()).status).toBe("ready");
});
