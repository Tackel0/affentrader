import { describe, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, NativeIndicatorOutput } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { CvdAccumulator } from "@/lib/orderflow/cvdModel";
import { cvdDescriptor, type CvdNotice } from "@/lib/orderflow/cvdIndicator";
import { defaultCvd as velaCvdDefaults, resolveCvd, cvdInputs } from "@/lib/orderflow/cvdSettings";
import { studyArguments } from "@/lib/chart/statusLine";
const minute = 60000, day = 86400000;
// Preserve explicit saved Session/Line behavior while new studies use Vela defaults.
const defaultCvd = () => ({ ...velaCvdDefaults(), anchor: "Session" as const, plot: "Line" as const });
const tick = (id: string, time: number, quantity = 1, side: Tick["side"] = "buy", simulated = false): Tick =>
  ({ id, symbol: "BTCUSDT", time, price: 100, quantity, side, simulated });
const bars = (...times: number[]) => times.map(time => ({ time, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
const values = (model: CvdAccumulator, times: number[], calculation: "Bar delta" | "Cumulative delta" = "Cumulative delta") => model.points(bars(...times), calculation).map(point => point.value);
function emittedValues(output: NativeIndicatorOutput) {
  const series = output.series?.[0];
  if (!series || !("points" in series)) throw new Error("Expected a line or histogram series.");
  return series.points.map(point => point.value);
}
function harness(live = true, symbol = "BTCUSDT") {
  let history = [tick("seed", 0, 2)], changed: ((tick: Tick) => void) | undefined;
  const outputs: NativeIndicatorOutput[] = [], notices: Array<CvdNotice | null> = [], statuses: string[] = [], detach = vi.fn();
  const descriptor = cvdDescriptor(() => history, (_symbol, callback) => { changed = callback; return detach; });
  const instance = descriptor.create();
  const context = { symbol, timeframe: "1m", live, bars: () => bars(0, minute, 2 * minute), emit: (output: NativeIndicatorOutput) => outputs.push(output),
    pushData: (notice: CvdNotice | null) => notices.push(notice), setStatus: (status: string) => statuses.push(status) } as unknown as NativeIndicatorContext;
  instance.start(context, defaultCvd());
  const setInputs = instance.setInputs.bind(instance);
  instance.setInputs = inputs => setInputs({ ...defaultCvd(), ...inputs });
  return { instance, outputs, notices, statuses, detach, changed: () => changed!, replace: (trades: Tick[]) => { history = trades; } };
}
describe("classified live cumulative volume delta", () => {
  it("sums actual quantities, reorders deliveries, ignores duplicates and leaves unavailable history null", () => {
    const model = new CvdAccumulator("1m", defaultCvd(), "BTCUSDT");
    model.add([tick("b", minute, 5, "sell"), tick("a", 0, 2), tick("b", minute, 5, "sell"), tick("c", minute + 2, 1)]);
    expect(values(model, [-minute, 0, minute, 2 * minute])).toEqual([null, 2, -2, -2]);
    expect(values(model, [0, minute, 2 * minute], "Bar delta")).toEqual([2, -4, 0]);
    expect(model.coverage.trades).toBe(3);
    model.add([tick("late", 2, 4)]); expect(values(model, [0, minute])).toEqual([6, 2]);
  });
  it("retains cumulative contribution after the service buffer rolls and compacts old duplicate IDs safely", () => {
    const model = new CvdAccumulator("1m", defaultCvd(), "BTCUSDT", { ids: 4, buckets: 20 });
    for (let index = 0; index < 10; index++) model.add([tick(String(index), index * minute)]);
    model.add([tick("0", 0), tick("9", 9 * minute)]);
    expect(values(model, [9 * minute])).toEqual([10]); expect(model.coverage.trades).toBe(10); expect(model.coverage.rejected).toBe(1);
  });
  it("does not silently forget duplicate IDs when an unbounded burst shares one timestamp", () => {
    const model = new CvdAccumulator("1m", defaultCvd(), "BTCUSDT", { ids: 2, buckets: 10 });
    expect(() => model.add([tick("a", 0), tick("b", 0), tick("c", 0)])).toThrow(/duplicate tracking/);
  });
  it("resets on calendar sessions, keeps collection mode continuous and does not carry across unobserved new sessions", () => {
    const source = [tick("a", day - minute, 3), tick("b", day + minute, 2, "sell")];
    const session = new CvdAccumulator("1m", defaultCvd(), "BTCUSDT"); session.add(source);
    expect(values(session, [day - minute, day, day + minute])).toEqual([3, null, -2]);
    const collection = new CvdAccumulator("1m", { ...defaultCvd(), anchor: "Collection" }, "BTCUSDT"); collection.add(source);
    expect(values(collection, [day - minute, day, day + minute])).toEqual([3, 3, 1]);
  });
  it("applies DST-aware sessions, weekdays and a boundary inside a chart bar", () => {
    const style = { ...defaultCvd(), sessionZone: "America/New_York", sessionStartMinutes: 570, sessionMinutes: 390, weekdaysOnly: true };
    const model = new CvdAccumulator("1h", style, "BTCUSDT");
    const first = Date.parse("2026-03-06T14:30:00Z"), second = Date.parse("2026-03-09T13:30:00Z");
    model.add([tick("fri", first, 3), tick("sat", first + day, 50), tick("mon", second, 2, "sell")]);
    expect(values(model, [first - 30 * minute, first + 60 * minute - 30 * minute, second - 30 * minute])).toEqual([3, 3, -2]);
    expect(model.coverage.trades).toBe(2);
  });
  it("separates simulated and exchange totals and rejects stale opposite-source deliveries", () => {
    const model = new CvdAccumulator("1m", defaultCvd(), "BTCUSDT");
    model.add([tick("real", 0, 10), tick("sim", minute, 2, "buy", true), tick("old-real", 1, 100)]);
    expect(values(model, [0, minute])).toEqual([null, 2]); expect(model.coverage.source).toBe("simulation");
    model.add([tick("stale", 2, 100)]); expect(values(model, [minute])).toEqual([2]);
    model.add([tick("real-new", 2 * minute, 4, "sell")]); expect(values(model, [minute, 2 * minute])).toEqual([null, -4]);
  });
  it("rejects invalid quantities and refuses unsupported intervals, capacity and overflow", () => {
    const model = new CvdAccumulator("1m", defaultCvd(), "BTCUSDT", { ids: 10, buckets: 1 });
    model.add([tick("bad", 0, NaN), tick("negative", 0, -1), tick("valid", 0)]); expect(model.coverage.rejected).toBe(2);
    expect(() => model.add([tick("next", minute)])).toThrow(/20,000/);
    expect(() => new CvdAccumulator("100T", defaultCvd(), "BTCUSDT")).toThrow(/time interval/);
    const huge = new CvdAccumulator("1m", defaultCvd(), "BTCUSDT");
    expect(() => huge.add([tick("a", 0, Number.MAX_VALUE), tick("b", 0, Number.MAX_VALUE)])).toThrow(/precision/);
  });
  it("exposes validated calculation/session/style inputs with legacy defaults", () => {
    expect(resolveCvd({ anchor: "Session", plot: "Line" })).toEqual(defaultCvd()); expect(cvdInputs()).toHaveLength(16);
    expect(resolveCvd({ anchor: "Collection", plot: "Histogram", weekdaysOnly: false }).plot).toBe("Histogram");
    for (const invalid of [{ anchor: "bad" }, { sessionZone: "bad/zone" }, { lineWidth: 0 }, { color: "red" }, { sessionMinutes: 0 }]) expect(() => resolveCvd(invalid)).toThrow();
    expect(studyArguments({ anchor: "Collection", calculation: "Bar delta", plot: "Histogram", sessionZone: "Europe/Berlin" }, "cvd")).toBe("Collection Δ");
    expect(studyArguments({}, "cvd")).toBe("Month UTC");
  });
  it("updates from trades without candle callbacks and keeps contributions outside the retained window", () => {
    vi.useFakeTimers(); try {
      const h = harness(), first = h.outputs.length;
      h.replace([tick("new", minute, 3, "sell")]); h.changed()(tick("new", minute, 3, "sell")); h.changed()(tick("new", minute, 3, "sell"));
      vi.advanceTimersByTime(49); expect(h.outputs).toHaveLength(first); vi.advanceTimersByTime(1);
      expect(emittedValues(h.outputs.at(-1)!)).toEqual([2, -1, -1]);
      expect(h.notices.at(-1)!.message).toContain("2 trades"); h.instance.stop();
    } finally { vi.useRealTimers(); }
  });
  it("preserves the accumulator on style edits and restarts only for session input changes", () => {
    vi.useFakeTimers(); try {
      const h = harness(); h.changed()(tick("next", minute, 3)); vi.runAllTimers(); h.replace([tick("recent", minute, 1)]);
      h.instance.setInputs({ color: "#123456", plot: "Histogram", calculation: "Bar delta" });
      expect(emittedValues(h.outputs.at(-1)!)).toEqual([2, 3, 0]);
      expect(h.outputs.at(-1)!.series![0].kind).toBe("histogram");
      h.instance.setInputs({ anchor: "Collection" }); expect(emittedValues(h.outputs.at(-1)!)).toEqual([null, 1, 1]); h.instance.stop();
    } finally { vi.useRealTimers(); }
  });
  it("fences stale callbacks, cancels pending emissions and restarts hidden coverage explicitly", () => {
    vi.useFakeTimers(); try {
      const h = harness(), old = h.changed(); old(tick("new", minute)); h.instance.suspend(); expect(h.detach).toHaveBeenCalledTimes(1); expect(h.notices.at(-1)).toBeNull();
      const count = h.outputs.length; vi.runAllTimers(); old(tick("old", minute)); expect(h.outputs).toHaveLength(count);
      h.replace([tick("resumed", minute, 4)]); h.instance.resume(); old(tick("stale", 0, 100)); vi.runAllTimers();
      expect(emittedValues(h.outputs.at(-1)!)).toEqual([null, 4, 4]); h.instance.stop();
      const stopped = h.outputs.length; h.instance.onBars(); h.instance.resume(); expect(h.outputs).toHaveLength(stopped);
    } finally { vi.useRealTimers(); }
  });
  it("emits no live-derived values during Replay and distinguishes Yahoo's unavailable trade feed", () => {
    const replay = harness(false); expect(emittedValues(replay.outputs.at(-1)!)).toEqual([null, null, null]); expect(replay.notices.at(-1)!.message).toMatch(/Replay/); replay.instance.stop();
    const yahoo = harness(true, "YF:AAPL"); yahoo.instance.suspend(); yahoo.replace([]); yahoo.instance.resume();
    expect(yahoo.notices.at(-1)!.message).toMatch(/No classified trade feed/); yahoo.instance.stop();
  });
  it("keeps a failed initial seed unavailable on later callbacks instead of exposing its partial sum", () => {
    const h = harness(); h.instance.suspend();
    h.replace([tick("huge-a", 0, Number.MAX_VALUE), tick("huge-b", 0, Number.MAX_VALUE)]); h.instance.resume();
    expect(emittedValues(h.outputs.at(-1)!)).toEqual([null, null, null]); expect(h.notices.at(-1)!.message).toMatch(/precision/);
    h.instance.onBars(); expect(emittedValues(h.outputs.at(-1)!)).toEqual([null, null, null]); expect(h.notices.at(-1)!.message).toMatch(/precision/);
    h.replace([tick("valid", 0, 3)]); h.instance.setInputs({ anchor: "Collection" });
    expect(emittedValues(h.outputs.at(-1)!)).toEqual([3, 3, 3]); h.instance.stop();
  });
  it("groups an overnight session across local midnight and resets at its next open", () => {
    const style = { ...defaultCvd(), sessionZone: "Europe/Berlin", sessionStartMinutes: 1320, sessionMinutes: 480 };
    const model = new CvdAccumulator("1m", style, "BTCUSDT");
    const time = Date.parse("2026-10-26T21:00:00Z");
    model.add([tick("open", time, 4), tick("after-midnight", time + 3 * 60 * minute, 1, "sell"), tick("next-open", time + day, 2)]);
    expect(values(model, [time, time + 3 * 60 * minute, time + 9 * 60 * minute, time + day])).toEqual([4, 3, null, 2]);
  });
});
