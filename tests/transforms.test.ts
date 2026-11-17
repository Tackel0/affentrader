import { describe, expect, it } from "vitest";
import {
  assignSlots,
  boxSize,
  kagi,
  lineBreak,
  pointFigure,
  rangeBars,
  renko,
} from "@/lib/chart/transforms";
import { CHART_TYPES, CHART_TYPE_IDS } from "@/lib/chart/chartTypes";
import type { OHLCV } from "@/types/trading";

const bar = (i: number, close: number, spread = 0.2): OHLCV => ({
  time: i * 60_000,
  open: close,
  high: close + spread,
  low: close - spread,
  close,
  volume: 10,
});
const closes = (values: number[]) => values.map((v, i) => bar(i, v));

describe("renko", () => {
  it("emits one brick per box and ignores moves smaller than a box", () => {
    const bricks = renko(closes([100, 100.5, 101.2, 103.4, 103.9]), 1);
    expect(bricks.map((b) => [b.open, b.close])).toEqual([
      [100, 101],
      [101, 102],
      [102, 103],
    ]);
    expect(bricks.every((b) => b.up)).toBe(true);
  });
  it("needs two boxes against the trend to reverse", () => {
    const bricks = renko(closes([100, 102.1, 101.2, 99.9]), 1);
    expect(bricks.map((b) => [b.open, b.close])).toEqual([
      [100, 101],
      [101, 102],
      [101, 100],
    ]);
    expect(bricks.at(-1)!.up).toBe(false);
  });
  it("derives an ATR-based box size", () => {
    const bars = closes(Array.from({ length: 40 }, (_, i) => 100 + (i % 2)));
    const size = boxSize(bars, { mode: "atr", length: 14 });
    expect(size).toBeGreaterThan(0.5);
    expect(boxSize(bars, { mode: "fixed", size: 2 })).toBe(2);
    expect(boxSize(bars, { mode: "percent", percent: 1 })).toBeCloseTo(1.01, 5);
  });
});

describe("line break", () => {
  it("continues in the trend and reverses only past the last three lines", () => {
    const result = lineBreak(closes([10, 11, 12, 13, 12.5, 9.5]), 3);
    expect(result.map((b) => b.up)).toEqual([true, true, true, false]);
    expect(result.at(-1)!.close).toBe(9.5);
  });
});

describe("range bars", () => {
  it("makes every closed bar exactly one range tall", () => {
    const wild: OHLCV[] = [
      { time: 0, open: 100, high: 110, low: 99, close: 108, volume: 1 },
      { time: 1, open: 108, high: 109, low: 96, close: 97, volume: 1 },
    ];
    const bars = rangeBars(wild, 3);
    expect(bars.length).toBeGreaterThan(3);
    for (const b of bars.slice(0, -1))
      expect(b.high - b.low).toBeCloseTo(3, 8);
  });
});

describe("kagi", () => {
  it("draws a new line only after a reversal of the threshold", () => {
    const lines = kagi(closes([100, 103, 106, 104.5, 101, 99, 105]), 3);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0].up).toBe(true);
    expect(lines[0].to).toBe(106);
    expect(lines[1].up).toBe(false);
  });
});

describe("point & figure", () => {
  it("stacks boxes into alternating columns with a three-box reversal", () => {
    const columns = pointFigure(
      closes([100, 101, 102, 103, 104, 101, 100, 99, 98, 103]),
      1,
      3,
    );
    expect(columns[0].up).toBe(true);
    expect(columns[0].boxes[0]).toBe(100);
    expect(columns[0].boxes.at(-1)).toBe(104);
    expect(columns[1].up).toBe(false);
  });
});

describe("slot assignment", () => {
  it("keeps marks on their source bars and spreads same-bar marks", () => {
    expect(assignSlots([2, 2, 2, 5], 9)).toEqual([2, 3, 4, 5]);
  });
  it("shifts left when marks would pass the newest bar", () => {
    expect(assignSlots([8, 9, 9, 9], 9)).toEqual([6, 7, 8, 9]);
  });
});

describe("chart type catalog", () => {
  it("lists every style once with a unique id", () => {
    expect(new Set(CHART_TYPE_IDS).size).toBe(CHART_TYPES.length);
    for (const id of ["candles", "bars", "renko", "kagi", "pointfigure", "footprint"])
      expect(CHART_TYPE_IDS).toContain(id);
  });
});
