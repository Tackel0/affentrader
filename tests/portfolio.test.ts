import { describe, expect, it } from "vitest";
import { computeHoldings, csvToLots, lotsToCsv, valuePortfolio, type Lot } from "@/lib/portfolio";

const lot = (patch: Partial<Lot>): Lot => ({
  id: crypto.randomUUID(),
  symbol: "BTCUSDT",
  side: "buy",
  quantity: 1,
  price: 100,
  fee: 0,
  time: 1,
  ...patch,
});

describe("holdings", () => {
  it("uses the average-cost method and books realized profit on sells", () => {
    const [h] = computeHoldings([
      lot({ quantity: 2, price: 100, time: 1 }),
      lot({ quantity: 2, price: 200, time: 2 }),
      lot({ side: "sell", quantity: 1, price: 250, time: 3 }),
    ]);
    expect(h.quantity).toBe(3);
    expect(h.avgCost).toBe(150);
    expect(h.realized).toBe(100);
    expect(h.invested).toBe(450);
  });
  it("includes buy fees in the cost basis and sell fees in realized profit", () => {
    const [h] = computeHoldings([
      lot({ quantity: 1, price: 100, fee: 2, time: 1 }),
      lot({ side: "sell", quantity: 1, price: 110, fee: 1, time: 2 }),
    ]);
    expect(h.quantity).toBe(0);
    expect(h.realized).toBeCloseTo(110 - 102 - 1, 8);
    expect(h.fees).toBe(3);
  });
  it("orders transactions by time and cannot sell more than is held", () => {
    const [h] = computeHoldings([
      lot({ side: "sell", quantity: 5, price: 150, time: 2 }),
      lot({ quantity: 2, price: 100, time: 1 }),
    ]);
    expect(h.quantity).toBe(0);
    expect(h.realized).toBe(100);
  });
});

describe("valuation", () => {
  it("weights positions by market value and falls back to cost without a quote", () => {
    const holdings = computeHoldings([
      lot({ quantity: 1, price: 100 }),
      lot({ symbol: "ETHUSDT", quantity: 10, price: 10 }),
      lot({ symbol: "SOLUSDT", quantity: 1, price: 50 }),
    ]);
    const summary = valuePortfolio(holdings, {
      BTCUSDT: { price: 300, changePercent: 2 },
      ETHUSDT: { price: 10, changePercent: -1 },
    });
    expect(summary.value).toBe(300 + 100 + 50);
    expect(summary.holdings[0].symbol).toBe("BTCUSDT");
    expect(summary.holdings.reduce((s, h) => s + h.weight, 0)).toBeCloseTo(100, 8);
    expect(summary.holdings.find((h) => h.symbol === "SOLUSDT")?.price).toBeNull();
    expect(summary.unrealized).toBe(200);
    expect(summary.returnPercent).toBeCloseTo((200 / 250) * 100, 8);
  });
});

describe("csv", () => {
  it("round trips transactions including quoted notes", () => {
    const lots = [lot({ note: 'first, "big" buy', time: Date.UTC(2026, 0, 2) }), lot({ side: "sell", quantity: 0.5, time: Date.UTC(2026, 0, 3) })];
    const parsed = csvToLots(lotsToCsv(lots));
    expect(parsed.errors).toEqual([]);
    expect(parsed.lots).toHaveLength(2);
    expect(parsed.lots[0]).toMatchObject({ symbol: "BTCUSDT", side: "buy", note: 'first, "big" buy' });
    expect(parsed.lots[1].quantity).toBe(0.5);
  });
  it("reports malformed lines instead of importing them", () => {
    const parsed = csvToLots("date,symbol,side,quantity,price\n2026-01-01,BTCUSDT,hold,1,1\nnot a date,BTCUSDT,buy,1,1\n2026-01-01,BTCUSDT,buy,1,1");
    expect(parsed.lots).toHaveLength(1);
    expect(parsed.errors).toHaveLength(2);
  });
});
