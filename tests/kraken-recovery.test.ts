import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarketService } from "@/lib/market/service";
import { useChartStore } from "@/stores/useChartStore";

const symbol = "KRK:BTC/USD", key = `${symbol}:1m`;
const base = Date.UTC(2026, 10, 4, 12);
const row = (time: number, volume = 10) => [time / 1000, "100", "110", "90", "105", "100", String(volume), 3];
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (event: { data: string }) => void;
  constructor(readonly url: string) { Socket.instances.push(this); }
  send() {}
  open(acknowledge = true) {
    this.onopen?.();
    if (acknowledge) this.acknowledgeTrade("BTC/USD");
  }
  acknowledgeTrade(pair: string, time = Date.now(), success = true) {
    this.onmessage?.({ data: JSON.stringify({ method: "subscribe", success,
      result: { channel: "trade", symbol: pair }, time_out: new Date(time).toISOString(),
    }) });
  }
  close() { this.onclose?.(); }
  trade(id: number, time: number, quantity = 1) {
    this.onmessage?.({ data: JSON.stringify({ channel: "trade", type: "update", data: [
      { symbol: "BTC/USD", side: "buy", price: 106, qty: quantity, trade_id: id, timestamp: new Date(time).toISOString() },
    ] }) });
  }
}
let service: MarketService;
let rows: unknown[][];
let response: (() => Promise<Response>) | undefined;
let requests: number;
let recentIds: number[];
let recentResponse: (() => Promise<Response>) | undefined;
let recentRequests: number;
const recent = (ids: number[]) => Response.json({ error: [], result: { "BTC/USD": ids.map(id =>
  ["100", "1", (base + id) / 1000, "b", "m", "", id]) } });
const socket = () => Socket.instances.filter(socket => socket.url.includes("ws.kraken.com")).at(-1)!;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(base + 1000);
  Socket.instances = [];
  rows = [row(base - 60000), row(base)];
  response = undefined;
  requests = 0;
  recentIds = [];
  recentResponse = undefined;
  recentRequests = 0;
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
    if (String(url).includes("/OHLC")) {
      requests++;
      return response ? response() : Response.json({ error: [], result: { BTCUSD: rows } });
    }
    if (String(url).includes("/Trades")) {
      recentRequests++;
      return recentResponse ? recentResponse() : recent(recentIds);
    }
    if (String(url).includes("AssetPairs")) return Response.json({ error: [], result: { "BTC/USD": { tick_size: "0.1", lot_decimals: 8 } } });
    return Response.json({});
  }));
  useChartStore.getState().set({ symbol, timeframe: "1m", quotes: {}, candleRecoveries: {} });
  service = new MarketService();
  service.start([symbol], "auto");
  socket().open();
  await service.history(symbol, "1m");
  socket().trade(1, base + 1000, 2);
});
afterEach(() => {
  service.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function reconnect() {
  socket().close();
  vi.setSystemTime(base + 119000);
  await vi.advanceTimersByTimeAsync(2000);
  socket().open();
  await flush();
}
const repairedRows = () => [row(base - 60000), row(base, 20), row(base + 60000, 30), row(base + 120000, 40), row(base + 180000)];

it("rebuilds interrupted tick candles without duplicate volume or live events for historical trades", async () => {
  recentIds = Array.from({ length: 13 }, (_, index) => index + 90);
  const frame = "10T", tickKey = `${symbol}:${frame}`;
  await service.history(symbol, frame);
  const old = service.barsFor(symbol, frame);
  expect(old.map(bar => bar.volume)).toEqual([10, 3]);
  const closes = vi.fn(), trades = vi.fn(), chart = vi.fn();
  service.onClose((s, tf, bar) => { if (s === symbol && tf === frame) closes(bar); });
  service.onTick(trades);
  service.velaFeed.subscribe({ symbol, timeframe: frame }, chart);
  rows = repairedRows();
  await reconnect();
  socket().trade(107, base + 121000);
  expect(service.barsFor(symbol, frame)).toEqual([]);
  expect(chart).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(useChartStore.getState().candleRecoveries[tickKey]?.status).toBe("retrying");
  expect(closes).not.toHaveBeenCalled();

  recentIds = Array.from({ length: 18 }, (_, index) => index + 90);
  socket().trade(108, base + 121001, 2);
  await vi.advanceTimersByTimeAsync(3500);
  expect(useChartStore.getState().candleRecoveries[tickKey]).toBeUndefined();
  const bars = service.barsFor(symbol, frame);
  expect(bars.map(bar => [bar.time, bar.volume])).toEqual([[old[0].time, 10], [old[1].time, 10]]);
  expect(chart).toHaveBeenCalledOnce();
  const update = chart.mock.calls[0][0];
  expect(update[Symbol.for("affentrader.vela.candle-repair")]).toEqual({ from: old[1].time, bars });
  expect(trades.mock.calls.map(([trade]) => trade.seq)).toEqual([107, 108]);
  socket().trade(106, base + 121002, 100);
  expect(service.barsFor(symbol, frame).at(-1)?.volume).toBe(10);
  socket().trade(110, base + 121003);
  expect(closes).not.toHaveBeenCalled();
  socket().trade(120, base + 121004);
  expect(closes).toHaveBeenCalledTimes(1);
});

it("leaves tick history unavailable when the API no longer includes the interruption", async () => {
  recentIds = [100, 101, 102];
  await service.history(symbol, "10T");
  rows = repairedRows();
  await reconnect();
  recentIds = [200, 201, 202];
  socket().trade(202, base + 121000);
  await vi.advanceTimersByTimeAsync(1000);
  const count = recentRequests;
  expect(useChartStore.getState().candleRecoveries[`${symbol}:10T`]?.status).toBe("unavailable");
  expect(service.barsFor(symbol, "10T")).toEqual([]);
  await expect(service.history(symbol, "10T")).rejects.toThrow(/not available/);
  await vi.advanceTimersByTimeAsync(7000);
  expect(recentRequests).toBe(count);
});

it("shares concurrent tick history reads and fences a late snapshot from an old socket", async () => {
  let resolveOld!: (response: Response) => void;
  recentResponse = () => new Promise<Response>(resolve => { resolveOld = resolve; });
  const first = service.history(symbol, "10T", 1);
  const second = service.history(symbol, "10T", 4);
  const firstRejected = expect(first).rejects.toThrow(/connection changed/);
  const secondRejected = expect(second).rejects.toThrow(/connection changed/);
  expect(recentRequests).toBe(1);
  await reconnect();
  let resolveNew!: (response: Response) => void;
  recentResponse = () => new Promise<Response>(resolve => { resolveNew = resolve; });
  const next = service.history(symbol, "10T");
  socket().trade(104, base + 121000, 2);
  resolveOld(recent([100, 101, 102]));
  await firstRejected;
  await secondRejected;
  resolveNew(recent([100, 101, 102, 103]));
  expect((await next).at(-1)?.volume).toBe(6);
});

it("uses the trade acknowledgement's candle when a reconnect crosses an interval boundary", async () => {
  const closes = vi.fn(), bars = vi.fn();
  service.onClose((s, tf, bar) => { if (s === symbol && tf === "1m") closes(bar); });
  service.subscribe(symbol, "1m", bars);
  socket().close();
  vi.setSystemTime(base + 57000);
  await vi.advanceTimersByTimeAsync(2000);
  socket().open(false);

  const beforeAck = requests;
  socket().acknowledgeTrade("ETH/USD");
  socket().acknowledgeTrade("BTC/USD", Date.now(), false);
  await flush();
  expect(requests).toBe(beforeAck);
  expect(useChartStore.getState().candleRecoveries[key]?.status).toBe("refreshing");

  // Local receipt is one bucket later than Kraken's acknowledgement timestamp.
  vi.setSystemTime(base + 121000);
  rows = [row(base - 60000), row(base, 20), row(base + 60000)];
  socket().acknowledgeTrade("BTC/USD", base + 61000);
  await flush();
  expect(requests).toBe(beforeAck + 1);
  expect(useChartStore.getState().candleRecoveries[key]?.status).toBe("retrying");
  expect(bars).not.toHaveBeenCalled();

  rows = [row(base - 60000), row(base, 20), row(base + 60000, 30), row(base + 120000)];
  socket().trade(2, base + 121000, 4);
  await vi.advanceTimersByTimeAsync(3000);
  expect(useChartStore.getState().candleRecoveries[key]).not.toBeDefined();
  expect(service.barsFor(symbol, "1m").at(-2)?.volume).toBe(30);
  expect(closes).not.toHaveBeenCalled();
  socket().trade(3, base + 181000);
  expect(closes).toHaveBeenCalledTimes(1);
  expect(closes.mock.calls[0][0].time).toBe(base + 120000);
});

it("repairs interrupted candles, preserves newer trades and never replays historical closes", async () => {
  rows = [row(base - 60000), row(base, 20), row(base + 60000), row(base + 120000)];
  const closes = vi.fn(), bars = vi.fn();
  service.onClose((s, tf, bar) => { if (s === symbol && tf === "1m") closes(bar); });
  service.subscribe(symbol, "1m", bars);
  await reconnect();
  socket().trade(2, base + 121000, 3);
  expect(bars).not.toHaveBeenCalled();
  expect(closes).not.toHaveBeenCalled();
  expect(useChartStore.getState().candleRecoveries[key]?.status).toBe("retrying");

  rows = repairedRows();
  socket().trade(3, base + 181000, 4);
  const ranges: Promise<unknown>[] = [];
  service.subscribe(symbol, "1m", () => {
    ranges.push(Promise.resolve(service.velaFeed.loadRange!({ symbol, timeframe: "1m" }, { from: base })));
  });
  vi.setSystemTime(base + 181000);
  await vi.advanceTimersByTimeAsync(3000);
  const history = await service.history(symbol, "1m");
  expect(history.map(bar => [bar.time, bar.volume])).toEqual([
    [base - 60000, 10], [base, 20], [base + 60000, 30], [base + 120000, 40], [base + 180000, 4],
  ]);
  expect(await ranges[0]).toEqual(history.filter(bar => bar.time >= base));
  expect(useChartStore.getState().candleRecoveries[key]).toBeUndefined();
  expect(closes).not.toHaveBeenCalled();
  socket().trade(4, base + 121000, 100); // Delayed overlap must not alter repaired volume.
  expect((await service.history(symbol, "1m")).find(bar => bar.time === base + 120000)?.volume).toBe(40);
  socket().trade(5, base + 241000);
  expect(closes).toHaveBeenCalledTimes(1);
  expect(closes.mock.calls[0][0].time).toBe(base + 180000);
});

it("does not emit a historical close on the first trade after repair in a quiet market", async () => {
  rows = repairedRows();
  const closes = vi.fn();
  service.onClose((s, tf, bar) => { if (s === symbol && tf === "1m") closes(bar); });
  await reconnect();
  socket().trade(2, base + 181000);
  expect(closes).not.toHaveBeenCalled();
  socket().trade(3, base + 241000);
  expect(closes).toHaveBeenCalledTimes(1);
});

it("drops a locally folded bucket absent from the authoritative closed window", async () => {
  rows = [row(base - 60000), row(base), row(base + 60000), row(base + 120000)];
  const closes = vi.fn();
  const chart = vi.fn();
  const unsubscribe = service.velaFeed.subscribe({ symbol, timeframe: "1m" }, chart);
  service.onClose((s, tf, bar) => { if (s === symbol && tf === "1m") closes(bar); });
  await reconnect();
  socket().trade(2, base + 121000, 3);
  socket().trade(3, base + 241000, 4);
  rows = [row(base - 60000), row(base, 20), row(base + 60000, 30), row(base + 180000, 40), row(base + 240000)];
  vi.setSystemTime(base + 241000);
  await vi.advanceTimersByTimeAsync(3000);
  expect((await service.history(symbol, "1m")).map(bar => [bar.time, bar.volume])).toEqual([
    [base - 60000, 10], [base, 20], [base + 60000, 30], [base + 180000, 40], [base + 240000, 4],
  ]);
  expect(closes).not.toHaveBeenCalled();
  expect(chart).toHaveBeenCalledTimes(1);
  const update = chart.mock.calls[0][0];
  const repair = update[Symbol.for("affentrader.vela.candle-repair")];
  expect(repair.from).toBe(base);
  expect(repair.bars.some((bar: { time: number }) => bar.time === base + 120000)).toBe(false);
  unsubscribe();
});

it("keeps failed repairs pending and retries REST without another trade", async () => {
  response = async () => { throw new Error("offline"); };
  await reconnect();
  const failedRequests = requests;
  expect(useChartStore.getState().candleRecoveries[key]?.status).toBe("retrying");
  response = undefined;
  rows = repairedRows();
  await vi.advanceTimersByTimeAsync(3000);
  expect(requests).toBeGreaterThan(failedRequests);
  expect(useChartStore.getState().candleRecoveries[key]).toBeUndefined();
});

it("withholds incomplete cached bars until the interrupted window is repaired", async () => {
  expect(service.barsFor(symbol, "1m").length).toBeGreaterThan(0);
  response = async () => { throw new Error("offline"); };
  await reconnect();
  socket().trade(2, base + 121000, 3);
  expect(service.barsFor(symbol, "1m")).toEqual([]);

  response = undefined;
  rows = repairedRows();
  await vi.advanceTimersByTimeAsync(3000);
  expect(service.barsFor(symbol, "1m")).toEqual(await service.history(symbol, "1m"));
  expect(service.barsFor(symbol, "1m").find(bar => bar.time === base + 120000)?.volume).toBe(40);
});

it("marks windows outside Kraken retention as unavailable without inventing candles", async () => {
  rows = [row(base + 60000), row(base + 120000), row(base + 180000)];
  await reconnect();
  expect(useChartStore.getState().candleRecoveries[key]?.status).toBe("unavailable");
  const count = requests;
  await vi.advanceTimersByTimeAsync(10000);
  expect(requests).toBe(count);
  await expect(service.history(symbol, "1m")).rejects.toThrow(/not available/);
});

it.each(["stop", "replace"])("ignores a stale REST repair after connection %s", async action => {
  let resolve!: (value: Response) => void;
  response = () => new Promise<Response>(done => { resolve = done; });
  await reconnect();
  const bars = vi.fn();
  service.subscribe(symbol, "1m", bars);
  if (action === "stop") service.stop();
  else socket().close();
  const candles = useChartStore.getState().candles;
  resolve(Response.json({ error: [], result: { BTCUSD: repairedRows() } }));
  await flush();
  expect(bars).not.toHaveBeenCalled();
  expect(useChartStore.getState().candles).toBe(candles);
  if (action === "replace") {
    response = undefined;
    rows = repairedRows();
    await vi.advanceTimersByTimeAsync(4000);
    socket().open();
    await flush();
    expect(useChartStore.getState().candleRecoveries[key]).toBeUndefined();
    expect(bars).toHaveBeenCalled();
  }
});

it("coalesces concurrent history repair requests for a series", async () => {
  let resolve!: (value: Response) => void;
  response = () => new Promise<Response>(done => { resolve = done; });
  await reconnect();
  const count = requests;
  const first = service.history(symbol, "1m"), second = service.history(symbol, "1m");
  expect(requests).toBe(count);
  resolve(Response.json({ error: [], result: { BTCUSD: repairedRows() } }));
  expect(await first).toEqual(await second);
});

it("withholds backward paging across an interrupted window until repair completes", async () => {
  let resolve!: (value: Response) => void;
  response = () => new Promise<Response>(done => { resolve = done; });
  await reconnect();
  socket().trade(2, base + 121000, 3);
  let settled = false;
  const page = service.velaFeed.loadRange!({ symbol, timeframe: "1m" }, { to: base + 120000, limit: 3 });
  const result = Promise.resolve(page).then(bars => { settled = true; return bars; });
  await flush();
  expect(settled).toBe(false);
  resolve(Response.json({ error: [], result: { BTCUSD: repairedRows() } }));
  expect((await result).map(bar => [bar.time, bar.volume])).toEqual([
    [base, 20], [base + 60000, 30], [base + 120000, 40],
  ]);
});

it("serves only the safe prefix when paging before an interrupted window while offline", async () => {
  socket().close();
  expect((await service.history(symbol, "1m", 10, base - 1)).map(bar => bar.time)).toEqual([base - 60000]);
  await expect(service.history(symbol, "1m", 10, base)).rejects.toThrow(/not available/);
});

it.each(["snapshot", "failure"])("rejects an initial history %s from a disconnected socket without exposing partial candles", async outcome => {
  let resolve!: (value: Response) => void, reject!: (error: Error) => void;
  response = () => new Promise<Response>((done, fail) => { resolve = done; reject = fail; });
  service.subscribe(symbol, "5m", () => {});
  const history = service.history(symbol, "5m");
  const rejected = expect(history).rejects.toThrow(/connection changed/);
  socket().close();
  if (outcome === "snapshot") resolve(Response.json({ error: [], result: { BTCUSD: [row(base - 300000), row(base)] } }));
  else reject(new Error("offline"));
  await rejected;
  expect(service.barsFor(symbol, "5m")).toEqual([]);
  expect(useChartStore.getState().candleRecoveries[`${symbol}:5m`]?.status).toBe("refreshing");
});

it("suppresses partial closes on unrequested intervals after reconnect", async () => {
  const closes = vi.fn();
  service.onClose((s, tf, bar) => { if (s === symbol && tf === "5m") closes(bar); });
  rows = repairedRows();
  await reconnect();
  socket().trade(2, base + 301000);
  expect(closes).not.toHaveBeenCalled();
  socket().trade(3, base + 601000);
  expect(closes).toHaveBeenCalledTimes(1);
  expect(closes.mock.calls[0][0].time).toBe(base + 300000);
});

it("reports an unsupported seconds interval instead of endlessly polling REST", async () => {
  service.subscribe(symbol, "1s", () => {});
  rows = repairedRows();
  await reconnect();
  expect(useChartStore.getState().candleRecoveries[`${symbol}:1s`]?.status).toBe("unavailable");
});

it.each(["resolve", "reject"])("keeps a newer repair active when an obsolete request settles via %s", async outcome => {
  let resolveOld!: (value: Response) => void, rejectOld!: (error: Error) => void;
  response = () => new Promise<Response>((done, fail) => { resolveOld = done; rejectOld = fail; });
  await reconnect();
  socket().close();
  let resolveNew!: (value: Response) => void;
  response = () => new Promise<Response>(done => { resolveNew = done; });
  await vi.advanceTimersByTimeAsync(4000);
  socket().open();
  await flush();
  const requestCount = requests;
  const history = service.history(symbol, "1m");
  const closes = vi.fn();
  service.onClose(closes);

  if (outcome === "resolve") resolveOld(Response.json({ error: [], result: { BTCUSD: repairedRows() } }));
  else rejectOld(new Error("obsolete connection failed"));
  await flush();
  expect(service.barsFor(symbol, "1m")).toEqual([]);
  expect(useChartStore.getState().candleRecoveries[key]?.status).toBe("loading");
  await vi.advanceTimersByTimeAsync(1000);
  expect(requests).toBe(requestCount);

  resolveNew(Response.json({ error: [], result: { BTCUSD: repairedRows() } }));
  expect((await history).find(bar => bar.time === base)?.volume).toBe(20);
  expect(useChartStore.getState().candleRecoveries[key]).toBeUndefined();
  expect(closes).not.toHaveBeenCalled();
});

it("repairs Monday-aligned weekly candles from daily history without historical close alarms", async () => {
  const monday = Date.UTC(2026, 9, 19), day = 86400000, weeklyKey = `${symbol}:1W`;
  const dailyRows = (length: number) => Array.from({ length }, (_, i) => row(monday + i * day, 2));
  rows = dailyRows(17); // The final row is the still-open November 4 daily candle.
  service.subscribe(symbol, "1W", () => {});
  await service.history(symbol, "1W");
  const closes = vi.fn();
  service.onClose((s, tf, bar) => { if (s === symbol && tf === "1W") closes(bar); });
  await reconnect();
  expect(useChartStore.getState().candleRecoveries[weeklyKey]?.status).toBe("retrying");
  expect(service.barsFor(symbol, "1W")).toEqual([]);

  rows = dailyRows(22); // November 9 is open; November 2's week is now closed.
  vi.setSystemTime(monday + 21 * day);
  await vi.advanceTimersByTimeAsync(3000);
  expect((await service.history(symbol, "1W")).map(bar => [bar.time, bar.volume])).toEqual([
    [monday, 14], [monday + 7 * day, 14], [monday + 14 * day, 14],
  ]);
  expect(useChartStore.getState().candleRecoveries[weeklyKey]).toBeUndefined();
  socket().trade(2, monday + 21 * day + 4000);
  expect(closes).not.toHaveBeenCalled();
});
