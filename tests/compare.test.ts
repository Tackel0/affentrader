import { describe, expect, it } from "vitest";
import {
  collectSymbols,
  parseFormula,
  runFormula,
  alignToTimeline,
} from "@/lib/chart/compare";
import { computeDerived, describeDerived, isDerivedSpec } from "@/lib/indicators/derived";
import { getOverlays, setOverlay, clearOverlays, valueAt } from "@/lib/chart/overlays";
import type { OHLCV } from "@/types/trading";

const series = (start: number, step: number, count = 6, base = 0): OHLCV[] =>
  Array.from({ length: count }, (_, i) => {
    const close = start + i * step;
    return { time: base + i * 60_000, open: close, high: close + 1, low: close - 1, close, volume: 10 };
  });
const timeline = series(0, 0).map((b) => b.time);

describe("formula parser", () => {
  it("respects precedence and right-associative powers", () => {
    const result = runFormula("2 + 3 * 4 ^ 2 / 8", {}, [0]);
    expect(result.points[0].value).toBe(8);
    expect(runFormula("2 ^ 3 ^ 2", {}, [0]).points[0].value).toBe(512);
    expect(runFormula("-(1 + 2) * 2", {}, [0]).points[0].value).toBe(-6);
  });
  it("combines symbols into ratios and spreads", () => {
    const data = { BTCUSDT: series(100, 10), ETHUSDT: series(10, 1) };
    const ratio = runFormula("BTCUSDT / ETHUSDT", data, timeline);
    expect(ratio.points).toHaveLength(6);
    expect(ratio.points[0].value).toBe(10);
    expect(ratio.symbols.sort()).toEqual(["BTCUSDT", "ETHUSDT"]);
    const spread = runFormula("BTCUSDT.high - ETHUSDT.low", data, timeline);
    expect(spread.points[0].value).toBe(101 - 9);
  });
  it("supports functions and moving averages", () => {
    const data = { BTCUSDT: series(100, 10) };
    expect(runFormula("max(BTCUSDT, 120)", data, timeline).points[0].value).toBe(120);
    const smooth = runFormula("sma(BTCUSDT, 3)", data, timeline);
    expect(smooth.points[0].time).toBe(timeline[2]);
    expect(smooth.points[0].value).toBe(110);
    expect(runFormula("change(BTCUSDT)", data, timeline).points[0].value).toBe(10);
    expect(runFormula("log(1)", {}, [0]).points[0].value).toBe(0);
  });
  it("reports readable errors and never evaluates arbitrary code", () => {
    expect(() => parseFormula("BTCUSDT +")).toThrow();
    expect(() => parseFormula("foo(1)")).toThrow(/Unknown function/);
    expect(() => parseFormula("alert(1)")).toThrow(/Unknown function/);
    expect(() => parseFormula("BTCUSDT.vol")).toThrow(/Unknown field/);
    expect(() => parseFormula("1 $ 2")).toThrow(/Unexpected character/);
    expect(() => parseFormula("(".repeat(60) + "1" + ")".repeat(60))).toThrow(/nested/);
    expect(() => runFormula("BTCUSDT", {}, [0])).toThrow(/No data/);
  });
  it("collects symbols and forward-fills sparse series", () => {
    expect([...collectSymbols(parseFormula("A1B2C3 + btcusdt"))].sort()).toEqual(["A1B2C3", "BTCUSDT"]);
    const sparse = series(5, 1, 2, 120_000);
    const aligned = alignToTimeline(sparse, [0, 60_000, 120_000, 180_000, 240_000], "close");
    expect(aligned.slice(0, 2).every(Number.isNaN)).toBe(true);
    expect(aligned.slice(2)).toEqual([5, 6, 6]);
  });
});

describe("indicator on indicator", () => {
  const bars = series(100, 1, 120).map((b, i) => ({
    ...b,
    close: 100 + Math.sin(i / 5) * 10,
    high: 112,
    low: 88,
  }));
  it("applies a moving average to RSI", () => {
    const spec = {
      source: { kind: "indicator" as const, indicator: "rsi", params: { length: 14 } },
      apply: { indicator: "sma", params: { length: 5 } },
    };
    expect(isDerivedSpec(spec)).toBe(true);
    const output = computeDerived(bars, spec);
    expect(output.overlay).toBe(false);
    const finite = output.plots[0].values.filter(Number.isFinite);
    expect(finite.length).toBeGreaterThan(80);
    expect(Math.min(...finite)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...finite)).toBeLessThanOrEqual(100);
    expect(describeDerived(spec)).toContain("SMA(5)");
    expect(describeDerived(spec)).toContain("RSI(14)");
  });
  it("applies Bollinger Bands to MACD with three outputs", () => {
    const output = computeDerived(bars, {
      source: { kind: "indicator", indicator: "macd", plot: "histogram" },
      apply: { indicator: "bollinger", params: { length: 10, mult: 2 } },
    });
    expect(output.plots.map((p) => p.id)).toEqual(["basis", "upper", "lower"]);
  });
  it("rejects specs that are not sourceable or unknown", () => {
    expect(isDerivedSpec({ source: { kind: "price" }, apply: { indicator: "atr" } })).toBe(false);
    expect(isDerivedSpec({ source: { kind: "indicator", indicator: "nope" }, apply: { indicator: "sma" } })).toBe(false);
    expect(() =>
      computeDerived(bars, { source: { kind: "price" }, apply: { indicator: "atr" } }),
    ).toThrow();
  });
});

describe("overlay registry", () => {
  it("keeps owners separate and finds line values", () => {
    clearOverlays("t");
    setOverlay("t", "a", [{ kind: "hline", id: "x", price: 1, color: "#fff" }]);
    setOverlay("t", "b", [{ kind: "hline", id: "y", price: 2, color: "#fff" }]);
    expect(getOverlays("t")).toHaveLength(2);
    setOverlay("t", "a", []);
    expect(getOverlays("t")).toHaveLength(1);
    expect(valueAt([{ time: 1, value: 5 }, { time: 3, value: 7 }], 2)).toBe(5);
    expect(valueAt([{ time: 1, value: 5 }], 0)).toBeNull();
    clearOverlays("t");
  });
});
