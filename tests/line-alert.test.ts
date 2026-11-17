import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lineValueAt, ruleFromDrawing, supportsLineAlert, type DrawnLine } from "@/lib/alerts/line";
import { evaluateCondition, validateCondition, validateRuleShape, type MarketView } from "@/lib/alerts/rules";
import { BrowserRuleEngine } from "@/lib/alerts/browserEngine";
import type { Condition, Operand } from "@/types/alerts";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const line = (extend: "none" | "left" | "right" | "both" = "right"): Extract<Operand, { type: "line" }> => ({
  type: "line",
  from: { time: NOW - 10 * HOUR, price: 100 },
  to: { time: NOW - 5 * HOUR, price: 110 },
  extend,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("line values", () => {
  it("interpolates and extrapolates along the slope", () => {
    expect(lineValueAt(line(), NOW - 10 * HOUR)).toBe(100);
    expect(lineValueAt(line(), NOW - 7.5 * HOUR)).toBeCloseTo(105);
    expect(lineValueAt(line(), NOW - 5 * HOUR)).toBe(110);
    expect(lineValueAt(line("right"), NOW)).toBeCloseTo(120);
  });
  it("is undefined where the line does not reach", () => {
    expect(lineValueAt(line("none"), NOW)).toBeNaN();
    expect(lineValueAt(line("right"), NOW - 12 * HOUR)).toBeNaN();
    expect(lineValueAt(line("left"), NOW - 12 * HOUR)).toBeCloseTo(96);
    expect(lineValueAt(line("both"), NOW - 12 * HOUR)).toBeCloseTo(96);
    expect(lineValueAt(line("both"), Number.NaN)).toBeNaN();
  });
  it("rejects a vertical line", () => {
    const vertical = { ...line(), to: { time: NOW - 10 * HOUR, price: 120 } };
    expect(lineValueAt(vertical, NOW)).toBeNaN();
  });
});

describe("alerts from drawings", () => {
  const trend: DrawnLine = {
    id: "dw-1",
    type: "trendline",
    anchors: [
      { time: NOW - 10 * HOUR, price: 100 },
      { time: NOW - 5 * HOUR, price: 110 },
    ],
    style: { extendRight: true },
  };
  const view = (price: number, previous: number): MarketView => ({
    bars: [],
    quote: { price, previous, changePercent: 0, volume: 0, high: price, low: price },
  });
  const scope = { symbol: "BTCUSDT", timeframe: "15m" };

  it("knows which drawings can alert", () => {
    expect(supportsLineAlert("trendline")).toBe(true);
    expect(supportsLineAlert("hline")).toBe(true);
    expect(supportsLineAlert("fibretracement")).toBe(false);
    expect(ruleFromDrawing({ ...trend, type: "fibretracement" }, { symbol: "BTCUSDT", timeframe: "15m", direction: "up" })).toBeNull();
    expect(ruleFromDrawing({ ...trend, anchors: [trend.anchors[0]] }, { symbol: "BTCUSDT", timeframe: "15m", direction: "up" })).toBeNull();
  });
  it("fires when price crosses a rising trendline from below", () => {
    const rule = ruleFromDrawing(trend, { symbol: "BTCUSDT", timeframe: "15m", direction: "up" })!;
    expect(validateRuleShape(rule)).toBeNull();
    // The line stands at 120 now.
    const crossed = evaluateCondition(rule.condition, scope, () => view(121, 119));
    expect(crossed.met).toBe(true);
    expect(evaluateCondition(rule.condition, scope, () => view(118, 116)).met).toBe(false);
    // A cross in the other direction does not satisfy an "up" alert.
    expect(evaluateCondition(rule.condition, scope, () => view(119, 121)).met).toBe(false);
  });
  it("supports downward and either-way crossings", () => {
    const down = ruleFromDrawing(trend, { symbol: "BTCUSDT", timeframe: "15m", direction: "down" })!;
    expect(evaluateCondition(down.condition, scope, () => view(119, 121)).met).toBe(true);
    const either = ruleFromDrawing(trend, { symbol: "BTCUSDT", timeframe: "15m", direction: "either" })!;
    expect(evaluateCondition(either.condition, scope, () => view(119, 121)).met).toBe(true);
    expect(evaluateCondition(either.condition, scope, () => view(121, 119)).met).toBe(true);
  });
  it("does not fire past the end of a line that does not extend", () => {
    const fixed = ruleFromDrawing({ ...trend, style: {} }, { symbol: "BTCUSDT", timeframe: "15m", direction: "either" })!;
    expect(evaluateCondition(fixed.condition, scope, () => view(121, 119)).met).toBe(false);
  });
  it("turns horizontal levels into a plain price crossing", () => {
    const rule = ruleFromDrawing({ id: "h", type: "hline", anchors: [{ time: NOW, price: 120 }] }, { symbol: "BTCUSDT", timeframe: "1h", direction: "up" })!;
    expect((rule.condition as Extract<Condition, { op: "leaf" }>).leaf).toMatchObject({ right: { type: "number", value: 120 } });
    expect(evaluateCondition(rule.condition, scope, () => view(121, 119)).met).toBe(true);
  });
  it("validates stored line operands", () => {
    const bad = (patch: Record<string, unknown>) =>
      validateCondition({
        op: "leaf",
        leaf: { type: "compare", left: { type: "quote", field: "price" }, comparator: "crossing", right: { ...line(), ...patch } },
      });
    expect(bad({})).toBeNull();
    expect(bad({ from: { time: NOW, price: -1 } })).toMatch(/two valid points/);
    expect(bad({ to: { time: NOW - 10 * HOUR, price: 120 } })).toMatch(/different times/);
    expect(bad({ extend: "up" })).toMatch(/extension/);
  });
});

describe("line alerts in the browser engine", () => {
  const drawn: DrawnLine = {
    id: "dw-2",
    type: "trendline",
    anchors: [
      { time: NOW - 10 * HOUR, price: 100 },
      { time: NOW - 5 * HOUR, price: 110 },
    ],
    style: { extendRight: true },
  };
  const make = (draw: DrawnLine) => {
    const rule = ruleFromDrawing(draw, { symbol: "BTCUSDT", timeframe: "15m", direction: "up", id: "line-rule" })!;
    const quote = { price: 118, previous: 118, changePercent: 0, volume: 0, high: 0, low: 0 };
    const fire = vi.fn();
    let tick = 0;
    const engine = new BrowserRuleEngine({
      rules: () => [rule],
      bars: () => [],
      quote: () => quote,
      ensure: async () => {},
      fire,
      now: () => NOW + (tick += 5000),
    });
    const move = (price: number) => {
      quote.previous = quote.price;
      quote.price = price;
      engine.onPrice("BTCUSDT");
    };
    return { engine, fire, move };
  };
  it("fires once when a live price crosses the line, not before and not again", () => {
    const { engine, fire, move } = make(drawn);
    engine.onPrice("BTCUSDT");
    move(119);
    expect(fire).not.toHaveBeenCalled();
    move(121);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls[0][1].message).toContain("trendline");
    move(122);
    move(123);
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it("stays silent for a line that has ended", () => {
    const { engine, fire, move } = make({ ...drawn, style: {} });
    engine.onPrice("BTCUSDT");
    move(119);
    move(121);
    expect(fire).not.toHaveBeenCalled();
  });
});