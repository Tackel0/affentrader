import { expect, it } from "vitest";
import {
  chartDataCsv,
  chartDataFilename,
  chartDataJson,
  filterBarsByVisibleRange,
} from "@/lib/chart/chartDataCsv";
const bars = [{ time: Date.UTC(2026, 10, 6, 10, 55), open: 100, high: 103, low: 99, close: 102, volume: .12345678 }];
it("exports the loaded candle provider without relabeling every exchange as Binance", () => {
  for (const [symbol, source] of [["BTCUSDT", "Binance"], ["KRK:BTC/USD", "Kraken"], ["HL:xyz:SP500", "Hyperliquid"], ["YF:AAPL", "Yahoo Finance"], ["IEX:AAPL", "Alpaca IEX"], ["SIP:AAPL", "Alpaca SIP"]]) {
    const csv = chartDataCsv(bars, symbol, "1m", "exchange");
    expect(csv.split("\r\n")[1]).toBe(`2026-11-06T10:55:00.000Z,100,103,99,102,0.12345678,${symbol},1m,${source}`);
  }
});
it("keeps simulation and unknown candle lineage explicit regardless of the symbol namespace", () => {
  expect(chartDataCsv(bars, "KRK:BTC/USD", "1m", "simulation")).toMatch(/,simulation$/);
  expect(chartDataCsv(bars, "BTCUSDT", "1m", undefined)).toMatch(/,unknown$/);
  expect(chartDataCsv([], "KRK:BTC/USD", "1m", "exchange")).toBe("time,open,high,low,close,volume,symbol,timeframe,source");
});
it("exports structured JSON with metadata and sanitizes filenames for symbols with colons or slashes", () => {
  const parsed = JSON.parse(chartDataJson(bars, "YF:QQQ", "5m", "exchange", "visible"));
  expect(parsed.symbol).toBe("YF:QQQ");
  expect(parsed.timeframe).toBe("5m");
  expect(parsed.source).toBe("Yahoo Finance");
  expect(parsed.scope).toBe("visible");
  expect(parsed.count).toBe(1);
  expect(parsed.candles[0]).toMatchObject({
    time: "2026-11-06T10:55:00.000Z",
    timestampMs: bars[0].time,
    open: 100,
    high: 103,
    low: 99,
    close: 102,
    volume: 0.12345678,
  });
  expect(chartDataFilename("KRK:BTC/USD", "15m", "csv")).toBe("KRK-BTC-USD-15m.csv");
  expect(chartDataFilename("YF:QQQ", "5m", "json", "visible")).toBe("YF-QQQ-5m-visible.json");
});
it("filters bars cleanly to a visible time window", () => {
  const multi = [
    { ...bars[0], time: 1000 },
    { ...bars[0], time: 2000 },
    { ...bars[0], time: 3000 },
    { ...bars[0], time: 4000 },
  ];
  expect(filterBarsByVisibleRange(multi, { from: 1500, to: 3500 }).map((b) => b.time)).toEqual([2000, 3000]);
  expect(filterBarsByVisibleRange(multi, null)).toHaveLength(4);
});

