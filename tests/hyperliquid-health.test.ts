import { describe, expect, it } from "vitest";
import { HyperliquidChannelHealth, hyperliquidStreamBehind } from "@/lib/market/hyperliquidHealth";
const start = 1_800_000_000_000;
const health = () => { const value = new HyperliquidChannelHealth(); value.watch("BTC:1m", "HL:BTC", "1m", start); return value; };
describe("Hyperliquid independent channel activity", () => {
  it("confirms missing candles despite fresh trades, allowing the channel a recovery grace period", () => {
    const value = health(); value.trade("HL:BTC", start + 21000, start + 21000);
    expect(value.check(start + 21000)).toBeNull();
    value.trade("HL:BTC", start + 25999, start + 25999);
    expect(value.check(start + 25999)).toBeNull();
    expect(value.check(start + 26000)).toMatchObject({ missing: "candle", symbol: "HL:BTC" });
  });
  it("confirms missing trades only after current candle counts demonstrate new executions", () => {
    const value = health(); value.candle("BTC:1m", start, 100, start + 1000);
    expect(value.check(start + 21000)).toBeNull();
    value.candle("BTC:1m", start, 101, start + 21000); expect(value.check(start + 21000)).toBeNull();
    value.candle("BTC:1m", start, 102, start + 26000);
    expect(value.check(start + 26000)).toMatchObject({ missing: "trades" });
  });
  it("leaves quiet markets, old reconnect snapshots and unrelated symbol activity alone", () => {
    const value = health(); value.candle("BTC:1m", start, 100, start + 1000);
    value.candle("BTC:1m", start, 100, start + 21000); value.trade("HL:ETH", start + 26000, start + 26000);
    value.trade("HL:BTC", start, start + 26000); value.candle("BTC:1m", start - 60000, 1000, start + 26000);
    expect(value.check(start + 26000)).toBeNull(); expect(value.check(start + 120000)).toBeNull();
  });
  it("clears a suspicion when the missing channel recovers or its evidence becomes stale", () => {
    const value = health(); value.trade("HL:BTC", start + 21000, start + 21000); value.check(start + 21000);
    value.candle("BTC:1m", start, 3, start + 24000); expect(value.check(start + 26000)).toBeNull();
    value.trade("HL:BTC", start + 45000, start + 45000); value.check(start + 45000);
    expect(value.check(start + 56001)).toBeNull();
  });
  it("isolates replacement sockets and gives newly registered intervals their own deadline", () => {
    const value = health(); value.trade("HL:BTC", start + 21000, start + 21000); value.check(start + 21000);
    value.reset(); value.watch("BTC:5m", "HL:BTC", "5m", start + 25000);
    expect(value.check(start + 26000)).toBeNull(); value.trade("HL:BTC", start + 27000, start + 27000);
    expect(value.check(start + 28000)).toBeNull();
  });
  it("treats a new current candle with executions as activity while ignoring future timestamps", () => {
    const value = health(); value.candle("BTC:1m", start, 100, start + 1000);
    value.trade("HL:BTC", start + 90000, start + 21000);
    value.candle("BTC:1m", start + 60000, 1, start + 61000); value.check(start + 61000);
    expect(value.check(start + 66000)).toMatchObject({ missing: "trades" });
  });
  it("bounds quiet probes to one per channel per minute and cancels quiet status on fresh data", () => {
    const value = health(); expect(value.quietCandidates(start + 45000)).toEqual([]);
    expect(value.quietCandidates(start + 45001)).toEqual(["BTC:1m"]); value.probing("BTC:1m", start + 45001);
    expect(value.quietCandidates(start + 105000)).toEqual([]); expect(value.quietCandidates(start + 105001)).toEqual(["BTC:1m"]);
    value.trade("HL:BTC", start + 105002, start + 105002); expect(value.isQuiet("BTC:1m", start + 105003)).toBe(false);
    value.reset(); expect(value.quietCandidates(start + 200000)).toEqual([]);
  });
  it("requires newer valid traded REST data, not zero bars, future data or older snapshots", () => {
    const bar = { time: start, open: 100, high: 110, low: 90, close: 101, volume: 1 };
    expect(hyperliquidStreamBehind(bar, [{ ...bar, volume: 2 }], start + 1000)).toBe(true);
    expect(hyperliquidStreamBehind(bar, [{ ...bar, time: start + 60000 }], start + 61000)).toBe(true);
    expect(hyperliquidStreamBehind(bar, [{ ...bar, close: 102 }], start + 1000)).toBe(true);
    for (const patch of [{ time: start + 60000, volume: 0 }, { time: start + 120000 }, { time: start - 60000, volume: 999 }, { volume: .5 }, { high: NaN }, {}])
      expect(hyperliquidStreamBehind(bar, [{ ...bar, ...patch }], start + 61000)).toBe(false);
    expect(hyperliquidStreamBehind(undefined, [bar], start + 1000)).toBe(false);
  });
});
