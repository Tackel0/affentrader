import { describe, expect, it } from "vitest";
import type { NativeIndicatorContext, NativeIndicatorOutput } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { CvdAccumulator } from "@/lib/orderflow/cvdModel";
import { DeltaPath } from "@/lib/orderflow/deltaPath";
import { cvdDescriptor } from "@/lib/orderflow/cvdIndicator";
import { defaultCvd as velaCvdDefaults, resolveCvd, cvdInputs } from "@/lib/orderflow/cvdSettings";
const defaultCvd = () => ({ ...velaCvdDefaults(), anchor: "Session" as const });
const minute = 60000;
const trade = (id: string, time: number, signed: number, seq?: number): Tick =>
  ({ id, symbol: "BTCUSDT", time, quantity: Math.abs(signed), side: signed > 0 ? "buy" : "sell", price: 100, simulated: false, seq });
const slots = (...times: number[]) => times.map(time => ({ time }));
function reference(trades: Tick[]) {
  let total = 0, high = 0, low = 0, volume = 0;
  for (const t of [...trades].sort((a, b) => a.time - b.time || (a.seq ?? Number.MAX_VALUE) - (b.seq ?? Number.MAX_VALUE) || (a.id < b.id ? -1 : 1))) {
    total += t.side === "buy" ? t.quantity : -t.quantity; high = Math.max(high, total); low = Math.min(low, total); volume += t.quantity;
  }
  return { total, high, low, volume };
}
describe("ordered execution CVD candles", () => {
  it("retains intrabar excursions even when their net delta cancels", () => {
    const model = new CvdAccumulator("1m", defaultCvd(), "BTCUSDT");
    model.add([trade("a", 1, 5), trade("b", 2, -8), trade("c", 3, 2), trade("d", minute + 1, -1), trade("e", minute + 2, 10)]);
    expect(model.candles(slots(0, minute), "Cumulative delta")).toEqual([
      { time: 0, open: 0, high: 5, low: -3, close: -1, volume: 15 },
      { time: minute, open: -1, high: 8, low: -2, close: 8, volume: 11 },
    ]);
    expect(model.candles(slots(minute), "Bar delta")[0]).toEqual({ time: minute, open: 0, high: 9, low: -1, close: 9, volume: 11 });
  });
  it("corrects old extrema and all later cumulative opens after an out-of-order insertion", () => {
    const model = new CvdAccumulator("1m", defaultCvd(), "BTCUSDT");
    model.add([trade("a", 20, 5), trade("b", 30, -8), trade("next", minute + 1, 2)]);
    model.add([trade("late", 10, -10)]);
    expect(model.candles(slots(0, minute), "Cumulative delta")).toEqual([
      { time: 0, open: 0, high: 0, low: -13, close: -13, volume: 23 },
      { time: minute, open: -13, high: -11, low: -13, close: -11, volume: 2 },
    ]);
  });
  it("orders same-millisecond executions by venue sequence and uses a deterministic ID fallback", () => {
    const path = new DeltaPath(); path.add(trade("z", 1, 5, 1)); path.add(trade("a", 1, -8, 2));
    expect(path.read()).toEqual({ total: -3, high: 5, low: -3, volume: 13 });
    const reverse = new DeltaPath(); reverse.add(trade("a", 1, -8, 2)); reverse.add(trade("z", 1, 5, 1));
    expect(reverse.read()).toEqual(path.read());
    const fallback = new DeltaPath(); fallback.add(trade("z", 1, 5)); fallback.add(trade("a", 1, -8));
    expect(fallback.read()).toEqual({ total: -3, high: 0, low: -8, volume: 13 });
  });
  it("keeps a transitive total order when sequenced and unsequenced trades share a timestamp", () => {
    const source = [trade("z", 1, 5, 1), trade("m", 1, -8), trade("a", 1, 2, 2)];
    const orders = [source, [...source].reverse(), [source[1], source[0], source[2]]];
    for (const order of orders) { const path = new DeltaPath(); order.forEach(t => path.add(t)); expect(path.read()).toEqual(reference(source)); }
  });
  it("preserves prefix extrema through ID compaction and a later insertion into the unsealed suffix", () => {
    const model = new CvdAccumulator("1m", defaultCvd(), "BTCUSDT", { ids: 4, buckets: 10 });
    const source = [5, -8, 2, 7, -9, 3, -1, 8, -2, 4].map((signed, index) => trade(String(index), index, signed));
    for (const t of source) model.add([t]);
    const late = trade("late", 7.5, -11); model.add([late]); model.add([source[0], source[9]]);
    const expected = reference([...source, late]), candle = model.candles(slots(0), "Cumulative delta")[0];
    expect(candle).toEqual({ time: 0, open: 0, high: expected.high, low: expected.low, close: expected.total, volume: expected.volume });
    expect(model.coverage.trades).toBe(11); expect(model.coverage.rejected).toBe(1);
  });
  it("matches an independently sorted path under thousands of disordered arrivals", () => {
    const source = Array.from({ length: 4000 }, (_, index) => trade(String(index), index * 5, index % 3 === 0 ? -7 : 3, index));
    let seed = 3917;
    for (let index = source.length - 1; index > 0; index--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const other = seed % (index + 1);
      [source[index], source[other]] = [source[other], source[index]];
    }
    const path = new DeltaPath(), received: Tick[] = [];
    source.forEach((t, index) => { path.add(t); received.push(t); if (index % 233 === 0) expect(path.read()).toEqual(reference(received)); });
    expect(path.read()).toEqual(reference(source)); path.sealBefore(13000); expect(path.read()).toEqual(reference(source));
    const late = trade("late", 14000.5, -20); path.add(late); expect(path.read()).toEqual(reference([...source, late]));
    expect(() => path.add(trade("expired", 1, 2))).toThrow(/sealed timestamp/);
  });
  it("inserts a late trade before a compaction that advances beyond that same trade", () => {
    const model = new CvdAccumulator("1m", defaultCvd(), "BTCUSDT", { ids: 4, buckets: 10 });
    const source = [trade("a", 0, 5), trade("b", 100, -8), trade("c", 200, 3), trade("d", 300, 1)];
    model.add(source); const late = trade("late", 50, -10); model.add([late]);
    const expected = reference([...source, late]);
    expect(model.candles(slots(0), "Cumulative delta")[0]).toEqual({ time: 0, open: 0, high: expected.high, low: expected.low, close: expected.total, volume: expected.volume });
    model.add([late]); expect(model.coverage.trades).toBe(5); expect(model.coverage.rejected).toBe(1);
  });
  it("balances sorted insertion and deletion without losing zero-delta wick extremes", () => {
    const path = new DeltaPath();
    for (let index = 0; index < 12000; index++) path.add(trade(String(index), index, index % 2 ? -1 : 1));
    expect(path.read()).toEqual({ total: 0, high: 1, low: 0, volume: 12000 });
    path.sealBefore(12001); expect(path.read()).toEqual({ total: 0, high: 1, low: 0, volume: 12000 });
    path.add(trade("new", 13000, -3)); expect(path.read()).toEqual({ total: -3, high: 1, low: -3, volume: 12003 });
  });
  it("keeps unavailable slots aligned and carries quiet-bar OHLC only inside an observed session", () => {
    const model = new CvdAccumulator("1m", defaultCvd(), "BTCUSDT"); model.add([trade("a", minute + 2, -4)]);
    const candles = model.candles(slots(0, minute, 2 * minute, 86400000), "Cumulative delta");
    expect(Number.isNaN(candles[0].open)).toBe(true); expect(Number.isNaN(candles[3].close)).toBe(true);
    expect(candles[2]).toEqual({ time: 2 * minute, open: -4, high: -4, low: -4, close: -4, volume: 0 });
    expect(model.candles(slots(2 * minute), "Bar delta")[0]).toEqual({ time: 2 * minute, open: 0, high: 0, low: 0, close: 0, volume: 0 });
  });
  it("resets candle open and wick path at a session boundary inside the same chart bar", () => {
    const model = new CvdAccumulator("1h", { ...defaultCvd(), sessionStartMinutes: 570 }, "BTCUSDT");
    model.add([trade("before", 9 * 3600000 + 10 * minute, 50), trade("after", 9 * 3600000 + 40 * minute, -2)]);
    expect(model.candles(slots(9 * 3600000), "Cumulative delta")[0]).toEqual({ time: 9 * 3600000, open: 0, high: 0, low: -2, close: -2, volume: 2 });
  });
  it("validates six independent candle colors and preserves legacy line preferences", () => {
    const legacy = resolveCvd({ plot: "Line", color: "#123456" }); expect(legacy.upColor).toBe("#089981");
    expect(resolveCvd({ plot: "Candles", upColor: "#112233", wickDownColor: "#445566" }).wickDownColor).toBe("#445566");
    expect(() => resolveCvd({ upColor: "bad" })).toThrow();
    expect(cvdInputs().find(input => input.key === "plot")!.options).toContain("Candles");
  });
  it("does not require a representable session total when only independent per-bar delta is requested", () => {
    const model = new CvdAccumulator("1m", defaultCvd(), "BTCUSDT");
    model.add([trade("a", 1, Number.MAX_VALUE), trade("b", minute + 1, Number.MAX_VALUE)]);
    expect(model.candles(slots(0, minute), "Bar delta").map(bar => bar.close)).toEqual([Number.MAX_VALUE, Number.MAX_VALUE]);
    expect(() => model.candles(slots(0, minute), "Cumulative delta")).toThrow(/precision/);
  });
  it("emits real native CandleSeries slots and switches back to line without discarding the ordered path", () => {
    let output: NativeIndicatorOutput = {};
    const source = [trade("a", 1, 5), trade("b", 2, -8)];
    const native = cvdDescriptor(() => source, () => () => {}).create();
    const context = { symbol: "BTCUSDT", timeframe: "1m", live: true, bars: () => slots(0, minute),
      emit: (next: NativeIndicatorOutput) => { output = next; }, pushData() {}, setStatus() {} } as unknown as NativeIndicatorContext;
    native.start(context, { anchor: "Session", plot: "Candles", upColor: "#123456" });
    const candle = output.series![0]; if (!("bars" in candle)) throw new Error("Expected native candle series");
    expect(candle.kind).toBe("candle"); expect(candle.bars[0]).toEqual({ time: 0, open: 0, high: 5, low: -3, close: -3, volume: 13 });
    expect(output.series).toHaveLength(5); expect(candle.display).toEqual({ dataWindow: false });
    expect(output.series!.slice(1).map(series => series.title)).toEqual(["CVD Open", "CVD High", "CVD Low", "CVD Close"]);
    for (const series of output.series!.slice(1)) expect(series.display).toEqual({ pane: false, priceScale: false, legend: false, dataWindow: true });
    expect(candle.style?.up).toBe("#123456"); native.setInputs({ anchor: "Session", plot: "Line" });
    const line = output.series![0]; if (!("points" in line)) throw new Error("Expected native line series");
    expect(line.points.map(point => point.value)).toEqual([-3, -3]); native.stop();
  });
});
