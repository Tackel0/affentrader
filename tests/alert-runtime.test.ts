import { describe, expect, it, vi } from "vitest";
import type { AlertRule, Condition } from "@/types/alerts";
import type { OHLCV } from "@/types/trading";
import { stepRule, closeView, type RuleRuntimeState } from "@/lib/alerts/runtime";
import { BrowserRuleEngine } from "@/lib/alerts/browserEngine";
import { normalizeRuleMarkets, ruleMarketSubscriptions } from "@/lib/alerts/dependencies";
import { AlertEvaluator } from "@/lib/alerts/engine";
import { basicMetrics, pendingRange } from "@/lib/market/quoteMetrics";
import type { MarketView } from "@/lib/alerts/rules";

const MINUTE = 60_000, NOW = 1_800_000_000_000;
const compare = (field: "price" | "volume" = "price", comparator: "crossing" | "crossing_up" | ">" = "crossing_up", value = 100): Condition => ({ op: "leaf", leaf: { type: "compare", left: { type: "quote", field }, comparator, right: { type: "number", value } } });
const rule = (patch: Partial<AlertRule> = {}): AlertRule => ({ id: "r", name: "Observed crossing", kind: "technical", status: "active", scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "1m" }, condition: compare(), frequency: "tick", repeat: true, cooldownMs: 0, sound: false, browserNotification: false, serverSide: false, createdAt: NOW, ...patch });
const quote = (price: number, time = NOW): NonNullable<MarketView["quote"]> => ({ price, previous: price, high: price, low: price, volume: 10, changePercent: 0, time, simulated: false });
const candle = (time: number, close: number): OHLCV => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 1 });

describe("observed rule state", () => {
  it("crosses using persisted observations even when providers return previous=current", () => {
    let current = quote(99);
    const resolve = () => ({ bars: [], quote: current });
    const first = stepRule(rule(), "BTCUSDT", undefined, resolve, NOW);
    expect(first.fire).toBe(false);
    current = quote(100, NOW + 1);
    const next = stepRule(rule(), "BTCUSDT", JSON.parse(JSON.stringify(first.state)), resolve, NOW + 1);
    expect(next.fire).toBe(true);
    current = quote(101, NOW + 2);
    expect(stepRule(rule(), "BTCUSDT", next.state, resolve, NOW + 2).fire).toBe(false);
  });
  it("fires consecutive up/down events and never repeats a threshold departure", () => {
    let state: RuleRuntimeState | undefined;
    const fired = [99, 101, 99, 100, 101, 100, 100].map((price, i) => {
      const step = stepRule(rule({ condition: compare("price", "crossing") }), "BTCUSDT", state, () => ({ bars: [], quote: quote(price, NOW + i) }), NOW + i);
      state = step.state; return step.fire;
    });
    expect(fired).toEqual([false, true, true, true, false, true, false]);
  });
  it("uses prior reported volume rather than the current quantity twice", () => {
    const run = (volume: number, state?: RuleRuntimeState) => stepRule(rule({ condition: compare("volume", "crossing_up", 12) }), "BTCUSDT", state,
      () => ({ bars: [], quote: { ...quote(100), volume, metrics: basicMetrics("BTCUSDT", volume, 1000, 110, 90, "24h", NOW) } }), NOW);
    const first = run(11);
    expect(run(12, first.state).fire).toBe(true);
  });
  it("tracks a moving line at the previous observation's time", () => {
    const condition: Condition = { op: "leaf", leaf: { type: "compare", left: { type: "quote", field: "price" }, comparator: "crossing_down", right: { type: "line", from: { time: NOW, price: 90 }, to: { time: NOW + 10_000, price: 110 }, extend: "both" } } };
    const lineRule = rule({ condition });
    const first = stepRule(lineRule, "BTCUSDT", undefined, () => ({ bars: [], quote: quote(100, NOW + 1000) }), NOW + 1000);
    expect(stepRule(lineRule, "BTCUSDT", first.state, () => ({ bars: [], quote: quote(100, NOW + 9000) }), NOW + 9000).fire).toBe(true);
  });
  it("preserves a held state across missing data and seeds a new rule only when data arrives", () => {
    const above = rule({ condition: compare("price", ">") });
    const first = stepRule(above, "BTCUSDT", undefined, () => undefined, NOW);
    const ready = stepRule(above, "BTCUSDT", first.state, () => ({ bars: [], quote: quote(110, NOW + 1) }), NOW + 1);
    expect(ready.fire).toBe(false);
    const missing = stepRule(above, "BTCUSDT", ready.state, () => undefined, NOW + 2);
    expect(missing.state.met).toBe(true);
    expect(stepRule(above, "BTCUSDT", missing.state, () => ({ bars: [], quote: quote(120, NOW + 3) }), NOW + 3).fire).toBe(false);
  });
  it("rejects stale observations and seeds source changes without crossing", () => {
    const first = stepRule(rule(), "BTCUSDT", undefined, () => ({ bars: [], quote: quote(90) }), NOW);
    const stale = stepRule(rule(), "BTCUSDT", first.state, () => ({ bars: [], quote: quote(110, NOW - 1) }), NOW + 1);
    expect(stale.state).toBe(first.state); expect(stale.fire).toBe(false);
    const simulated = stepRule(rule(), "BTCUSDT", first.state, () => ({ bars: [], quote: { ...quote(110, NOW + 2), simulated: true } }), NOW + 2);
    expect(simulated.fire).toBe(false);
    expect(simulated.state.initialized).toBe(true);
  });
  it("keeps JSON-safe samples when metrics disappear", () => {
    const q = quote(100); q.metrics = { ...basicMetrics("HL:BTC", null, 1000, 0, 0, "24h", NOW), range: pendingRange(NOW) };
    const step = stepRule(rule(), "BTCUSDT", undefined, () => ({ bars: [], quote: q }), NOW);
    expect(step.state.quotes!["BTCUSDT|1m"].fields).toEqual({ price: 100, changePercent: 0 });
    expect(JSON.stringify(step.state)).not.toContain("null");
  });
  it("applies cooldown after the first firing without replaying suppressed crossings", () => {
    const r = rule({ cooldownMs: 1000 });
    let state: RuleRuntimeState | undefined;
    const move = (price: number, at: number) => {
      const step = stepRule(r, "BTCUSDT", state, () => ({ bars: [], quote: quote(price, at) }), at);
      state = step.state; return step.fire;
    };
    expect(move(90, 1)).toBe(false);
    expect(move(100, 2)).toBe(true);
    move(90, 3); expect(move(100, 4)).toBe(false);
    expect(move(101, 2000)).toBe(false);
    move(90, 2001); expect(move(100, 2002)).toBe(true);
  });
});

describe("confirmed-bar evaluation", () => {
  it("uses the confirmed close, includes a quiet market's final candle, and excludes live quote metrics", () => {
    const view = closeView({ bars: [candle(NOW - MINUTE, 90)], quote: quote(999, NOW + 1) }, "1m", NOW);
    expect(view.bars).toHaveLength(1);
    expect(view.quote!.price).toBe(90);
    expect(view.quote!.volume).toBeNaN();
  });
  it("does not let intrabar prices satisfy a close rule or evaluate the same close twice", () => {
    const r = rule({ frequency: "close" });
    const rows = [candle(NOW - MINUTE, 90), candle(NOW, 110)];
    const resolve = () => ({ bars: rows, quote: quote(999, NOW + MINUTE + 1) });
    const first = stepRule(r, "BTCUSDT", undefined, resolve, NOW + 10_000);
    expect(first.evaluation!.price).toBe(90); expect(first.fire).toBe(false);
    const open = stepRule(r, "BTCUSDT", first.state, resolve, NOW + 30_000);
    expect(open.evaluation).toBeUndefined();
    const closed = stepRule(r, "BTCUSDT", first.state, resolve, NOW + MINUTE);
    expect(closed.fire).toBe(true); expect(closed.evaluation!.price).toBe(110);
    expect(stepRule(r, "BTCUSDT", JSON.parse(JSON.stringify(closed.state)), resolve, NOW + MINUTE + 20_000).fire).toBe(false);
  });
  it("aligns higher and lower interval conditions to the same confirmed boundary", () => {
    const r = rule({ frequency: "close", scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "1h" }, condition: { op: "all", conditions: [
      { op: "leaf", leaf: { type: "compare", left: { type: "price", field: "close" }, comparator: ">", right: { type: "number", value: 80 } } },
      { op: "leaf", leaf: { type: "compare", timeframe: "1m", left: { type: "price", field: "close" }, comparator: "crossing_up", right: { type: "number", value: 100 } } },
    ] } });
    const resolve = (_symbol: string, tf: string) => ({ bars: tf === "1h" ? [candle(NOW - 3_600_000, 90), candle(NOW, 200)] : [candle(NOW - MINUTE, 90), candle(NOW, 110)], quote: quote(999, NOW) });
    const first = stepRule(r, "BTCUSDT", undefined, resolve, NOW);
    const next = stepRule(r, "BTCUSDT", first.state, resolve, NOW + MINUTE);
    expect(next.fire).toBe(true); expect(next.evaluation!.price).toBe(90);
  });
});

describe("browser update routing and lifecycle", () => {
  it("fires a one-shot watchlist rule independently once per symbol", () => {
    const r = rule({ repeat: false, scope: { type: "watchlist", listId: "w", symbols: ["BTCUSDT", "ETHUSDT"], timeframe: "1m" } });
    let price = 90; const fire = vi.fn();
    const engine = new BrowserRuleEngine({ rules: () => [r], bars: () => [], quote: () => quote(price), ensure: async () => {}, fire });
    engine.prime(); price = 100; engine.onPrice("BTCUSDT"); engine.onPrice("ETHUSDT");
    engine.onPrice("BTCUSDT"); engine.onPrice("ETHUSDT");
    expect(fire).toHaveBeenCalledTimes(2);
  });
  it("uses the smallest configured interval for close events and ignores duplicate boundaries", () => {
    const condition: Condition = { op: "all", conditions: [compare("price", ">", 80), { op: "leaf", leaf: { type: "compare", timeframe: "1m", left: { type: "price", field: "close" }, comparator: "crossing_up", right: { type: "number", value: 100 } } }] };
    const r = rule({ frequency: "close", scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "1h" }, condition });
    let now = NOW; const fire = vi.fn();
    const engine = new BrowserRuleEngine({ rules: () => [r], bars: (_s, tf) => tf === "1h" ? [candle(NOW - 3_600_000, 90), candle(NOW, 200)] : [candle(NOW - MINUTE, 90), candle(NOW, 110)], quote: () => quote(999, now), ensure: async () => {}, fire, now: () => now });
    engine.prime(); now += MINUTE;
    engine.onClose("BTCUSDT", "1h", NOW - 3_600_000); expect(fire).not.toHaveBeenCalled();
    engine.onClose("BTCUSDT", "1m", NOW); engine.onClose("BTCUSDT", "1m", NOW);
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it("does not lose same-millisecond crosses or double-evaluate quote/trade delivery", () => {
    let price = 99;
    const fire = vi.fn(), r = rule();
    const engine = new BrowserRuleEngine({ rules: () => [r], bars: () => [], quote: () => quote(price), ensure: async () => {}, fire, now: () => NOW });
    engine.prime();
    price = 100; engine.onPrice("BTCUSDT", "quote"); engine.onPrice("BTCUSDT", "trade");
    price = 99; engine.onPrice("BTCUSDT", "quote");
    price = 100; engine.onPrice("BTCUSDT", "quote");
    expect(fire).toHaveBeenCalledTimes(2);
  });
  it("evaluates technical rules after aggregation, and dependent markets wake the owning rule", () => {
    let rows = [candle(NOW, 90)];
    const r = rule({ condition: { op: "leaf", leaf: { type: "compare", symbol: "HL:xyz:TSLA", left: { type: "price", field: "close" }, comparator: ">", right: { type: "number", value: 100 } } } });
    const fire = vi.fn();
    const engine = new BrowserRuleEngine({ rules: () => [r], bars: () => rows, quote: () => quote(100), ensure: async () => {}, fire, now: () => NOW });
    engine.prime();
    engine.onPrice("HL:xyz:TSLA", "quote");
    rows = [candle(NOW, 110)]; engine.onPrice("HL:xyz:TSLA", "trade");
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls[0][1].symbol).toBe("BTCUSDT");
  });
  it("re-baselines after a source restart and retries histories", async () => {
    let price = 90;
    const r = rule({ condition: compare("price", ">") }), fire = vi.fn();
    const engine = new BrowserRuleEngine({ rules: () => [r], bars: () => [], quote: () => quote(price), ensure: async () => {}, fire });
    engine.prime(); engine.invalidateData(); price = 110; engine.onPrice("BTCUSDT");
    expect(fire).not.toHaveBeenCalled();
    price = 90; engine.onPrice("BTCUSDT"); price = 110; engine.onPrice("BTCUSDT");
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it("loads close-rule candles, retries empty responses, and clears missing markers after recovery", async () => {
    let rows: OHLCV[] = [];
    const ensure = vi.fn(async () => {}), r = rule({ frequency: "close" });
    const engine = new BrowserRuleEngine({ rules: () => [r], bars: () => rows, quote: () => quote(100), ensure, fire: vi.fn() });
    await engine.prepare(); expect(engine.missing).toEqual(["BTCUSDT:1m"]);
    rows = [candle(NOW - MINUTE, 100)]; await engine.prepare();
    expect(ensure).toHaveBeenCalledTimes(2); expect(engine.missing).toEqual([]);
    await engine.prepare(); expect(ensure).toHaveBeenCalledTimes(2);
  });
  it("normalizes aliases and watchlist sections while preserving case-sensitive builder markets", () => {
    const normalized = normalizeRuleMarkets(rule({ scope: { type: "watchlist", listId: "l", symbols: ["###Perps", "HL:xyz:TSLA", "HL:kPEPE", "btc/usdt"], timeframe: "1m" }, condition: { op: "leaf", leaf: { type: "compare", symbol: "HL:xyz:TSLA", left: { type: "quote", field: "price" }, comparator: ">", right: { type: "number", value: 100 } } } }));
    expect(normalized.scope).toMatchObject({ symbols: ["HL:xyz:TSLA", "HL:kPEPE", "BTCUSDT"] });
    expect(ruleMarketSubscriptions([normalized])).toEqual({ streams: [], quotes: ["BTCUSDT", "HL:kPEPE", "HL:xyz:TSLA"] });
  });
  it("subscribes to candle-dependent leaf markets and quote-only watchlists", () => {
    const r = rule({ condition: { op: "leaf", leaf: { type: "compare", symbol: "YF:SAP.DE", left: { type: "price", field: "close" }, comparator: ">", right: { type: "number", value: 100 } } } });
    expect(ruleMarketSubscriptions([r, rule({ id: "q", scope: { type: "watchlist", listId: "w", symbols: ["HL:BTC", "HL:ETH"], timeframe: "1m" } })])).toEqual({ streams: ["BTCUSDT", "YF:SAP.DE"], quotes: ["HL:BTC", "HL:ETH"] });
  });
  it("lets the basic price engine process distinct prices sharing a timestamp", () => {
    const engine = new AlertEvaluator();
    const alert = { id: "p", name: "p", symbol: "BTCUSDT", condition: "crossing_up" as const, price: 100, status: "active" as const, repeat: true, frequency: "tick" as const, timeframe: "1m", sound: false, browserNotification: false, simulated: false, createdAt: NOW };
    expect(engine.evaluate([alert], "BTCUSDT", 99, NOW, false, "tick")).toEqual([]);
    expect(engine.evaluate([alert], "BTCUSDT", 100, NOW, false, "tick")).toEqual(["p"]);
    expect(engine.evaluate([alert], "BTCUSDT", 100, NOW, false, "tick")).toEqual([]);
  });
});
