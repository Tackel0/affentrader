import { expect, it } from "vitest";
import { chartDataCsv } from "@/lib/chart/chartDataCsv";
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
