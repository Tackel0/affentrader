import { expect, it, vi } from "vitest";
import { strategySymbolInfo } from "@/lib/strategy/engine";
import { loadKrakenClosedBars } from "@/lib/market/kraken";

it("aggregates only fully covered Kraken history buckets", async () => {
  const minute = (time: number, open: number) => [time, open, open + 2, open - 1, open + 1, open, 2, 1];
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({
    error: [],
    result: { XXBTZUSD: [minute(60, 10), minute(120, 20), minute(180, 21), minute(240, 22), minute(300, 23)], last: 300 },
  }));
  expect(await loadKrakenClosedBars("BTC/USD", "2m", fetcher)).toEqual([
    { time: 120000, open: 20, high: 23, low: 19, close: 22, volume: 4 },
  ]);
  const request = fetcher.mock.calls[0][0] as URL;
  expect(request.searchParams.get("interval")).toBe("1");
  expect(request.searchParams.get("pair")).toBe("BTCUSD");
});

it("exposes Kraken venue, currency and increments to Pine strategies", () => {
  expect(strategySymbolInfo({
    symbol: "KRK:BTC/USD", timeframe: "5m", provider: "kraken", tickSize: 0.1,
    quantityStep: 1e-8, base: "BTC", currency: "USD",
  })).toMatchObject({
    prefix: "KRAKEN", ticker: "BTC/USD", tickerid: "KRK:BTC/USD", basecurrency: "BTC",
    currency: "USD", mintick: 0.1, mincontract: 1e-8, pricescale: 10, session: "24x7",
  });
});

it("rejects a malformed Kraken source candle before resampling", async () => {
  const rows = [
    [120, "100", "102", "99", "101", "100", "2", 1],
    [180, "101", "100", "99", "102", "100", "3", 1],
    [240, "102", "104", "101", "103", "100", "4", 1],
  ];
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: [], result: { BTCUSD: rows, last: 240 } }));
  await expect(loadKrakenClosedBars("BTC/USD", "2m", fetcher)).rejects.toThrow(/invalid/);
});

it.each([null, "", false])("rejects Kraken volume %j instead of treating it as zero", async volume => {
  const closed = [120, "100", "102", "99", "101", "100", volume, 1];
  const open = [180, "101", "101", "101", "101", "101", "0", 0];
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: [], result: { BTCUSD: [closed, open] } }));
  await expect(loadKrakenClosedBars("BTC/USD", "1m", fetcher)).rejects.toThrow(/invalid/);
  closed[6] = "0";
  await expect(loadKrakenClosedBars("BTC/USD", "1m", fetcher)).resolves.toMatchObject([{ volume: 0 }]);
});

it("builds Monday weeks from Kraken daily bars instead of Thursday native weeks", async () => {
  const start = Date.UTC(2026, 9, 5) / 1000;
  const rows = Array.from({ length: 15 }, (_, i) => [start + i * 86400, "100", "102", "99", "101", "100", "2", 1]);
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: [], result: { BTCUSD: rows } }));
  const bars = await loadKrakenClosedBars("BTC/USD", "1W", fetcher);
  expect((fetcher.mock.calls[0][0] as URL).searchParams.get("interval")).toBe("1440");
  expect(bars).toHaveLength(2);
  expect(bars.every(bar => new Date(bar.time).getUTCDay() === 1)).toBe(true);
  expect(bars.map(bar => bar.volume)).toEqual([14, 14]);
});
