import { describe, expect, it, vi } from "vitest";
import type { AlertRule, Condition, RuleEvent } from "@/types/alerts";
import type { MarketView } from "@/lib/alerts/rules";
import { evaluateCondition, requiredHistoryViews, validateRuleShape } from "@/lib/alerts/rules";
import { stepRule, type RuleRuntimeState } from "@/lib/alerts/runtime";
import { BrowserRuleEngine } from "@/lib/alerts/browserEngine";
import { tpoAlertSettings, validateTpoCondition } from "@/lib/alerts/tpo";
import { normalizeRuleMarkets, ruleMarketSubscriptions } from "@/lib/alerts/dependencies";
import { parseWorkspace } from "@/lib/workspace";

const minute = 60000, day = 86400000, start = Date.UTC(2026, 9, 27), end = start + 60 * minute;
const bar = (time: number, low: number, high = low) => ({ time, open: low, high, low, close: high, volume: 1 });
const opening = (at: number, low: number) => Array.from({ length: 12 }, (_, i) => bar(at + i * 5 * minute, low, low + .1));
const source = [...opening(start, .2), ...opening(start + day, .6)];
const settings = { ...tpoAlertSettings(), sessionMinutes: 60, rowSize: .1 };
const leaf = () => ({ type: "tpo", level: "poc", direction: "crossing", settings: { ...settings } } as const);
const rule = (patch: Partial<AlertRule> = {}): AlertRule => ({ id: "following-tpo", name: "Following TPO", kind: "technical", status: "active",
  scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "5m" }, condition: { op: "leaf", leaf: leaf() }, frequency: "tick", repeat: true,
  trigger: "every_time", cooldownMs: 0, sound: false, browserNotification: false, serverSide: false, createdAt: start, ...patch });
const quote = (price: number, at: number, simulated = false) => ({ price, previous: price, time: at, simulated, changePercent: 0, high: price, low: price, volume: 1 });
function harness(value = rule()) {
  let at = start + day + 10 * minute, price = .2, bars = source.map(candle => ({ ...candle })), generation = "exchange:1", ready = true, simulated = false;
  let state: RuleRuntimeState | undefined;
  const resolve = (): MarketView => ({ bars, quote: quote(price, at, simulated), candleContext: { ready, generation } });
  return { resolve, get state() { return state; }, set: (patch: { at?: number; price?: number; bars?: typeof bars; generation?: string; ready?: boolean; simulated?: boolean }) => {
    at = patch.at ?? at; price = patch.price ?? price; bars = patch.bars ?? bars; generation = patch.generation ?? generation; ready = patch.ready ?? ready; simulated = patch.simulated ?? simulated;
  }, step: () => { const result = stepRule(value, "BTCUSDT", state, resolve, at); state = JSON.parse(JSON.stringify(result.state)); return result; } };
}

describe("following completed TPO alert conditions", () => {
  it("does not replay an old crossing on creation, then crosses the exact completed POC through persisted observations", () => {
    const h = harness(); expect(h.step().fire).toBe(false);
    h.set({ price: .25, at: start + day + 10 * minute + 1 }); const hit = h.step();
    expect(hit.fire).toBe(true); expect(hit.evaluation!.detail).toContain("POC 0.25"); expect(hit.evaluation!.detail).toContain(new Date(start).toISOString());
    expect(Object.values(hit.state.tpo!)).toHaveLength(1);
    h.set({ price: .25, at: start + day + 10 * minute + 2 }); expect(h.step().fire).toBe(false);
  });
  it.each(["poc", "vah", "val"] as const)("uses canonical %s and does not infer a direction from profile motion", level => {
    const threshold = { poc: .25, vah: .4, val: .2 }[level];
    const value = rule({ condition: { op: "leaf", leaf: { ...leaf(), level, direction: "crossing_down" } } });
    const h = harness(value); h.set({ price: threshold + .1 }); expect(h.step().fire).toBe(false);
    h.set({ price: threshold, at: start + day + 10 * minute + 1 }); expect(h.step().fire).toBe(true);
  });
  it("adopts the next profile at its confirmed closing boundary without firing from a threshold jump", () => {
    const h = harness(); h.set({ at: start + day + 55 * minute, price: .5 }); expect(h.step().fire).toBe(false);
    const first = Object.values(h.state!.tpo!)[0].reference;
    h.set({ at: start + day + 60 * minute, price: .5 }); expect(h.step().fire).toBe(false);
    expect(Object.values(h.state!.tpo!)[0].reference).not.toBe(first);
    h.set({ at: start + day + 60 * minute + 1, price: .65 }); expect(h.step().fire).toBe(true);
  });
  it("clears unavailable observations and rebaselines on recovery, source generation, simulation changes and repaired profile prices", () => {
    const h = harness(); h.step(); h.set({ ready: false, price: .3 }); expect(h.step().evaluation!.incomplete).toBe(true);
    expect(h.state!.tpo).toEqual({}); h.set({ ready: true }); expect(h.step().fire).toBe(false);
    h.set({ price: .2, generation: "exchange:2" }); expect(h.step().fire).toBe(false);
    h.set({ price: .3, simulated: true }); expect(h.step().fire).toBe(false);
    const repaired = [...opening(start, 1), ...opening(start + day, .6)];
    h.set({ bars: repaired, price: .7 }); expect(h.step().fire).toBe(false);
    h.set({ price: 1.05, at: start + day + 10 * minute + 1 }); expect(h.step().fire).toBe(true);
  });
  it("rejects incomplete source sessions and excludes all future/forming extremes", () => {
    const h = harness(); h.set({ bars: source.filter((_, i) => i !== 5) }); expect(h.step().evaluation!.incomplete).toBe(true);
    const changed = source.map(candle => ({ ...candle })); changed.at(-1)!.high = 100000;
    h.set({ bars: changed }); expect(h.step().fire).toBe(false);
    h.set({ price: .25, at: start + day + 10 * minute + 1 }); expect(h.step().fire).toBe(true);
    const future = evaluateCondition({ op: "leaf", leaf: leaf() }, { symbol: "BTCUSDT", timeframe: "5m" }, () => ({ bars: source, quote: quote(.25, end - 1), at: end - 1 }));
    expect(future.incomplete).toBe(true); expect(future.tpo).toEqual({});
  });
  it("uses matching confirmed closes rather than a later quote, with the new profile available at its final candle close", async () => {
    const value = rule({ frequency: "close", trigger: "once_per_close", condition: { op: "leaf", leaf: { ...leaf(), direction: "crossing_up" } } });
    const rows = [...source, bar(start + day + 60 * minute, .6), bar(start + day + 65 * minute, .7)];
    let now = start + day + 60 * minute;
    const events: RuleEvent[] = [];
    const engine = new BrowserRuleEngine({ rules: () => [value], bars: () => rows, quote: () => quote(9999, now), now: () => now, ensure: async () => {}, fire: (_, event) => events.push(event) });
    engine.prime();
    now += 5 * minute; engine.onClose("BTCUSDT", "1m", now - minute); expect(events).toHaveLength(0);
    engine.onClose("BTCUSDT", "5m", now - 5 * minute); expect(events).toHaveLength(0);
    now += 5 * minute; engine.onClose("BTCUSDT", "5m", now - 5 * minute);
    expect(events).toHaveLength(1); expect(events[0].price).toBe(.7); expect(events[0].message).toContain("POC 0.65");
    engine.onClose("BTCUSDT", "5m", now - 5 * minute); expect(events).toHaveLength(1);
  });
  it("prepares sufficient history, subscribes dependencies and routes browser rules after aggregation", async () => {
    const value = rule(); let now = start + day + 10 * minute, price = .2;
    const ensure = vi.fn(async () => {}), fire = vi.fn();
    const engine = new BrowserRuleEngine({ rules: () => [value], bars: () => source, quote: () => quote(price, now), now: () => now, ensure, fire });
    await engine.prepare(); engine.prime(); expect(ensure).toHaveBeenCalledWith("BTCUSDT", "5m", 878);
    expect(ruleMarketSubscriptions([value]).streams).toEqual(["BTCUSDT"]);
    price = .3; now++; engine.onPrice("BTCUSDT", "quote"); expect(fire).not.toHaveBeenCalled();
    engine.onPrice("BTCUSDT", "trade"); expect(fire).toHaveBeenCalledOnce();
    expect(requiredHistoryViews(value.condition, { symbol: "BTCUSDT", timeframe: "5m" })[0].count).toBe(878);
  });
  it("supports multi-market compound conditions with independent profile observations", () => {
    const condition: Condition = { op: "all", conditions: [
      { op: "leaf", leaf: leaf() }, { op: "leaf", leaf: { ...leaf(), symbol: "ETHUSDT" } },
    ] };
    const value = rule({ condition }), h = harness(value); h.step();
    h.set({ price: .25, at: start + day + 10 * minute + 1 }); expect(h.step().fire).toBe(true);
    expect(Object.keys(h.state!.tpo!)).toHaveLength(2);
  });
  it("validates saved settings/context/history limits and round trips a normalized workspace rule", () => {
    expect(validateRuleShape(rule())).toBeNull();
    for (const settingsPatch of [{ rowSize: -1 }, { sessionZone: "bad" }, { targetRows: 1 }, { blockMinutes: ["30"] }, { injected: 1 }])
      expect(validateTpoCondition({ ...leaf(), settings: { ...settings, ...settingsPatch } })).toMatch(/Invalid/);
    for (const patch of [{ level: ["poc"] }, { direction: "above" }, { injected: true }]) expect(validateTpoCondition({ ...leaf(), ...patch })).not.toBeNull();
    expect(validateTpoCondition(leaf(), null as unknown as string)).toContain("interval");
    expect(validateRuleShape(rule({ scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "100T" } }))).toContain("time bars");
    expect(validateRuleShape(rule({ scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "1s" }, condition: { op: "leaf", leaf: { ...leaf(), settings: tpoAlertSettings() } } }))).toContain("history limit");
    expect(validateRuleShape(rule({ condition: { op: "leaf", leaf: { ...leaf(), symbol: "bad!" } } }))).toContain("symbol");
    const saved = normalizeRuleMarkets(rule()), backup = { version: 1, chart: { state: { symbol: "BTCUSDT", timeframe: "5m", chartType: "tpo", feedMode: "auto", indicators: [], drawings: {}, pineLibraries: {} } },
      watchlists: { state: { lists: [{ id: "a", name: "Crypto", symbols: ["BTCUSDT"] }], activeId: "a" } }, alerts: { state: { alerts: [], logs: [], rules: [saved] } } };
    expect(parseWorkspace(JSON.stringify(backup)).alerts.state.rules).toEqual(JSON.parse(JSON.stringify([saved])));
  });
});
