import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tick } from "@/types/trading";

beforeEach(() => {
  const memory = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const tick = (i: number, symbol: string): Tick => ({
  id: `${symbol}-${i}`,
  symbol,
  // 40 trades a second for a simulated 3 hours.
  time: 1_700_000_000_000 + Math.floor(i * 25),
  price: 100 + Math.sin(i / 500) * 5 + (i % 7) * 0.01,
  quantity: 0.1 + (i % 5) / 10,
  side: i % 2 ? "buy" : "sell",
  simulated: false,
  seq: i,
});

describe("market service under sustained load", () => {
  it("keeps memory bounded and bars consistent over 150,000 trades on three markets", async () => {
    const { MarketService } = await import("@/lib/market/service");
    const { useChartStore } = await import("@/stores/useChartStore");
    const service = new MarketService();
    const symbols = ["HL:BTC", "HL:xyz:TSLA", "BTCUSDT"];
    const accept = (service as unknown as { accept: (t: Tick) => void }).accept.bind(service);
    useChartStore.getState().set({ symbol: "HL:BTC", timeframe: "1m" });
    const started = performance.now();
    for (let i = 0; i < 50_000; i++) for (const symbol of symbols) accept(tick(i, symbol));
    const elapsed = performance.now() - started;

    for (const symbol of symbols) {
      // The tape keeps only the most recent trades.
      expect(service.tradesFor(symbol).length).toBeLessThanOrEqual(5000);
      expect(service.tradesFor(symbol)[0].seq).toBe(49_999);
      const minutes = service.barsFor(symbol, "1m");
      // 50,000 trades at 25 ms spacing cover 1,250 s, about 21 one-minute bars.
      expect(minutes.length).toBeGreaterThanOrEqual(20);
      expect(minutes.length).toBeLessThanOrEqual(22);
      for (let i = 1; i < minutes.length; i++) expect(minutes[i].time).toBeGreaterThan(minutes[i - 1].time);
      for (const bar of minutes) {
        expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
        expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      }
      // Volume is conserved across timeframes.
      const total = (bars: { volume: number }[]) => bars.reduce((n, b) => n + b.volume, 0);
      expect(total(service.barsFor(symbol, "1h"))).toBeCloseTo(total(minutes), 4);
    }
    // 150,000 trades through seven aggregated intervals each: a generous ceiling that still catches quadratic behaviour.
    expect(elapsed).toBeLessThan(30_000);
    expect(useChartStore.getState().trades.length).toBeLessThanOrEqual(5000);
  }, 60_000);
});
