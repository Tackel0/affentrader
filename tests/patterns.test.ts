import { describe, expect, it } from "vitest";
import { detectCandlePatterns } from "@/lib/patterns/candles";
import { detectChartPatterns } from "@/lib/patterns/chart";
import {
  allPatternIds,
  DEFAULT_PATTERN_OPTIONS,
  detectPatterns,
  patternOverlays,
} from "@/lib/patterns";
import type { OHLCV } from "@/types/trading";

const candle = (i: number, open: number, high: number, low: number, close: number): OHLCV => ({
  time: i * 60_000,
  open,
  high,
  low,
  close,
  volume: 100,
});

/** Linear path through waypoints [barIndex, price]. */
function path(waypoints: [number, number][], spread = 0.4): OHLCV[] {
  const bars: OHLCV[] = [];
  for (let w = 0; w < waypoints.length - 1; w++) {
    const [i0, p0] = waypoints[w];
    const [i1, p1] = waypoints[w + 1];
    for (let i = i0; i < i1; i++) {
      const t = (i - i0) / (i1 - i0);
      const close = p0 + (p1 - p0) * t;
      const next = p0 + (p1 - p0) * ((i + 1 - i0) / (i1 - i0));
      bars.push(candle(i, close, Math.max(close, next) + spread, Math.min(close, next) - spread, next));
    }
  }
  const [lastIndex, lastPrice] = waypoints.at(-1)!;
  bars.push(candle(lastIndex, lastPrice, lastPrice + spread, lastPrice - spread, lastPrice));
  return bars;
}
/** A decline of down candles, then the supplied formation. */
function afterDecline(formation: [number, number, number, number][]): OHLCV[] {
  const lead = Array.from({ length: 12 }, (_, i) => {
    const open = 120 - i * 2;
    return candle(i, open, open + 0.3, open - 2.3, open - 2);
  });
  return [...lead, ...formation.map((c, k) => candle(12 + k, ...c))];
}
function afterRally(formation: [number, number, number, number][]): OHLCV[] {
  const lead = Array.from({ length: 12 }, (_, i) => {
    const open = 80 + i * 2;
    return candle(i, open, open + 2.3, open - 0.3, open + 2);
  });
  return [...lead, ...formation.map((c, k) => candle(12 + k, ...c))];
}
const ids = (bars: OHLCV[]) => detectCandlePatterns(bars).map((h) => h.id);

describe("candlestick patterns", () => {
  it("finds a hammer after a decline", () => {
    expect(ids(afterDecline([[96.5, 97.4, 92, 97.2]]))).toContain("hammer");
  });
  it("finds a shooting star after a rally", () => {
    expect(ids(afterRally([[105, 110.5, 104, 104.2]]))).toContain("shooting-star");
  });
  it("finds bullish and bearish engulfing", () => {
    expect(ids(afterDecline([[98, 98.2, 96.5, 96.8], [96.5, 100, 96.3, 99.8]]))).toContain("bullish-engulfing");
    expect(ids(afterRally([[104, 105.5, 103.8, 105.2], [105.4, 105.6, 102, 102.3]]))).toContain("bearish-engulfing");
  });
  it("finds a morning star and an evening star", () => {
    expect(
      ids(afterDecline([[98, 98.2, 93.8, 94], [93.4, 93.9, 92.8, 93.2], [93.5, 98.6, 93.4, 98.3]])),
    ).toContain("morning-star");
    expect(
      ids(afterRally([[104, 108.2, 103.8, 108], [108.8, 109.4, 108.3, 108.9], [108.5, 108.7, 103.4, 103.7]])),
    ).toContain("evening-star");
  });
  it("finds three white soldiers and three black crows", () => {
    expect(
      ids(afterDecline([[96, 99.2, 95.9, 99], [97.5, 102.6, 97.4, 102.4], [100, 106.1, 99.8, 106]])),
    ).toContain("three-white-soldiers");
    expect(
      ids(afterRally([[104, 104.1, 100.8, 101], [102.5, 102.6, 97.4, 97.6], [99, 99.1, 92.9, 93]])),
    ).toContain("three-black-crows");
  });
  it("finds doji and inside bars", () => {
    expect(ids(afterDecline([[98, 99, 97, 98.05]]))).toContain("doji");
    expect(ids(afterDecline([[98, 102, 94, 101], [99, 100, 96, 97]]))).toContain("inside-bar");
  });
  it("stays quiet on ordinary candles", () => {
    const calm = Array.from({ length: 40 }, (_, i) => candle(i, 100, 101, 99, i % 2 ? 100.6 : 99.4));
    const found = ids(calm).filter((id) => !["inside-bar", "outside-bar", "spinning-top"].includes(id));
    expect(found.length).toBeLessThan(calm.length / 2);
  });
});

describe("chart patterns", () => {
  const run = (bars: OHLCV[]) => detectChartPatterns(bars, { strength: 4 }).map((h) => h.id);
  it("finds a double top and double bottom", () => {
    const top = path([[0, 90], [10, 110], [20, 96], [30, 110.2], [42, 92]]);
    expect(run(top)).toContain("double-top");
    const bottom = path([[0, 120], [10, 100], [20, 114], [30, 100.2], [42, 118]]);
    expect(run(bottom)).toContain("double-bottom");
  });
  it("marks a double top as confirmed after the neckline breaks", () => {
    const top = path([[0, 90], [10, 110], [20, 96], [30, 110.2], [42, 92]]);
    const hit = detectChartPatterns(top, { strength: 4 }).find((h) => h.id === "double-top")!;
    expect(hit.confirmed).toBe(true);
    expect(hit.lines.some((l) => l.label === "Neckline")).toBe(true);
  });
  it("finds head and shoulders and its inverse", () => {
    const hs = path([[0, 90], [8, 106], [16, 96], [26, 116], [36, 96], [44, 106], [56, 88]]);
    expect(run(hs)).toContain("head-shoulders");
    const inverse = path([[0, 130], [8, 114], [16, 124], [26, 104], [36, 124], [44, 114], [56, 132]]);
    expect(run(inverse)).toContain("inverse-head-shoulders");
  });
  it("finds triangles", () => {
    const asc = path([[0, 90], [10, 110], [20, 96], [30, 110], [40, 102], [50, 110], [58, 106], [66, 110], [72, 108]]);
    expect(run(asc)).toContain("ascending-triangle");
    const sym = path([[0, 90], [10, 120], [20, 94], [30, 114], [40, 98], [50, 109], [58, 101], [66, 106], [72, 104]]);
    expect(run(sym)).toContain("symmetrical-triangle");
  });
  it("finds a bull flag", () => {
    const flag = path([[0, 100], [14, 100.5], [26, 130], [40, 125], [41, 125.5]]);
    const found = detectChartPatterns(flag, { strength: 4 }).map((h) => h.id);
    expect(found).toContain("bull-flag");
  });
});

describe("combined detection", () => {
  it("lists a unique id for every pattern and applies filters", () => {
    const list = allPatternIds();
    expect(new Set(list.map((p) => p.id)).size).toBe(list.length);
    expect(list.length).toBeGreaterThanOrEqual(40);
    const bars = afterDecline([[96.5, 97.4, 92, 97.2]]);
    const all = detectPatterns(bars, { ...DEFAULT_PATTERN_OPTIONS, chart: false });
    expect(all.some((h) => h.id === "hammer")).toBe(true);
    const hidden = detectPatterns(bars, { ...DEFAULT_PATTERN_OPTIONS, chart: false, disabled: ["hammer"] });
    expect(hidden.some((h) => h.id === "hammer")).toBe(false);
    const markers = patternOverlays(all, bars);
    expect(markers.some((m) => m.kind === "marker")).toBe(true);
  });
});

