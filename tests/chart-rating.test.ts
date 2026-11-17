import { afterEach, describe, expect, it, vi } from "vitest";
import { chartRating, type ChartRatingContext } from "@/lib/ta/chartRating";
import { technicalRating } from "@/lib/ta/rating";
import { useChartStore } from "@/stores/useChartStore";
import type { OHLCV } from "@/types/trading";
const live: ChartRatingContext = { replayActive: false, cursorTime: null, recovering: false, error: null };
const bars = (count = 260): OHLCV[] => Array.from({ length: count }, (_, i) => {
  const close = 100 + Math.sin(i / 7) * 3 + i * .01;
  return { time: 1700000000000 + i * 60000, open: close - .1, high: close + .5, low: close - .5, close, volume: 100 + i % 13 };
});
const initial = useChartStore.getState();
afterEach(() => { useChartStore.setState(initial, true); vi.restoreAllMocks(); });
describe("selected chart technicals", () => {
  it("reflects changed high/low and volume without a new close, timestamp or length", () => {
    const original = bars(), corrected = original.map((bar, i) => i === original.length - 1 ? { ...bar, high: bar.high + 20, low: bar.low - 10, volume: bar.volume * 100 } : bar);
    const first = chartRating(original, live).rating!, next = chartRating(corrected, live).rating!;
    expect(original.at(-1)!.close).toBe(corrected.at(-1)!.close);
    expect(next.oscillators.find(entry => entry.name === "CCI (20)")!.value).not.toBe(first.oscillators.find(entry => entry.name === "CCI (20)")!.value);
    expect(next.movingAverages.find(entry => entry.name === "VWMA (20)")!.value).not.toBe(first.movingAverages.find(entry => entry.name === "VWMA (20)")!.value);
  });
  it("reflects repaired earlier candles even when the current candle is unchanged", () => {
    const original = bars(), corrected = original.map((bar, i) => i === 250 ? { ...bar, close: bar.close + 8, high: bar.high + 8 } : bar);
    expect(corrected.at(-1)).toBe(original.at(-1));
    expect(chartRating(corrected, live).rating).not.toEqual(chartRating(original, live).rating);
  });
  it("evaluates Replay over the revealed prefix and excludes deliberately extreme future bars", () => {
    const original = bars(), cursorTime = original[179].time;
    const poisoned = original.map((bar, i) => i > 179 ? { ...bar, open: 1e9, high: 2e9, low: 1, close: 1e9, volume: 1e10 } : bar);
    const context = { ...live, replayActive: true, cursorTime };
    expect(chartRating(poisoned, context)).toEqual(chartRating(original, context));
    expect(chartRating(poisoned, context).rating).toEqual(technicalRating(original.slice(0, 180)));
    expect(chartRating(poisoned, context).asOf).toBe(cursorTime);
    expect(chartRating(poisoned, live).rating).not.toEqual(chartRating(poisoned, context).rating);
  });
  it("does not reveal future technicals while Replay starts or seeks before sufficient history", () => {
    const data = bars();
    expect(chartRating(data, { ...live, replayActive: true }).status).toBe("replay-waiting");
    expect(chartRating(data, { ...live, replayActive: true, cursorTime: NaN }).rating).toBeNull();
    expect(chartRating(data, { ...live, replayActive: true, cursorTime: data[30].time })).toMatchObject({ status: "insufficient", rating: null });
  });
  it("withholds live ratings during recovery and resumes over corrected history", () => {
    const data = bars();
    expect(chartRating(data, { ...live, recovering: true })).toMatchObject({ status: "recovering", rating: null });
    expect(chartRating(data, live)).toMatchObject({ status: "ready", rating: technicalRating(data) });
    expect(chartRating(data, { ...live, replayActive: true, cursorTime: data[179].time, recovering: true }).status).toBe("ready");
    expect(chartRating(data, { ...live, error: "Provider unavailable" })).toMatchObject({ status: "error", rating: null });
  });
  it.each(["symbol", "timeframe", "feedEpoch"] as const)("invalidates old candles when %s changes", field => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = useChartStore.getState(); state.set({ symbol: "HL:BTC", timeframe: "5m", candles: bars() });
    const patch = field === "symbol" ? { symbol: "HL:ETH" } : field === "timeframe" ? { timeframe: "15m" } : { feedEpoch: state.feedEpoch + 1 };
    state.set(patch);
    expect(chartRating(useChartStore.getState().candles, live).rating).toBeNull();
  });
  it("retains bars on a cosmetic change and accepts explicitly loaded bars with an interval commit", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const data = bars(), state = useChartStore.getState();
    state.set({ candles: data }); state.set({ drawing: "cursor" });
    expect(useChartStore.getState().candles).toBe(data);
    state.set({ timeframe: "30m", candles: data });
    expect(useChartStore.getState().candles).toBe(data);
    expect(chartRating(useChartStore.getState().candles, live).status).toBe("ready");
  });
});
