import { expect, it, vi } from "vitest";
import type { AlertRule } from "@/types/alerts";
import { BrowserRuleEngine } from "@/lib/alerts/browserEngine";
import { tpoAlertSettings } from "@/lib/alerts/tpo";
import { defaultTpo } from "@/lib/orderflow/tpoSettings";
import { requiredTpoHistory } from "@/lib/alerts/tpoSource";
import { closeView } from "@/lib/alerts/runtime";
const day = Date.UTC(2026, 10, 4), m = 60000, symbol = "YF:AAPL";
const bar = (time: number, close = 100) => ({ time, open: close, high: close, low: close, close, volume: 1 });
const regular = [bar(day + 870 * m, 50), bar(day + 885 * m, 50)];
const source = Array.from({ length: 4 }, (_, i) => bar(day + (540 + i * 15) * m));
const settings = tpoAlertSettings({ ...defaultTpo(), tradingHours: "Custom", customStart: 900, customEnd: 1000, rowSize: 1 });
const condition = { type: "tpo" as const, level: "poc" as const, direction: "crossing_up" as const, settings };
const rule: AlertRule = { id: "independent-tpo", name: "Source session", kind: "technical", status: "active", scope: { type: "symbol", symbol, timeframe: "15m" },
  condition: { op: "leaf", leaf: condition }, frequency: "tick", trigger: "every_time", repeat: true, cooldownMs: 0, sound: false, browserNotification: false, serverSide: false, createdAt: day };
it("prepares separate TPO source history without replacing host candles or replaying a prior crossing", async () => {
  let now = day + 900 * m, price = 100;
  const fire = vi.fn(), history = vi.fn(async () => ({ bars: [...source, bar(day + 1440 * m, 9999)], basis: "Independent fixture" }));
  const engine = new BrowserRuleEngine({ rules: () => [rule], bars: () => regular, quote: () => ({ price, previous: price, time: now, changePercent: 0, high: price, low: price, volume: 1 }),
    ensure: async () => {}, tpoHistory: history, now: () => now, fire });
  engine.prime(); price = 101; now++;
  await engine.prepare(); expect(fire).not.toHaveBeenCalled();
  expect(history).toHaveBeenCalledWith(expect.objectContaining({ symbol, timeframe: "15m", tape: "extended" }));
  engine.onPrice(symbol, "trade"); expect(fire).not.toHaveBeenCalled();
  price = 100; now++; engine.onPrice(symbol, "trade"); expect(fire).not.toHaveBeenCalled();
  price = 101; now++; engine.onPrice(symbol, "trade"); expect(fire).toHaveBeenCalledTimes(1);
  expect(fire.mock.calls[0][1].message).toContain("100.5"); expect(regular.every(b => b.close === 50)).toBe(true);
});
it("fences a pending source response when the feed generation changes", async () => {
  let done!: (value: { bars: typeof source; basis: string }) => void;
  let price = 101, now = day + 900 * m;
  const fire = vi.fn(), engine = new BrowserRuleEngine({ rules: () => [rule], bars: () => regular, quote: () => ({ price, previous: 100, time: now, changePercent: 1, high: 101, low: 100, volume: 1 }),
    ensure: async () => {}, tpoHistory: () => new Promise(resolve => { done = resolve; }), now: () => now, fire });
  engine.prime(); const pending = engine.prepare(); await Promise.resolve(); engine.invalidateData(); done({ bars: source, basis: "Late response" }); await pending;
  engine.onPrice(symbol, "trade"); price = 100; now++; engine.onPrice(symbol, "trade"); price = 101; now++; engine.onPrice(symbol, "trade");
  expect(fire).not.toHaveBeenCalled();
});
it("deduplicates explicit tape dependencies while Full day and Week retain ordinary history", () => {
  const views = requiredTpoHistory({ op: "all", conditions: [
    { op: "leaf", leaf: condition }, { op: "leaf", leaf: { ...condition, level: "vah" } },
    { op: "leaf", leaf: { ...condition, settings: { ...settings, tradingHours: "Regular hours (RTH)" } } },
    { op: "leaf", leaf: { ...condition, settings: { ...settings, tradingHours: "Full day" } } },
    { op: "leaf", leaf: { ...condition, settings: { ...settings, sessionPeriod: "Week" } } },
  ] }, { symbol, timeframe: "15m" });
  expect(views.map(v => v.tape)).toEqual(["extended", "regular"]);
});
it("retains the independent source resolver through confirmed-close snapshots", () => {
  const resolver = vi.fn(() => ({ bars: source, basis: "Source" })), view = closeView({ bars: regular, tpoSource: resolver }, "15m", day + 900 * m);
  expect(view.tpoSource).toBe(resolver); expect(view.at).toBe(day + 900 * m);
});
