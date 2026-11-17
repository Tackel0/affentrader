import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlertRule, AlertTrigger } from "@/types/alerts";
import type { OHLCV, PriceAlert } from "@/types/trading";
import { stepRule, type RuleRuntimeState } from "@/lib/alerts/runtime";
import { BrowserRuleEngine } from "@/lib/alerts/browserEngine";
import { defaultExpiry, isExpired, parseUtcInput, timingFields, utcInput, validateTiming } from "@/lib/alerts/schedule";
import { membershipOnlyChange, watchlistMembers } from "@/lib/alerts/dependencies";
import { validateRuleShape } from "@/lib/alerts/rules";
import { useAlertStore } from "@/stores/useAlertStore";
import { AlertEvaluator } from "@/lib/alerts/engine";

const NOW = 1_800_000_000_000, MINUTE = 60_000;
const row = (time: number, close = 110): OHLCV => ({ time, open: close, high: close, low: close, close, volume: 1 });
const quote = (price = 110, at = NOW) => ({ price, previous: price, high: price, low: price, volume: 1, changePercent: 0, time: at, simulated: false });
function rule(trigger?: AlertTrigger, patch: Partial<AlertRule> = {}): AlertRule {
  return { id: "r", name: "Scheduled", kind: "technical", status: "active", scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "1m" },
    condition: { op: "leaf", leaf: { type: "compare", left: { type: "quote", field: "price" }, comparator: ">", right: { type: "number", value: 100 } } },
    frequency: "tick", repeat: true, ...(trigger ? timingFields(trigger) : {}), cooldownMs: 0, sound: false, browserNotification: false, serverSide: false, createdAt: NOW, ...patch };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); useAlertStore.setState({ alerts: [], logs: [], rules: [], events: [] }); });
afterEach(() => vi.useRealTimers());

describe("trigger frequencies", () => {
  it.each<[AlertTrigger | undefined, boolean[]]>([
    [undefined, [false, false, false, false]], ["once", [false, true, false, false]],
    ["every_time", [false, true, true, true]], ["once_per_minute", [false, true, false, true]],
    ["once_per_bar", [false, true, false, true]],
  ])("applies %s to an already-held true condition after baselining", (trigger, expected) => {
    let state: RuleRuntimeState | undefined;
    const actual = [NOW, NOW + 1, NOW + 2, NOW + MINUTE + 1].map(at => {
      const step = stepRule(rule(trigger), "BTCUSDT", state, () => ({ bars: [row(Math.floor(at / MINUTE) * MINUTE)], quote: quote(110, at) }), at);
      state = JSON.parse(JSON.stringify(step.state)); return step.fire;
    });
    expect(actual).toEqual(expected);
  });
  it("does not re-fire a bar after condition reversal or source re-baselining", () => {
    let price = 90, at = NOW;
    const fire = vi.fn(), r = rule("once_per_bar");
    const engine = new BrowserRuleEngine({ rules: () => [r], quote: () => quote(price, at), bars: () => [row(NOW)], ensure: async () => {}, fire, now: () => at });
    engine.prime(); price = 110; engine.onPrice("BTCUSDT", "trade");
    price = 90; engine.onPrice("BTCUSDT", "trade"); price = 110; engine.onPrice("BTCUSDT", "trade");
    engine.invalidateData(); engine.prime(); at++; engine.onPrice("BTCUSDT", "trade");
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it("fires once on every confirmed close while a condition stays true", () => {
    const r = rule("once_per_close"); let state: RuleRuntimeState | undefined;
    const resolve = () => ({ bars: [row(NOW - MINUTE), row(NOW), row(NOW + MINUTE)], quote: quote(999) });
    const flags = [NOW, NOW + MINUTE, NOW + MINUTE + 1, NOW + 2 * MINUTE].map(at => {
      const step = stepRule(r, "BTCUSDT", state, resolve, at); state = step.state; return step.fire;
    });
    expect(flags).toEqual([false, true, false, true]);
  });
  it("uses a rolling 60-second gap, rather than resetting at a minute boundary", () => {
    const r = rule("once_per_minute"); let state: RuleRuntimeState | undefined;
    const flags = [NOW + 58_000, NOW + 59_000, NOW + 60_000, NOW + 118_999, NOW + 119_000].map(at => {
      const step = stepRule(r, "BTCUSDT", state, () => ({ bars: [], quote: quote(110, at) }), at); state = step.state; return step.fire;
    });
    expect(flags).toEqual([false, true, false, false, true]);
  });
  it("does not invent tick-bar boundaries when no tick history exists", () => {
    const r = rule("once_per_bar", { scope: { type: "symbol", symbol: "BTCUSDT", timeframe: "100T" } });
    const first = stepRule(r, "BTCUSDT", undefined, () => ({ bars: [], quote: quote() }), NOW);
    expect(stepRule(r, "BTCUSDT", first.state, () => ({ bars: [], quote: quote() }), NOW + 1).fire).toBe(false);
  });
});

describe("expiration and UTC input", () => {
  it("stops on the exact expiration boundary without waiting for a false condition", () => {
    const r = rule("every_time", { expiresAt: NOW + 2 });
    const first = stepRule(r, "BTCUSDT", undefined, () => ({ bars: [], quote: quote() }), NOW);
    expect(stepRule(r, "BTCUSDT", first.state, () => ({ bars: [], quote: quote(110, NOW + 1) }), NOW + 1).fire).toBe(true);
    expect(stepRule(r, "BTCUSDT", first.state, () => ({ bars: [], quote: quote(110, NOW + 2) }), NOW + 2).fire).toBe(false);
    expect(isExpired(r, NOW + 2)).toBe(true);
  });
  it("expires active and paused browser records without a tick, retaining completed records and server authority", () => {
    const p = { id: "p", name: "p", symbol: "BTCUSDT", condition: "crossing", price: 100, status: "paused", repeat: true, frequency: "tick", timeframe: "1m", createdAt: NOW, simulated: false, sound: false, browserNotification: false, expiresAt: NOW + 1 } as PriceAlert;
    useAlertStore.setState({ alerts: [p], rules: [rule("once", { expiresAt: NOW + 1 }), rule("once", { id: "server", serverSide: true, expiresAt: NOW + 1 }), rule("once", { id: "done", status: "triggered", expiresAt: NOW + 1 })] });
    useAlertStore.getState().expire(NOW + 1);
    expect(useAlertStore.getState().alerts[0].status).toBe("expired");
    expect(useAlertStore.getState().rules.map(r => r.status)).toEqual(["expired", "active", "triggered"]);
  });
  it("validates dates and explicit watchlist expiration while accepting legacy imports", () => {
    for (const expiresAt of [NaN, Infinity, 0, -1, 8_640_000_000_000_001]) expect(validateTiming({ ...timingFields("once"), expiresAt })).not.toBeNull();
    const r = rule("once", { scope: { type: "watchlist", listId: "w", symbols: ["BTCUSDT"], timeframe: "1m" } });
    expect(validateRuleShape(r)).toMatch(/expiration/);
    expect(validateRuleShape({ ...r, trigger: undefined })).toBeNull();
    expect(validateRuleShape({ ...r, expiresAt: NOW + MINUTE })).toBeNull();
  });
  it("parses UTC unambiguously across local DST changes and rejects normalized invalid dates", () => {
    const date = "2026-10-25T02:30:00";
    expect(utcInput(parseUtcInput(date))).toBe(date);
    expect(parseUtcInput(date)).toBe(Date.UTC(2026, 9, 25, 2, 30));
    expect(parseUtcInput("2026-02-31T10:00:00")).toBeNaN();
    expect(parseUtcInput("")).toBeUndefined();
    expect(utcInput(Infinity)).toBe("");
  });
  it("clamps a two-calendar-month default to the target month's last day", () => {
    expect(defaultExpiry(Date.UTC(2026, 6, 31, 15, 10))).toBe(Date.UTC(2026, 8, 30, 15, 10));
  });
});

describe("watchlist lifecycle", () => {
  const watchRule = () => rule("once", { scope: { type: "watchlist", listId: "w", symbols: ["BTCUSDT", "ETHUSDT"], timeframe: "1m" }, expiresAt: NOW + 10 * MINUTE });
  const event = (symbol: string) => ({ id: `${symbol}-${Math.random()}`, ruleId: "r", name: "n", symbol, timeframe: "1m", price: 110, time: NOW, message: "m", source: "browser" as const });
  it("tracks each symbol once across reloads and finishes only when all have fired", () => {
    useAlertStore.setState({ rules: [watchRule()] });
    useAlertStore.getState().recordFiring(event("BTCUSDT"));
    const partial = JSON.parse(JSON.stringify(useAlertStore.getState().rules[0])) as AlertRule;
    expect(partial.status).toBe("active"); expect(partial.triggeredSymbols).toEqual(["BTCUSDT"]);
    let price = 90; const fire = vi.fn();
    const engine = new BrowserRuleEngine({ rules: () => [partial], bars: () => [], quote: () => quote(price), ensure: async () => {}, fire });
    engine.prime(); price = 110; engine.onPrice("BTCUSDT"); engine.onPrice("ETHUSDT");
    expect(fire).toHaveBeenCalledTimes(1); expect(fire.mock.calls[0][1].symbol).toBe("ETHUSDT");
    useAlertStore.getState().recordFiring(event("ETHUSDT"));
    expect(useAlertStore.getState().rules[0].status).toBe("triggered");
  });
  it("reactivates a completed list when a new member is added and drops removed members", () => {
    const completed = { ...watchRule(), status: "triggered" as const, triggeredSymbols: ["BTCUSDT", "ETHUSDT"] };
    const next = watchlistMembers(completed, ["###Perps", "BTCUSDT", "ETHUSDT", "SOLUSDT"]);
    expect(next.status).toBe("active"); expect(next.triggeredSymbols).toHaveLength(2);
    expect(membershipOnlyChange(completed, next)).toBe(true);
    const removed = watchlistMembers(next, ["ETHUSDT", "SOLUSDT"]);
    expect(removed.triggeredSymbols).toEqual(["ETHUSDT"]);
    expect(watchlistMembers(next, next.scope.type === "watchlist" ? next.scope.symbols : [])).toBe(next);
  });
  it("keeps the existing per-minute gate when membership changes", () => {
    let current = rule("once_per_minute", { scope: { type: "watchlist", listId: "w", symbols: ["BTCUSDT"], timeframe: "1m" }, expiresAt: NOW + 10 * MINUTE });
    let at = NOW, rules = [current]; const fire = vi.fn();
    const engine = new BrowserRuleEngine({ rules: () => rules, bars: () => [], quote: () => quote(110, at), ensure: async () => {}, fire, now: () => at });
    engine.prime(); at++; engine.onPrice("BTCUSDT"); expect(fire).toHaveBeenCalledTimes(1);
    current = watchlistMembers(current, ["BTCUSDT", "ETHUSDT"]); rules = [current]; engine.prime();
    at++; engine.onPrice("BTCUSDT"); engine.onPrice("ETHUSDT");
    expect(fire).toHaveBeenCalledTimes(2); expect(fire.mock.calls[1][1].symbol).toBe("ETHUSDT");
  });
  it("persists per-symbol minute and tick-bar gates through a browser reload", () => {
    for (const trigger of ["once_per_minute", "once_per_bar"] as const) {
      const r = rule(trigger, { scope: { type: "watchlist", listId: "w", symbols: ["BTCUSDT", "ETHUSDT"], timeframe: trigger === "once_per_bar" ? "100T" : "1m" }, expiresAt: NOW + 10 * MINUTE,
        lastFired: { BTCUSDT: { time: NOW, bar: NOW } }, lastTriggeredAt: NOW });
      const fire = vi.fn();
      const engine = new BrowserRuleEngine({ rules: () => [JSON.parse(JSON.stringify(r))], quote: () => quote(110, NOW + 10), bars: () => [row(NOW)], ensure: async () => {}, fire, now: () => NOW + 10 });
      engine.prime(); engine.onPrice("BTCUSDT"); engine.onPrice("ETHUSDT");
      expect(fire).toHaveBeenCalledTimes(1); expect(fire.mock.calls[0][1].symbol).toBe("ETHUSDT");
    }
  });
  it("synchronizes memberships through the persisted store without clearing completion", () => {
    useAlertStore.setState({ rules: [{ ...watchRule(), triggeredSymbols: ["BTCUSDT"] }] });
    const changed = useAlertStore.getState().syncWatchlists([{ id: "w", symbols: ["BTCUSDT", "SOLUSDT"] }]);
    expect(changed).toHaveLength(1); expect(changed[0].triggeredSymbols).toEqual(["BTCUSDT"]);
    expect(useAlertStore.getState().syncWatchlists([{ id: "w", symbols: ["BTCUSDT", "SOLUSDT"] }])).toEqual([]);
  });
  it("applies minute gates and expiration to the basic price engine", () => {
    const p: PriceAlert = { id: "p", name: "p", symbol: "BTCUSDT", condition: "crossing", price: 100, status: "active", ...timingFields("once_per_minute"), expiresAt: NOW + 2 * MINUTE, timeframe: "1m", createdAt: NOW, simulated: false, sound: false, browserNotification: false };
    const engine = new AlertEvaluator();
    const move = (price: number, elapsed: number) => engine.evaluate([p], "BTCUSDT", price, NOW + elapsed, false, "tick");
    move(90, 0); expect(move(110, 1)).toEqual(["p"]); expect(move(90, 2)).toEqual([]);
    expect(move(110, MINUTE + 1)).toEqual(["p"]); expect(move(90, 2 * MINUTE)).toEqual([]);
  });
  it("retains a basic alert's minute gate after reload", () => {
    const p: PriceAlert = { id: "p", name: "p", symbol: "BTCUSDT", condition: "crossing", price: 100, status: "active", ...timingFields("once_per_minute"), lastTriggeredAt: NOW, timeframe: "1m", createdAt: NOW, simulated: false, sound: false, browserNotification: false };
    const engine = new AlertEvaluator();
    engine.evaluate([p], "BTCUSDT", 90, NOW + 10, false, "tick");
    expect(engine.evaluate([p], "BTCUSDT", 110, NOW + 11, false, "tick")).toEqual([]);
    engine.evaluate([p], "BTCUSDT", 110, NOW + MINUTE, false, "tick");
    expect(engine.evaluate([p], "BTCUSDT", 90, NOW + MINUTE + 1, false, "tick")).toEqual(["p"]);
  });
});
