import { expect, it } from "vitest";
import { captureRecordedTimeSales } from "@/lib/orderflow/timeSales";
import { clusterTimeSales, timeSalesClustersCsv } from "@/lib/orderflow/timeSalesClusters";
import type { Tick } from "@/types/trading";

it("groups only revealed, individually qualifying trades on exact UTC boundaries", () => {
  const tick = (time: number, side: Tick["side"], quantity: number, price: number): Tick =>
    ({ id: String(time), symbol: "HL:BTC", time, side, quantity, price, tradeCount: time === 59000 ? undefined : 3, simulated: false });
  const trades = [
    tick(60000, "sell", 0.3, 102),
    tick(59999, "buy", 0.2, 101),
    tick(59000, "buy", 0.1, 100),
    tick(59998, "sell", 0.05, 99),
    tick(61000, "sell", 99, 80),
  ];
  const through = 61000;
  const snapshot = captureRecordedTimeSales({ trades: trades.filter(trade => trade.time < through), through, label: "Observed archive" }, "HL:BTC", 70000);
  const filters = { side: "all", minimum: 0.1, unit: "quantity" } as const;
  const seconds = clusterTimeSales(snapshot, filters, 1000);
  expect(seconds).toEqual([
    { start: 60000, end: 61000, first: 60000, last: 60000, count: 1, buys: 0, sells: 1, buyQuantity: "0", sellQuantity: "0.3", delta: "-0.3", low: 102, high: 102, underlyingTradeCount: 3, weightedPrice: expect.closeTo(102) },
    { start: 59000, end: 60000, first: 59000, last: 59999, count: 2, buys: 2, sells: 0, buyQuantity: "0.3", sellQuantity: "0", delta: "0.3", low: 100, high: 101, underlyingTradeCount: null, weightedPrice: expect.closeTo(100 + 2 / 3, 10) },
  ]);
  const minutes = clusterTimeSales(snapshot, filters, 60000);
  expect(minutes.map(row => [row.start, row.end, row.count, row.last])).toEqual([[60000, 120000, 1, 60000], [0, 60000, 2, 59999]]);
  const csv = timeSalesClustersCsv(snapshot, { ...filters, side: "sell" }, 60000);
  expect(csv.split("\r\n")).toHaveLength(2);
  expect(csv).toContain('"true","1970-01-01T00:01:01.000Z","Observed archive"');
  expect(csv.split("\r\n")[0]).toMatch(/,"weighted_price","underlying_trade_count"$/);
  expect(Number(csv.split(",").at(-2)?.replaceAll('"', ""))).toBeCloseTo(102);
  expect(csv.split(",").at(-1)).toBe('"3"');
  const capped = clusterTimeSales(snapshot, { ...filters, maximumValue: 20.2 }, 60000);
  expect(capped.map(row => [row.start, row.count])).toEqual([[0, 2]]);
  expect(timeSalesClustersCsv(snapshot, { ...filters, maximumValue: 20.2 }, 60000).split("\r\n")[1]).toMatch(/,"20.2","[^"]+",""$/);
});
