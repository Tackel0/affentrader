import { describe, expect, it, vi } from "vitest";
import {
  EdgeTracker,
  evaluateCondition,
  isQuoteOnly,
  leafCount,
  requiredViews,
  validateCondition,
  type MarketView,
} from "@/lib/alerts/rules";
import { BrowserRuleEngine } from "@/lib/alerts/browserEngine";
import type { AlertRule, Condition, Leaf } from "@/types/alerts";
import type { OHLCV } from "@/types/trading";

const bars = (closes: number[], volume = 100): OHLCV[] =>
  closes.map((close, i) => ({
    time: i * 60_000,
    open: close - 0.2,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume,
  }));
const view = (closes: number[], quote?: MarketView["quote"]): MarketView => ({ bars: bars(closes), quote });
const resolver = (map: Record<string, MarketView>) => (symbol: string, tf: string) => map[`${symbol}:${tf}`];
const leaf = (l: Leaf): Condition => ({ op: "leaf", leaf: l });
const scope = { symbol: "BTCUSDT", timeframe: "15m" };

describe("condition evaluation", () => {
  it("compares price with an indicator and detects crossings", () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + i);
    const dip = [...up.slice(0, 30), 90, 91, 92, 93, 94, 95, 96, 97, 98, 140];
    const condition = leaf({
      type: "compare",
      left: { type: "price", field: "close" },
      comparator: "crossing_up",
      right: { type: "indicator", indicator: "ema", params: { length: 10 } },
    });
    const result = evaluateCondition(condition, scope, resolver({ "BTCUSDT:15m": view(dip) }));
    expect(result.met).toBe(true);
    expect(result.detail).toContain("close crosses above EMA(10)");
    const quiet = evaluateCondition(condition, scope, resolver({ "BTCUSDT:15m": view(up) }));
    expect(quiet.met).toBe(false);
  });
  it("evaluates RSI thresholds and bands", () => {
    const falling = Array.from({ length: 40 }, (_, i) => 200 - i * 2);
    const rsiLow = leaf({
      type: "compare",
      left: { type: "indicator", indicator: "rsi", params: { length: 14 } },
      comparator: "<",
      right: { type: "number", value: 30 },
    });
    expect(evaluateCondition(rsiLow, scope, resolver({ "BTCUSDT:15m": view(falling) })).met).toBe(true);
    const band = leaf({
      type: "band",
      operand: { type: "quote", field: "price" },
      low: 100,
      high: 110,
      mode: "entering",
    });
    const entering = evaluateCondition(
      band,
      scope,
      resolver({ "BTCUSDT:15m": { bars: [], quote: { price: 105, previous: 99, changePercent: 0, volume: 0, high: 0, low: 0 } } }),
    );
    expect(entering.met).toBe(true);
  });
  it("detects price change, volume spikes, new highs and patterns", () => {
    const closes = [...Array.from({ length: 30 }, () => 100), 108];
    expect(
      evaluateCondition(leaf({ type: "change", percent: 5, bars: 1, direction: "up" }), scope, resolver({ "BTCUSDT:15m": view(closes) })).met,
    ).toBe(true);
    const spike = bars(closes);
    spike[spike.length - 1].volume = 1000;
    expect(
      evaluateCondition(leaf({ type: "volume_spike", multiple: 3, length: 20 }), scope, resolver({ "BTCUSDT:15m": { bars: spike } })).met,
    ).toBe(true);
    expect(
      evaluateCondition(leaf({ type: "extreme", kind: "high", length: 20 }), scope, resolver({ "BTCUSDT:15m": view(closes) })).met,
    ).toBe(true);
    const hammer = bars(Array.from({ length: 30 }, (_, i) => 130 - i * 2));
    hammer.push({ time: 30 * 60_000, open: 70.5, high: 71.4, low: 65, close: 71.2, volume: 100 });
    expect(
      evaluateCondition(leaf({ type: "pattern", patternId: "hammer" }), scope, resolver({ "BTCUSDT:15m": { bars: hammer } })).met,
    ).toBe(true);
  });
  it("combines conditions across symbols with all/any", () => {
    const condition: Condition = {
      op: "all",
      conditions: [
        leaf({ type: "compare", left: { type: "quote", field: "price" }, comparator: ">", right: { type: "number", value: 100 } }),
        leaf({
          type: "compare",
          symbol: "ETHUSDT",
          left: { type: "quote", field: "changePercent" },
          comparator: ">",
          right: { type: "number", value: 2 },
        }),
      ],
    };
    const quote = (price: number, changePercent: number) => ({ price, previous: price, changePercent, volume: 0, high: 0, low: 0 });
    const markets = {
      "BTCUSDT:15m": { bars: [], quote: quote(120, 0) },
      "ETHUSDT:15m": { bars: [], quote: quote(10, 3) },
    };
    expect(evaluateCondition(condition, scope, resolver(markets)).met).toBe(true);
    markets["ETHUSDT:15m"].quote = quote(10, 1);
    expect(evaluateCondition(condition, scope, resolver(markets)).met).toBe(false);
    const any = { ...condition, op: "any" } as Condition;
    expect(evaluateCondition(any, scope, resolver(markets)).met).toBe(true);
    const missing = evaluateCondition(condition, scope, resolver({ "BTCUSDT:15m": markets["BTCUSDT:15m"] }));
    expect(missing.incomplete).toBe(true);
    expect(requiredViews(condition, scope).map((v) => v.symbol).sort()).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(isQuoteOnly(condition)).toBe(true);
    expect(leafCount(condition)).toBe(2);
  });
  it("validates conditions before they are saved", () => {
    expect(validateCondition({ op: "all", conditions: [] })).toMatch(/at least one/);
    expect(validateCondition({ op: "leaf", leaf: { type: "band", operand: { type: "quote", field: "price" }, low: 5, high: 1, mode: "inside" } })).toMatch(/upper/);
    expect(validateCondition({ op: "leaf", leaf: { type: "compare", left: { type: "indicator", indicator: "nope" }, comparator: ">", right: { type: "number", value: 1 } } })).toMatch(/Unknown indicator/);
    expect(validateCondition(leaf({ type: "change", percent: 1, bars: 3, direction: "up" }))).toBeNull();
  });
});

describe("edge tracking", () => {
  it("fires only on false to true and honors the cooldown", () => {
    const edges = new EdgeTracker();
    expect(edges.update("a", true, 0, 1000)).toBe(true);
    expect(edges.update("a", true, 10, 1000)).toBe(false);
    expect(edges.update("a", false, 20, 1000)).toBe(false);
    expect(edges.update("a", true, 500, 1000)).toBe(false);
    expect(edges.update("a", false, 600, 1000)).toBe(false);
    expect(edges.update("a", true, 1500, 1000)).toBe(true);
  });
});

describe("browser rule engine", () => {
  const rule = (patch: Partial<AlertRule> = {}): AlertRule => ({
    id: "r1",
    name: "BTC above 100",
    kind: "technical",
    status: "active",
    scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "15m" },
    condition: leaf({ type: "compare", left: { type: "quote", field: "price" }, comparator: ">", right: { type: "number", value: 100 } }),
    frequency: "tick",
    repeat: false,
    cooldownMs: 0,
    sound: false,
    browserNotification: false,
    serverSide: false,
    createdAt: 0,
    ...patch,
  });
  const make = (rules: AlertRule[]) => {
    let price = 90;
    const fire = vi.fn();
    let now = 0;
    const engine = new BrowserRuleEngine({
      rules: () => rules,
      bars: () => [],
      quote: () => ({ price, previous: price, changePercent: 0, volume: 0, high: 0, low: 0 }),
      ensure: async () => {},
      fire,
      now: () => (now += 2000),
    });
    return { engine, fire, setPrice: (p: number) => (price = p) };
  };
  it("fires once when a tick rule becomes true", () => {
    const { engine, fire, setPrice } = make([rule()]);
    engine.onPrice("BTCUSDT");
    expect(fire).not.toHaveBeenCalled();
    setPrice(101);
    engine.onPrice("BTCUSDT");
    engine.onPrice("BTCUSDT");
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls[0][1].message).toContain("BTCUSDT");
  });
  it("evaluates every symbol of a watchlist rule independently", () => {
    const { engine, fire, setPrice } = make([
      rule({ repeat: true, scope: { type: "watchlist", listId: "l", symbols: ["BTCUSDT", "ETHUSDT"], timeframe: "15m" } }),
    ]);
    setPrice(50);
    engine.onPrice("BTCUSDT");
    engine.onPrice("ETHUSDT");
    setPrice(120);
    engine.onPrice("BTCUSDT");
    engine.onPrice("ETHUSDT");
    expect(fire.mock.calls.map((c) => c[1].symbol).sort()).toEqual(["BTCUSDT", "ETHUSDT"]);
  });
  it("does not fire for a condition that is already true when the rule is created", () => {
    const { engine, fire, setPrice } = make([rule()]);
    setPrice(500);
    engine.prime();
    engine.onPrice("BTCUSDT");
    expect(fire).not.toHaveBeenCalled();
    setPrice(50);
    engine.onPrice("BTCUSDT");
    setPrice(500);
    engine.onPrice("BTCUSDT");
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it("ignores paused and server-side rules", () => {
    const { engine, fire, setPrice } = make([rule({ status: "paused" }), rule({ id: "r2", serverSide: true })]);
    setPrice(500);
    engine.onPrice("BTCUSDT");
    expect(fire).not.toHaveBeenCalled();
  });
  it("evaluates close rules only when their timeframe closes", () => {
    const fire = vi.fn();
    let now = 15 * 60_000;
    const candles = [{ time: 0, open: 90, high: 90, low: 90, close: 90, volume: 1 }];
    const engine = new BrowserRuleEngine({ rules: () => [rule({ frequency: "close" })], bars: () => candles,
      quote: () => ({ price: 500, previous: 500, changePercent: 0, high: 500, low: 500, volume: 1 }), ensure: async () => {}, fire, now: () => now });
    engine.onClose("BTCUSDT", "15m", 0);
    candles.push({ time: 15 * 60_000, open: 110, high: 110, low: 110, close: 110, volume: 1 });
    now += 15 * 60_000;
    engine.onPrice("BTCUSDT");
    engine.onClose("BTCUSDT", "1h");
    expect(fire).not.toHaveBeenCalled();
    engine.onClose("BTCUSDT", "15m", 15 * 60_000);
    expect(fire).toHaveBeenCalledTimes(1);
  });
});
