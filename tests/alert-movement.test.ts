import { describe, expect, it, vi } from "vitest";
import type { AlertRule, Condition, Leaf } from "@/types/alerts";
import type { OHLCV } from "@/types/trading";
import { measureMovement } from "@/lib/alerts/movement";
import { describeCondition, evaluateCondition, isQuoteOnly, requiredHistoryViews, validateCondition, type MarketView } from "@/lib/alerts/rules";
import { stepRule } from "@/lib/alerts/runtime";
import { BrowserRuleEngine } from "@/lib/alerts/browserEngine";
import { ruleMarketSubscriptions } from "@/lib/alerts/dependencies";
import { parseWorkspace } from "@/lib/workspace";

const minute = 60_000;
const candle = (close: number, i: number): OHLCV => ({ time: i * minute, open: close, high: close + 1, low: close - 1, close, volume: 100 + i * 10 });
const bars = (values: number[]) => values.map(candle);
const movement = (patch: Partial<Extract<Leaf, { type: "movement" }>> = {}): Extract<Leaf, { type: "movement" }> => ({
  type: "movement", operand: { type: "price", field: "close" }, direction: "up", unit: "absolute", amount: 5, bars: 2, ...patch,
});
const condition = (patch: Partial<Extract<Leaf, { type: "movement" }>> = {}): Condition => ({ op: "leaf", leaf: movement(patch) });
const rule = (patch: Partial<AlertRule> = {}): AlertRule => ({
  id: "movement", name: "Movement", kind: "technical", status: "active", scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "1m" },
  condition: condition(), trigger: "once_per_bar", frequency: "tick", repeat: true, cooldownMs: 0, sound: false, browserNotification: false, serverSide: false, createdAt: 0, ...patch,
});
const evaluate = (values: number[], patch: Partial<Extract<Leaf, { type: "movement" }>> = {}, extra: Partial<MarketView> = {}) =>
  evaluateCondition(condition(patch), { symbol: "BTCUSDT", timeframe: "1m" }, () => ({ bars: bars(values), ...extra }));

describe("movement measurements", () => {
  it.each([
    { values: [100, 101, 105], direction: "up" as const, unit: "absolute" as const, amount: 5 },
    { values: [100, 99, 95], direction: "down" as const, unit: "absolute" as const, amount: 5 },
    { values: [200, 202, 210], direction: "up" as const, unit: "percent" as const, amount: 5 },
    { values: [200, 198, 190], direction: "down" as const, unit: "percent" as const, amount: 5 },
  ])("includes exact $direction $unit thresholds", ({ values, direction, unit, amount }) => {
    expect(evaluate(values, { direction, unit, amount })).toMatchObject({ met: true, incomplete: false });
    expect(evaluate(values, { direction, unit, amount: amount + 0.01 }).met).toBe(false);
    expect(evaluate(values, { direction: direction === "up" ? "down" : "up", unit, amount }).met).toBe(false);
  });
  it("uses the selected N-bar reference rather than extrema or a different lookback", () => {
    expect(evaluate([110, 90, 112], { amount: 10, bars: 2 }).met).toBe(false);
    expect(evaluate([110, 90, 112], { amount: 10, bars: 1 }).met).toBe(true);
  });
  it("supports zero and negative source values without reversing the movement direction", () => {
    expect(measureMovement([-20, -15, -10], 2, "percent")?.change).toBe(50);
    expect(evaluate([0, 1, 5]).met).toBe(true);
    expect(evaluate([0, 1, 5], { unit: "percent" })).toMatchObject({ met: false, incomplete: true });
  });
  it("rejects unavailable reference values, fractional indices and overflowing results", () => {
    expect(measureMovement([100], 2, "absolute")).toBeUndefined();
    expect(measureMovement([NaN, 100, 110], 2, "absolute")).toBeUndefined();
    expect(measureMovement([100, 105, 110], 1.5, "absolute")).toBeUndefined();
    expect(measureMovement([-Number.MAX_VALUE, 1, Number.MAX_VALUE], 2, "absolute")).toBeUndefined();
    expect(evaluate([100, 110])).toMatchObject({ incomplete: true, met: false });
  });
  it("uses the chosen candle source and volume units", () => {
    expect(evaluate([100, 100, 100], { operand: { type: "price", field: "volume" }, amount: 20 }).met).toBe(true);
    expect(evaluate([100, 100, 100], { operand: { type: "price", field: "hlc3" }, amount: 1 }).met).toBe(false);
  });
  it("evaluates actual indicator lines, includes their warm-up and validates plot selection", () => {
    const operand = { type: "indicator" as const, indicator: "ema", params: { length: 3 }, plot: "ema" };
    expect(evaluate([100, 100, 100, 102, 104], { operand, amount: 2.5, bars: 2 })).toMatchObject({ met: true, incomplete: false });
    expect(evaluate([100, 102, 104], { operand, amount: 2.5, bars: 2 })).toMatchObject({ met: false, incomplete: true });
    expect(validateCondition(condition({ operand: { ...operand, plot: "missing" } }))).toMatch(/output/);
    expect(validateCondition(condition({ operand: { ...operand, params: { length: 0 } } }))).toMatch(/input/);
    expect(validateCondition(condition({ operand: { ...operand, params: { length: 2.5 } } }))).toMatch(/whole/);
  });
  it("excludes future candles at the evaluation clock and never substitutes a provider quote", () => {
    expect(evaluate([100, 100, 101, 500], { bars: 2 }, { at: 2 * minute })).toMatchObject({ met: false, incomplete: false });
    expect(evaluate([100, 100, 101], {}, { quote: { price: 1000, previous: 1000, changePercent: 900, volume: 0, high: 1000, low: 100 } }).met).toBe(false);
  });
  it("describes all operators and retains non-price source units", () => {
    expect(describeCondition(condition({ direction: "down", unit: "percent", amount: 2.5, bars: 5 }))).toBe("close moving down 2.5% in 5 bars");
    expect(describeCondition(condition({ operand: { type: "indicator", indicator: "rsi", params: { length: 14 } } }))).toContain("RSI(14) moving up 5 units");
  });
});

describe("movement rule safety", () => {
  it.each([
    { amount: 0 }, { amount: -1 }, { amount: Infinity }, { bars: 0 }, { bars: -1 }, { bars: 1.5 }, { bars: 20_000 },
    { direction: "sideways" }, { unit: "ticks" }, { operand: { type: "quote", field: "price" } },
    { operand: { type: "price", field: "missing" } }, { operand: { type: "indicator", indicator: "missing" } },
  ])("rejects invalid movement %j", patch => {
    expect(validateCondition({ op: "leaf", leaf: { ...movement(), ...patch } })).toBeTypeOf("string");
  });
  it("rejects unknown leaf and operand types before server storage or import", () => {
    expect(validateCondition({ op: "leaf", leaf: { type: "mvoement" } })).toMatch(/Unknown condition/);
    expect(validateCondition({ op: "leaf", leaf: { ...movement(), operand: { type: "untrusted" } } })).toMatch(/Unknown operand/);
  });
  it("round-trips the full movement definition through actual workspace validation", () => {
    const data = { version: 1, chart: { state: { symbol: "BTCUSDT", timeframe: "1m", chartType: "candles", feedMode: "auto", indicators: [], drawings: {}, pineLibraries: {} } },
      watchlists: { state: { lists: [{ id: "a", name: "Crypto", symbols: ["BTCUSDT"] }], activeId: "a" } },
      alerts: { state: { alerts: [], logs: [], rules: [rule({ condition: condition({ unit: "percent", direction: "down", amount: 3, bars: 10 }) })] } } };
    expect(parseWorkspace(JSON.stringify(data)).alerts.state.rules).toEqual(data.alerts.state.rules);
    data.alerts.state.rules[0].condition = condition({ bars: 0 });
    expect(() => parseWorkspace(JSON.stringify(data))).toThrow(/Movement lookback/);
  });
});

describe("movement data and cadence", () => {
  it("loads the deepest shared series and the selected indicator's reference warm-up", () => {
    const nested: Condition = { op: "all", conditions: [condition({ bars: 500 }), condition({ bars: 700, operand: { type: "indicator", indicator: "ema", params: { length: 100 } } }), condition({ bars: 600, symbol: "HL:xyz:BRENTOIL", timeframe: "5m" })] };
    expect(requiredHistoryViews(nested, { symbol: "BTCUSDT", timeframe: "1m" })).toEqual([
      { symbol: "BTCUSDT", timeframe: "1m", count: 1002 }, { symbol: "HL:xyz:BRENTOIL", timeframe: "5m", count: 602 },
    ]);
    expect(isQuoteOnly(nested)).toBe(false);
    expect(ruleMarketSubscriptions([rule({ condition: nested })])).toEqual({ streams: ["BTCUSDT", "HL:xyz:BRENTOIL"], quotes: [] });
  });
  it("upgrades a prepared history after editing the lookback without redundant requests", async () => {
    let rules = [rule({ condition: condition({ bars: 500 }) }), rule({ id: "shared", condition: condition({ bars: 700 }) })];
    const ensure = vi.fn(async () => undefined);
    const engine = new BrowserRuleEngine({ rules: () => rules, bars: () => bars([100]), quote: () => undefined, ensure, fire: vi.fn(), now: () => 0 });
    await engine.prepare();
    expect(ensure.mock.calls).toHaveLength(1);
    expect(ensure).toHaveBeenLastCalledWith("BTCUSDT", "1m", 702);
    await engine.prepare(); expect(ensure).toHaveBeenCalledTimes(1);
    rules = [rule({ condition: condition({ bars: 1500 }) })];
    await engine.prepare(); expect(ensure).toHaveBeenLastCalledWith("BTCUSDT", "1m", 1502);
  });
  it("runs after candle aggregation, observes cross-market leaves and gates the current bar", () => {
    const r = rule({ condition: condition({ symbol: "ETHUSDT" }) });
    const other = bars([100, 100, 101]);
    const fire = vi.fn();
    const engine = new BrowserRuleEngine({ rules: () => [r], bars: symbol => symbol === "ETHUSDT" ? other : bars([50, 50, 50]),
      quote: symbol => ({ price: symbol === "ETHUSDT" ? other.at(-1)!.close : 50, previous: 50, changePercent: 0, high: 200, low: 1, volume: 1 }), ensure: async () => {}, fire, now: () => 2 * minute + 1 });
    engine.prime(); other[2].close = 105;
    engine.onPrice("ETHUSDT", "quote"); expect(fire).not.toHaveBeenCalled();
    engine.onPrice("ETHUSDT", "trade"); engine.onPrice("ETHUSDT", "trade");
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls[0][1]).toMatchObject({ symbol: "BTCUSDT", price: 50 });
  });
  it("uses confirmed values, excluding a later live candle from the movement window", () => {
    const r = rule({ trigger: "once_per_close", frequency: "close", condition: condition({ bars: 2 }) });
    const current = bars([100, 100, 101, 105]);
    const resolve = () => ({ bars: current });
    const first = stepRule(r, "BTCUSDT", undefined, resolve, 3 * minute);
    expect(first.evaluation?.met).toBe(false);
    current.push(candle(1000, 4));
    const next = stepRule(r, "BTCUSDT", first.state, resolve, 4 * minute);
    expect(next.fire).toBe(true);
    expect(next.evaluation?.price).toBe(105);
  });
  it("keeps held state during a missing percentage baseline and supports actual tick bars", () => {
    const r = rule({ trigger: undefined, condition: condition({ unit: "percent" }) });
    const view = (values: number[]) => () => ({ bars: bars(values) });
    const first = stepRule(r, "BTCUSDT", undefined, view([100, 100, 110]), 2 * minute);
    expect(first.state.met).toBe(true);
    const missing = stepRule(r, "BTCUSDT", first.state, view([0, 100, 110]), 2 * minute + 1);
    expect(missing.evaluation?.incomplete).toBe(true); expect(missing.state.met).toBe(true);
    expect(stepRule(r, "BTCUSDT", missing.state, view([100, 100, 110]), 2 * minute + 2).fire).toBe(false);
    const tickRule = rule({ scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "100T" } });
    const tickBars = [{ ...candle(100, 0), time: 1000 }, { ...candle(100, 1), time: 2000 }, { ...candle(101, 2), time: 3000 }];
    const seeded = stepRule(tickRule, "BTCUSDT", undefined, () => ({ bars: tickBars }), 3001);
    tickBars[2].close = 105;
    const fired = stepRule(tickRule, "BTCUSDT", seeded.state, () => ({ bars: tickBars }), 3002);
    expect(fired.fire).toBe(true); expect(fired.state.firedBar).toBe(3000);
  });
  it("counts collected tick bars whose synthetic grid has advanced beyond the wall clock", () => {
    const r = rule({ scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "100T" } });
    const collected = bars([100, 100, 101]);
    const read = () => ({ bars: collected });
    const seeded = stepRule(r, "BTCUSDT", undefined, read, 1000);
    expect(seeded.evaluation?.incomplete).toBe(false);
    collected[2].close = 105;
    const fired = stepRule(r, "BTCUSDT", seeded.state, read, 1001);
    expect(fired.fire).toBe(true); expect(fired.state.firedBar).toBe(120_000);
    expect(stepRule(r, "BTCUSDT", fired.state, read, 1002).fire).toBe(false);
  });
});
