import { afterEach, describe, it, expect, vi } from "vitest";
import { pineEngineOptions } from "@/lib/indicators/engineOptions";
import { marketService } from "@/lib/market/service";
import { useChartStore } from "@/stores/useChartStore";
afterEach(() => vi.restoreAllMocks());
describe("shared chart scripting adapters", () => {
  it("exposes distinct low-price footprint rows to PineTS without rounding executions to zero", async () => {
    vi.spyOn(marketService, "tradesFor").mockReturnValue([
      { id: "tiny-a", symbol: "TINYUSDT", time: 1000, price: 3e-12, quantity: 2, side: "buy", simulated: false },
      { id: "tiny-b", symbol: "TINYUSDT", time: 2000, price: 4e-12, quantity: 5, side: "sell", simulated: false },
    ]);
    const result = await pineEngineOptions().footprints!("TINYUSDT", "1m", {});
    expect(result[0].levels).toEqual([{ price: 3e-12, buyVolume: 2, sellVolume: 0 }, { price: 4e-12, buyVolume: 0, sellVolume: 5 }]);
    expect(Object.keys(result[0].levels[0]).sort()).toEqual(["buyVolume", "price", "sellVolume"]);
  });
  it("resolves registered library source for every chart engine", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    useChartStore
      .getState()
      .set({ pineLibraries: { "Author/Math/1": 'library("Math")' } });
    const resolver = pineEngineOptions().importResolver;
    expect(typeof resolver).toBe("function");
    if (typeof resolver === "function") {
      expect(
        await resolver("Author/Math/1", {
          path: "Author/Math/1",
          user: "Author",
          name: "Math",
          version: 1,
        }),
      ).toBe('library("Math")');
      expect(
        await resolver("Missing/Library/1", {
          path: "Missing/Library/1",
          user: "Missing",
          name: "Library",
          version: 1,
        }),
      ).toBeNull();
    }
  });
  it("serves only the requested symbol and respects the exclusive footprint end", async () => {
    const spy = vi.spyOn(marketService, "tradesFor").mockReturnValue([
      {
        id: "a",
        symbol: "ETHUSDT",
        time: 1000,
        price: 3000,
        quantity: 2,
        side: "buy",
        simulated: false,
      },
      {
        id: "b",
        symbol: "ETHUSDT",
        time: 2000,
        price: 3000,
        quantity: 8,
        side: "sell",
        simulated: false,
      },
    ]);
    const bars = await pineEngineOptions().footprints!("ETHUSDT", "1m", {
      from: 1000,
      to: 2000,
    });
    expect(spy).toHaveBeenCalledWith("ETHUSDT");
    expect(bars).toHaveLength(1);
    expect(
      bars[0].levels.reduce((s, l) => s + l.buyVolume + l.sellVolume, 0),
    ).toBe(2);
  });
});
