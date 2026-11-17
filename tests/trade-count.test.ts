import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, NativeIndicatorOutput } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { aggregateTradeCount } from "@/lib/market/tradeCounts";
import { parseKrakenTrade } from "@/lib/market/kraken";
import { parseTrade } from "@/lib/market/hyperliquid";
import { MarketService } from "@/lib/market/service";
import { TradeArchiveDb, archiveCsv, isArchivableTrade } from "@/lib/orderflow/tradeArchive";
import { StudyTradeSource } from "@/lib/orderflow/studyTradeSource";
import { TradeCountAccumulator, countInputs, countSeries, defaultCount, emptyCountSeries, resolveCount, type CountKind } from "@/lib/orderflow/tradeCount";
import { tradeCountDescriptor } from "@/lib/orderflow/tradeCountIndicator";
const minute = 60000, day = 86400000;
const tick = (id: string, time: number, tradeCount: number | undefined = 1, side: Tick["side"] = "buy", quantity = 1): Tick =>
  ({ id, symbol: "BTCUSDT", time, price: 100, quantity, side, simulated: false, tradeCount });
const bars = (...times: number[]) => times.map(time => ({ time, open: 100, high: 101, low: 99, close: 100, volume: 1000 }));
const closes = (model: TradeCountAccumulator, times: number[], kind: CountKind = "cumulative") => model.candles(bars(...times), kind).map(bar => Number.isFinite(bar.close) ? bar.close : null);
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("decodes inclusive Binance ID spans without fabricating counts from missing/imprecise IDs", () => {
  expect(aggregateTradeCount(100, 105)).toBe(6); expect(aggregateTradeCount(0, 0)).toBe(1);
  for (const [first, last] of [[undefined, undefined], ["1", "3"], [-1, 4], [3, 2], [1.2, 3], [0, Number.MAX_SAFE_INTEGER], [1, Infinity]])
    expect(aggregateTradeCount(first, last)).toBeUndefined();
});
it("counts underlying prints independently of traded quantity and keeps ordered count wicks", () => {
  const model = new TradeCountAccumulator("BTCUSDT", "1m", "All data");
  model.add([tick("c", 3000, 1), tick("a", 1000, 4, "buy", .001), tick("b", 2000, 2, "sell", 999), tick("d", minute + 1, 5, "sell")]);
  model.add([tick("a", 1000, 4, "buy", .001)]);
  expect(closes(model, [-minute, 0, minute, 2 * minute], "total")).toEqual([null, 7, 5, null]);
  expect(closes(model, [0, minute], "delta")).toEqual([3, -5]);
  expect(model.candles(bars(0, minute), "cumulative")).toEqual([
    { time: 0, open: 0, high: 4, low: 0, close: 3, volume: 7 },
    { time: minute, open: 3, high: 3, low: -2, close: -2, volume: 5 },
  ]);
  expect(model.coverage.observations).toBe(4);
});
it.each([
  ["Day", "2026-11-01T23:59:00Z", "2026-11-02T00:00:00Z"],
  ["Week", "2026-11-01T23:59:00Z", "2026-11-02T00:00:00Z"],
  ["Month", "2026-10-31T23:59:00Z", "2026-11-01T00:00:00Z"],
] as const)("resets %s on the exact UTC boundary", (anchor, first, next) => {
  const from = Date.parse(first), to = Date.parse(next), source = [tick("a", from, 4), tick("b", to, 2, "sell")];
  const model = new TradeCountAccumulator("BTCUSDT", "1m", anchor); model.add(source);
  expect(closes(model, [from, to])).toEqual([4, -2]);
  const all = new TradeCountAccumulator("BTCUSDT", "1m", "All data"); all.add(source);
  expect(closes(all, [from, to])).toEqual([4, 2]);
});
it("leaves absent/count-less buckets empty and invalidates an unknown cumulative anchor until reset", () => {
  const model = new TradeCountAccumulator("BTCUSDT", "1m", "Day");
  model.add([tick("a", 1000, 4), { ...tick("legacy", minute + 1), tradeCount: undefined }, tick("next", 2 * minute + 1, 2), tick("reset", day + 1, 3)]);
  expect(closes(model, [0, minute, 2 * minute, 3 * minute, day])).toEqual([4, null, null, null, 3]);
  expect(closes(model, [0, minute, 2 * minute, 3 * minute, day], "total")).toEqual([4, null, 2, null, 3]);
  expect(model.coverage.unknown).toBe(1);
});
it("retains zero for a real balanced bucket and rejects count-ID conflicts", () => {
  const model = new TradeCountAccumulator("BTCUSDT", "1m", "All data");
  model.add([tick("a", 1, 2), tick("b", 2, 2, "sell")]);
  expect(closes(model, [0], "delta")).toEqual([0]);
  expect(() => model.add([tick("a", 1, 3)])).toThrow(/Conflicting/);
});
it("preserves integer totals/path extrema through ID compaction and rejects older expired IDs", () => {
  const model = new TradeCountAccumulator("BTCUSDT", "1m", "All data", { ids: 4, buckets: 20 });
  for (let i = 0; i < 12; i++) model.add([tick(String(i), i * 1000, 2, i % 2 ? "sell" : "buy")]);
  model.add([tick("0", 0, 2)]);
  expect(model.candles(bars(0), "cumulative")[0]).toMatchObject({ open: 0, high: 2, low: 0, close: 0, volume: 24 });
  expect(model.coverage.rejected).toBe(1);
  const burst = new TradeCountAccumulator("BTCUSDT", "1m", "All data", { ids: 2, buckets: 20 });
  expect(() => burst.add([tick("a", 0), tick("b", 0), tick("c", 0)])).toThrow(/duplicate tracking/);
});
it("rejects unsupported chart intervals, bucket capacity and unsafe integer totals", () => {
  for (const interval of ["1M", "100T", "bad"]) expect(() => new TradeCountAccumulator("BTCUSDT", interval, "Day")).toThrow(/fixed-duration/);
  const model = new TradeCountAccumulator("BTCUSDT", "1m", "All data", { ids: 20, buckets: 1 });
  expect(() => model.add([tick("a", 0), tick("b", minute)])).toThrow(/20,000 buckets/);
  const huge = new TradeCountAccumulator("BTCUSDT", "1m", "All data");
  huge.add([tick("a", 0, Number.MAX_SAFE_INTEGER), tick("b", 1)]);
  expect(() => huge.candles(bars(0), "total")).toThrow(/safe integer/);
});
it("isolates wrong markets, invalid trades, simulation switches and old real deliveries", () => {
  const model = new TradeCountAccumulator("BTCUSDT", "1m", "All data");
  model.add([tick("real", 1, 2), { ...tick("wrong", 2, 100), symbol: "ETHUSDT" }, tick("bad", 3, 4, "buy", NaN)]);
  expect(closes(model, [0], "total")).toEqual([2]);
  model.add([{ ...tick("sim", minute, 3), simulated: true }, tick("stale-real", 4, 200)]);
  expect(closes(model, [0, minute], "total")).toEqual([null, 3]);
  expect(model.coverage.simulated).toBe(true);
});
it("uses per-point delta colors, count candles/readout fields and native Area/Line output", () => {
  const model = new TradeCountAccumulator("BTCUSDT", "1m", "All data"); model.add([tick("b", 1, 2, "sell"), tick("a", minute, 4)]);
  const style = defaultCount(), values = model.candles(bars(0, minute, 2 * minute), "delta");
  const series = countSeries(values, "delta", style)[0];
  expect(series.kind).toBe("histogram");
  if (!("points" in series)) throw new Error("Missing histogram");
  expect(series.points.map(point => [point.value, point.color])).toEqual([[-2, style.downColor], [4, style.upColor], [null, style.downColor]]);
  expect(countSeries(values, "cumulative", style).map(s => s.id)).toEqual(["af-ctcd", "af-ctcd-open", "af-ctcd-high", "af-ctcd-low", "af-ctcd-close"]);
  expect(countSeries(values, "cumulative", { ...style, plot: "Area" })[0].kind).toBe("area");
  expect(countSeries(values, "cumulative", { ...style, plot: "Line" })[0].kind).toBe("line");
  const empty = emptyCountSeries(bars(0), "cumulative", style);
  expect("bars" in empty[0] && Number.isNaN(empty[0].bars[0].close)).toBe(true);
  expect(countInputs("total").map(input => input.key)).toEqual(["color"]);
  expect(countInputs("delta").map(input => input.key)).toEqual(["upColor", "downColor"]);
  expect(resolveCount({ ...style })).toEqual(style);
  expect(countSeries(values, "cumulative", { ...style, plot: "Line", lineWidth: 5 })[0]).toMatchObject({ style: { width: 5 } });
  expect(() => resolveCount({ lineWidth: 0 })).toThrow();
  expect(() => resolveCount({ anchor: "Local day" })).toThrow(); expect(() => resolveCount({ plot: "Histogram" })).toThrow();
  expect(() => resolveCount({ anchor: ["Day"] })).toThrow(/UTC trade-count anchor/);
  expect(() => resolveCount({ plot: ["Candles"] })).toThrow(/Choose Candles/);
});

function harness(kind: CountKind = "cumulative", live = true) {
  let trades = [tick("seed", 1000, 2)], through = minute, revision = 0, data: { message: string } | null = null;
  let callback: ((tick: Tick) => void) | undefined, archiveCallback: (() => void) | undefined;
  const outputs: NativeIndicatorOutput[] = [], off = vi.fn(), archiveOff = vi.fn();
  const instance = tradeCountDescriptor(kind, () => trades, (_symbol, changed) => { callback = changed; return off; }, {
    revision: () => revision, subscribe: (_symbol, changed) => { archiveCallback = changed; return archiveOff; },
    replay: () => ({ trades: trades.filter(tick => tick.time < through), through, label: "REPLAY observed only" }),
  }).create();
  const context = { symbol: "BTCUSDT", timeframe: "1m", live, bars: () => bars(0, minute, 2 * minute),
    emit: (output: NativeIndicatorOutput) => outputs.push(output), pushData: (value: { message: string } | null) => { data = value; }, setStatus() {} } as unknown as NativeIndicatorContext;
  instance.start(context, {});
  return { instance, context, outputs, off, archiveOff, data: () => data, send: (tick: Tick) => callback!(tick),
    replace(next: Tick[]) { trades = next; revision++; archiveCallback?.(); }, seek(time: number) { through = time; instance.onBars(); } };
}
const lastClose = (output: NativeIndicatorOutput) => {
  const first = output.series![0]; return "bars" in first ? first.bars.map(bar => Number.isNaN(bar.close) ? null : bar.close) : "points" in first ? first.points.map(point => point.value) : [];
};
it("preserves live history on style edits and fences pending callbacks on suspend/stop", async () => {
  vi.useFakeTimers(); const h = harness();
  h.send(tick("sell", 2000, 3, "sell")); await vi.advanceTimersByTimeAsync(50);
  expect(lastClose(h.outputs.at(-1)!)).toEqual([-1, null, null]);
  h.instance.setInputs({ plot: "Area" }); expect(lastClose(h.outputs.at(-1)!)).toEqual([-1, null, null]);
  h.send(tick("pending", 3000, 2)); h.instance.suspend(); const count = h.outputs.length;
  await vi.advanceTimersByTimeAsync(100); h.send(tick("stale", 4000, 50)); expect(h.outputs).toHaveLength(count);
  h.instance.resume(); expect(lastClose(h.outputs.at(-1)!)).toEqual([2, null, null]);
  h.instance.stop(); expect(h.data()).toBeNull(); expect(h.off).toHaveBeenCalledTimes(2); expect(h.archiveOff).toHaveBeenCalledTimes(2);
});
it("rebuilds archive-only Replay on backward seeks and clears old count candles on source removal", () => {
  const h = harness("cumulative", false);
  h.replace([tick("a", 1000, 4), tick("b", minute + 1, 2, "sell")]);
  expect(lastClose(h.outputs.at(-1)!)).toEqual([4, null, null]);
  h.seek(2 * minute); expect(lastClose(h.outputs.at(-1)!)).toEqual([4, 2, null]);
  h.seek(minute); expect(lastClose(h.outputs.at(-1)!)).toEqual([4, null, null]);
  h.replace([]); expect(lastClose(h.outputs.at(-1)!)).toEqual([null, null, null]);
  expect(h.off).not.toHaveBeenCalled(); expect(h.data()?.message).toContain("REPLAY"); h.instance.stop();
});
it("clears prior plots for invalid settings/intervals and missing Replay sources", () => {
  const h = harness(); h.instance.setInputs({ anchor: "bad" });
  expect(lastClose(h.outputs.at(-1)!)).toEqual([null, null, null]);
  expect(h.data()?.message).toMatch(/unavailable/);
  h.instance.setInputs({ anchor: "Week" }); expect(lastClose(h.outputs.at(-1)!)).toEqual([2, null, null]);
  const instance = tradeCountDescriptor("total", () => [], () => () => {}).create();
  instance.start({ ...h.context, live: false }, {}); expect(lastClose(h.outputs.at(-1)!)).toEqual([null, null, null]);
  instance.stop(); h.instance.stop();
});
it("passes verified Binance spans through the actual service tick path", () => {
  class Socket {
    static OPEN = 1; static all: Socket[] = [];
    onmessage?: (event: { data: string }) => void;
    constructor(readonly url: string) { Socket.all.push(this); }
    close() {}
  }
  vi.stubGlobal("WebSocket", Socket); vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
  const service = new MarketService(), received: Tick[] = []; service.onTick(tick => received.push(tick));
  try {
    service.start(["BTCUSDT"], "auto");
    const socket = Socket.all.find(socket => socket.url.includes("binance"))!;
    const send = (a: number, f?: number, l?: number) => socket.onmessage!({ data: JSON.stringify({ stream: "btcusdt@aggTrade", data: {
      e: "aggTrade", s: "BTCUSDT", a, T: Date.now(), p: "100", q: "3", m: false, f, l,
    } }) });
    send(1, 10, 14); send(2); expect(received.map(tick => tick.tradeCount)).toEqual([5, undefined]);
  } finally { service.stop(); }
});
it("persists real Kraken print counts through recording, reload, study hydration and Replay", async () => {
  const time = Date.UTC(2026, 10, 4, 12), kraken = parseKrakenTrade({ symbol: "BTC/USD", side: "buy", price: 100, qty: 2, trade_id: 7, timestamp: new Date(time).toISOString() })!;
  expect(kraken.tradeCount).toBe(1); expect(isArchivableTrade(kraken)).toBe(true);
  expect(parseTrade({ coin: "BTC", side: "B", px: "100", sz: "2", time, tid: 7 })?.tradeCount).toBe(1);
  const name = `counts-${crypto.randomUUID()}`, db = new TradeArchiveDb(name, 20, 7 * day, () => time + minute);
  await db.append([kraken]); await db.close();
  const reopened = new TradeArchiveDb(name, 20, 7 * day, () => time + minute);
  try {
    const snapshot = await reopened.read({ symbol: kraken.symbol, from: time, to: time + minute });
    expect(snapshot.trades[0].tradeCount).toBe(1); expect(archiveCsv(snapshot)).toContain("trade_count");
    const source = new StudyTradeSource(); source.install(snapshot);
    const prefix = source.replay(kraken.symbol, time + minute)!;
    const model = new TradeCountAccumulator(kraken.symbol, "1m", "Day"); model.add(prefix.trades);
    expect(closes(model, [time], "total")).toEqual([1]);
    await expect(reopened.append([{ ...kraken, tradeCount: 2 }])).rejects.toThrow(/Conflicting/);
    expect(isArchivableTrade({ ...kraken, tradeCount: 0 })).toBe(false);
  } finally { await reopened.close(); }
});
