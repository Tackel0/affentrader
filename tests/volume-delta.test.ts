import { afterEach, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, NativeIndicatorOutput } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { AverageDeltaPath } from "@/lib/orderflow/averageDeltaPath";
import { CvdAccumulator } from "@/lib/orderflow/cvdModel";
import { cvdDescriptor } from "@/lib/orderflow/cvdIndicator";
import { cvdSeries } from "@/lib/orderflow/cvdOutput";
import { defaultCvd, resolveCvd, cvdClockKey } from "@/lib/orderflow/cvdSettings";
import { studyArguments } from "@/lib/chart/statusLine";

const minute = 60000, day = 86400000, symbol = "BTCUSDT";
const tick = (id: string, time: number, quantity: number, side: Tick["side"] = "buy", tradeCount: number | undefined = 1): Tick =>
  ({ id, symbol, time, quantity, side, tradeCount, price: 100, simulated: false });
const bars = (...times: number[]) => times.map(time => ({ time, open: 100, high: 101, low: 99, close: 100, volume: 100 }));
const closes = (model: CvdAccumulator, times: number[], calculation: "Cumulative delta" | "Bar delta" = "Cumulative delta", mode: "Total" | "Average" = "Average") =>
  model.candles(bars(...times), calculation, mode).map(bar => Number.isFinite(bar.close) ? bar.close : null);
afterEach(() => vi.useRealTimers());

it("uses Vela Month/Candles/Total defaults and preserves explicit legacy styles", () => {
  expect(defaultCvd()).toMatchObject({ anchor: "Month", plot: "Candles", mode: "Total" });
  expect(resolveCvd({ anchor: "Session", plot: "Line" })).toMatchObject({ anchor: "Session", plot: "Line" });
  expect(resolveCvd({ plot: "Area", mode: "Average" })).toMatchObject({ plot: "Area", mode: "Average" });
  for (const input of [{ mode: "guess" }, { mode: 1 }, { anchor: "local day" }, { plot: "unknown" }]) expect(() => resolveCvd(input)).toThrow();
  expect(studyArguments({ mode: "Average", anchor: "Week" }, "cvd")).toBe("Week UTC · Average");
  expect(studyArguments({ mode: "Average" }, "volume-delta")).toBe("Average");
  expect(cvdClockKey(resolveCvd({ mode: "Average", plot: "Area" }))).toBe(cvdClockKey(defaultCvd()));
});

it.each([
  ["Day", "2026-11-01T23:59:00Z", "2026-11-02T00:00:00Z"],
  ["Week", "2026-11-01T23:59:00Z", "2026-11-02T00:00:00Z"],
  ["Month", "2026-10-31T23:59:00Z", "2026-11-01T00:00:00Z"],
] as const)("resets %s at its UTC boundary for both modes independent of session controls", (anchor, first, next) => {
  const from = Date.parse(first), to = Date.parse(next);
  const source = [tick("a", from, 8, "buy", 2), tick("b", to, 6, "sell", 3)];
  const model = new CvdAccumulator("1m", resolveCvd({ anchor, sessionZone: "America/New_York", sessionStartMinutes: 570 }), symbol);
  const all = new CvdAccumulator("1m", resolveCvd({ anchor: "All data" }), symbol);
  model.add(source); all.add(source);
  expect(closes(model, [from, to])).toEqual([4, -2]);
  expect(closes(model, [from, to], "Cumulative delta", "Total")).toEqual([8, -6]);
  expect(closes(all, [from, to])).toEqual([4, 2]);
});

it("computes per-side means, ordered observed-prefix extrema and cumulative per-bar sums", () => {
  const model = new CvdAccumulator("1m", defaultCvd(), symbol);
  model.add([tick("c", 3, 1), tick("a", 1, 20, "buy", 4), tick("b", 2, 8, "sell", 2), tick("d", minute + 1, 6, "sell", 3)]);
  const output = model.candles(bars(0, minute), "Cumulative delta", "Average");
  expect(output[0]).toMatchObject({ open: 0, high: 5, low: 0, volume: 29 });
  expect(output[0].close).toBeCloseTo(.2); expect(output[1].open).toBeCloseTo(.2);
  expect(output[1].high).toBeCloseTo(.2); expect(output[1].low).toBeCloseTo(-1.8); expect(output[1].close).toBeCloseTo(-1.8);
  expect(closes(model, [0, minute], "Bar delta", "Total")).toEqual([13, -6]);
  expect(closes(model, [minute], "Bar delta")).toEqual([-2]);
  expect(model.coverage).toMatchObject({ trades: 4, unknownCounts: 0, aggregates: 3 });
});

it("gaps unknown counts and cumulative remainder until reset while Total remains available", () => {
  const model = new CvdAccumulator("1m", resolveCvd({ anchor: "Day" }), symbol);
  model.add([tick("known", 1, 4, "buy", 2), { ...tick("unknown", minute + 1, 5), tradeCount: undefined },
    tick("later", 2 * minute + 1, 6, "sell", 3), tick("reset", day + 1, 8, "buy", 2)]);
  const slots = [0, minute, 2 * minute, 3 * minute, day];
  expect(closes(model, slots)).toEqual([2, null, null, null, 4]);
  expect(closes(model, slots, "Bar delta")).toEqual([2, null, -2, null, 4]);
  expect(closes(model, slots, "Cumulative delta", "Total")).toEqual([4, 9, 3, null, 8]);
  expect(model.coverage.unknownCounts).toBe(1);
});

it("preserves real balanced zero and never fills unobserved UTC buckets", () => {
  const model = new CvdAccumulator("1m", defaultCvd(), symbol);
  model.add([tick("buy", minute + 1, 8, "buy", 4), tick("sell", minute + 2, 6, "sell", 3)]);
  expect(closes(model, [0, minute, 2 * minute])).toEqual([null, 0, null]);
});

it("gaps unsafe summed print counts without corrupting quantity delta", () => {
  const model = new CvdAccumulator("1m", defaultCvd(), symbol);
  model.add([tick("huge", 1, 2, "buy", Number.MAX_SAFE_INTEGER), tick("next", 2, 3)]);
  expect(closes(model, [0])).toEqual([null]);
  expect(closes(model, [0], "Bar delta", "Total")).toEqual([5]);
});

function independentPath(source: Tick[]) {
  let buy = 0, sell = 0, buys = 0, sells = 0, high = 0, low = 0, total = 0;
  for (const t of [...source].sort((a, b) => a.time - b.time || (a.seq ?? Number.MAX_VALUE) - (b.seq ?? Number.MAX_VALUE) || a.id.localeCompare(b.id))) {
    if (t.side === "buy") { buy += t.quantity; buys += t.tradeCount!; } else { sell += t.quantity; sells += t.tradeCount!; }
    total = (buys ? buy / buys : 0) - (sells ? sell / sells : 0); high = Math.max(high, total); low = Math.min(low, total);
  }
  return { total, high, low, volume: buy + sell, known: true };
}

it("corrects same-time sequence paths and retains prefix means/extrema after sealing", () => {
  const source = [tick("z", 1, 10, "buy", 2), tick("a", 1, 12, "sell", 3), tick("m", 2, 2, "buy", 2)];
  source[0].seq = 1; source[1].seq = 2;
  const path = new AverageDeltaPath(); [...source].reverse().forEach(t => path.add(t));
  expect(path.read()).toEqual(independentPath(source)); path.sealBefore(2);
  const late = tick("late", 2, 20, "sell", 1); late.seq = 1; path.add(late);
  expect(path.read()).toEqual(independentPath([...source, late]));
  expect(() => path.add(tick("expired", 1, 10))).toThrow(/sealed timestamp/);
});

it("retains independent average state through ID compaction and duplicate rejection", () => {
  const model = new CvdAccumulator("1m", defaultCvd(), symbol, { ids: 4, buckets: 10 });
  const source = Array.from({ length: 12 }, (_, i) => tick(String(i), i * 1000, i + 1, i % 2 ? "sell" : "buy", i % 3 + 1));
  source.forEach(t => model.add([t])); const late = tick("late", 10500, 3, "sell", 2); model.add([late]);
  model.add([source[0], source[11]]);
  const expected = independentPath([...source, late]), candle = model.candles(bars(0), "Cumulative delta", "Average")[0];
  expect(candle).toMatchObject({ open: 0, high: expected.high, low: expected.low, close: expected.total, volume: expected.volume });
  expect(model.coverage).toMatchObject({ trades: 13, rejected: 1 });
});

it("rejects monthly/tick intervals and filters wrong-symbol observations", () => {
  for (const timeframe of ["1M", "2M", "100T", "invalid"]) expect(() => new CvdAccumulator(timeframe, defaultCvd(), symbol)).toThrow(/fixed time interval/);
  const model = new CvdAccumulator("1m", defaultCvd(), symbol);
  model.add([tick("valid", 1, 3), { ...tick("wrong", 2, 999), symbol: "ETHUSDT" }]);
  expect(closes(model, [0])).toEqual([3]); expect(model.coverage.rejected).toBe(1);
});

it("emits native Area and sign-colored columns with gaps and configurable colors", () => {
  const model = new CvdAccumulator("1m", defaultCvd(), symbol); model.add([tick("sell", 1, 8, "sell", 2), tick("buy", minute + 1, 9, "buy", 3)]);
  const values = model.candles(bars(0, minute, 2 * minute), "Bar delta", "Average");
  const histogram = cvdSeries(values, resolveCvd({ calculation: "Bar delta", plot: "Histogram", upColor: "#112233", downColor: "#445566" }))[0];
  expect(histogram.kind).toBe("histogram"); if (!("points" in histogram)) throw new Error("Missing columns");
  expect(histogram.points.map(p => [p.value, p.color])).toEqual([[-4, "#445566"], [3, "#112233"], [null, "#445566"]]);
  const area = cvdSeries(values, resolveCvd({ plot: "Area" }))[0];
  expect(area.kind).toBe("area"); expect("style" in area && area.style).toMatchObject({ base: 0 });
});

it("switches native Total/Average without losing contributions beyond the rolling tape", () => {
  vi.useFakeTimers();
  let source = [tick("seed", 1, 20, "buy", 4)], changed: ((t: Tick) => void) | undefined, output: NativeIndicatorOutput = {};
  const read = vi.fn(() => source);
  const instance = cvdDescriptor(read, (_s, cb) => { changed = cb; return () => {}; }).create();
  const context = { symbol, timeframe: "1m", live: true, bars: () => bars(0, minute), emit: (v: NativeIndicatorOutput) => { output = v; }, pushData() {}, setStatus() {} } as unknown as NativeIndicatorContext;
  instance.start(context, { plot: "Line" });
  const next = tick("new", minute + 1, 6, "sell", 3); source = [next]; changed!(next); vi.runAllTimers();
  instance.setInputs({ plot: "Area", mode: "Average" });
  const area = output.series![0]; if (!("points" in area)) throw new Error("Missing area");
  expect(area.points.map(p => p.value)).toEqual([5, 3]); expect(read).toHaveBeenCalledTimes(1);
  instance.stop();
});

it("registers standalone Volume Delta with only applicable controls and aggregate disclosure", () => {
  let output: NativeIndicatorOutput = {}, message = "";
  const descriptor = cvdDescriptor(() => [tick("a", 1, 20, "buy", 4)], () => () => {}, {}, true);
  expect(descriptor.type).toBe("af-volume-delta"); expect(descriptor.inputsSchema().map(i => i.key)).toEqual(["mode", "upColor", "downColor"]);
  const instance = descriptor.create();
  instance.start({ symbol, timeframe: "1m", live: true, bars: () => bars(0, minute), emit: (v: NativeIndicatorOutput) => { output = v; },
    pushData: (v: { message: string }) => { message = v?.message ?? ""; }, setStatus() {} } as unknown as NativeIndicatorContext, { mode: "Average" });
  const series = output.series![0]; expect(series).toMatchObject({ id: "volume-delta", title: "Volume Delta", kind: "histogram" });
  expect("points" in series && series.points.map(p => p.value)).toEqual([5, null]); expect(message).toContain("Aggregate-prefix extrema");
  instance.stop();
});

it("keeps both months' executions in one weekly Volume Delta bar", () => {
  const week = Date.parse("2026-10-26T00:00:00Z");
  const nextWeek = week + 7 * day;
  const trades = [
    tick("oct", Date.parse("2026-10-31T23:59:00Z"), 20, "buy", 4),
    tick("nov", Date.parse("2026-11-01T00:01:00Z"), 6, "sell", 3),
  ];
  let output: NativeIndicatorOutput = {};
  const instance = cvdDescriptor(() => trades, () => () => {}, {}, true).create();
  instance.start({ symbol, timeframe: "1W", live: true, bars: () => bars(week, nextWeek), emit: (value: NativeIndicatorOutput) => { output = value; },
    pushData() {}, setStatus() {} } as unknown as NativeIndicatorContext, { mode: "Total" });
  const values = () => {
    const series = output.series![0];
    return "points" in series ? series.points.map(point => point.value) : [];
  };
  expect(values()).toEqual([14, null]);
  instance.setInputs({ mode: "Average" });
  expect(values()).toEqual([3, null]);
  instance.stop();
});

it("preserves missing Average values across the native candle, line and area styles", () => {
  const trades = [tick("known", 1, 10, "buy", 2), { ...tick("unknown", minute + 1, 6), tradeCount: undefined },
    tick("after-gap", 2 * minute + 1, 8, "buy", 2), tick("after-reset", day + 1, 3)];
  const read = vi.fn(() => trades);
  let output: NativeIndicatorOutput = {};
  const instance = cvdDescriptor(read, () => () => {}).create();
  const inputs = { anchor: "Day", mode: "Average" };
  instance.start({ symbol, timeframe: "1m", live: true, bars: () => bars(0, minute, 2 * minute, day),
    emit: (value: NativeIndicatorOutput) => { output = value; }, pushData() {}, setStatus() {} } as unknown as NativeIndicatorContext,
  { ...inputs, plot: "Candles" });
  const candle = output.series![0];
  expect("bars" in candle && candle.bars.map(bar => Number.isFinite(bar.close) ? bar.close : null)).toEqual([5, null, null, 3]);
  for (const plot of ["Line", "Area"]) {
    instance.setInputs({ ...inputs, plot });
    const series = output.series![0];
    expect("points" in series && series.points.map(point => point.value)).toEqual([5, null, null, 3]);
  }
  expect(read).toHaveBeenCalledTimes(1);
  instance.stop();
});
