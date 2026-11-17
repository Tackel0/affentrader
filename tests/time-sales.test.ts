import { describe, expect, it } from "vitest";
import type { Tick } from "@/types/trading";
import { readTapePreferences } from "@/lib/orderflow/tapePreferences";
import { bookLastTrade, captureTimeSales, combineTapeRows, countNewRetainedTrades, filterTimeSales, timeSalesCsv, timeSalesHighlight, timeSalesMinuteBalance, timeSalesPage, timeSalesTotals } from "@/lib/orderflow/timeSales";
const context = { symbol: "HL:BTC", simulated: false, replay: false };
const all = { side: "all" as const, minimum: 0, unit: "quantity" as const };
const tick = (i: number, patch: Partial<Tick> = {}): Tick => ({ id: String(i), symbol: "HL:BTC", price: 100 + i, quantity: i + 1, side: i % 2 ? "sell" : "buy", time: i * 1000, simulated: false, ...patch });
describe("bounded Time & Sales inspection", () => {
  it("restores saved cluster views and defaults older or invalid preferences to executions", () => {
    expect(readTapePreferences(JSON.parse('{"tapeView":"minute","sizeDisplay":"value"}'))).toMatchObject({ tapeView: "minute", sizeDisplay: "value" });
    expect(readTapePreferences({ tapeView: "second" }).tapeView).toBe("second");
    expect(readTapePreferences({ tapeView: "unknown" }).tapeView).toBe("trades");
    expect(readTapePreferences({ combine: true })).toMatchObject({ tapeView: "trades", combine: true });
  });
  it("does not combine trades across an execution hidden by a filter", () => {
    const tape = captureTimeSales([
      tick(3, { time: 105, price: 100, side: "buy" }),
      tick(2, { time: 102, price: 100, side: "sell" }),
      tick(1, { time: 100, price: 100, side: "buy" }),
    ], context, 1000);
    const matching = filterTimeSales(tape, { ...all, side: "buy" });
    expect(combineTapeRows(tape.trades, new Set(matching)).map(row => [row.id, row.observations])).toEqual([["3", 1], ["1", 1]]);
  });
  it("combines Binance observations only at the same millisecond, price and side", () => {
    const raw = [101, 101, 100].map((time, index) => tick(index, { symbol: "BTCUSDT", time, price: 100, side: "buy" }));
    const tape = captureTimeSales(raw, { ...context, symbol: "BTCUSDT" }, 1000);
    expect(combineTapeRows(tape.trades).map(row => [row.time, row.observations])).toEqual([[101, 2], [100, 1]]);
  });
  it("exports the frozen observations and capture time after the live buffer advances", () => {
    const frozen = captureTimeSales([tick(5, { id: "frozen-trade" })], context, 6000);
    const live = captureTimeSales([tick(7, { id: "later-trade" })], context, 8000);
    expect(countNewRetainedTrades(frozen, live)).toBe(1);
    const csv = timeSalesCsv(frozen, all);
    expect(csv).toContain('"frozen-trade"');
    expect(csv).toContain(new Date(6000).toISOString());
    expect(csv).not.toContain('"later-trade"');
    expect(timeSalesCsv(live, all)).toContain('"later-trade"');
  });
  it("counts late arrivals still in the buffer after a pause without counting retained duplicates", () => {
    const frozen = captureTimeSales([tick(5), tick(4)], context, 6000);
    const late = tick(3, { tradeCount: 8 });
    const current = captureTimeSales([tick(7), tick(5), late, late], context, 8000);
    expect(countNewRetainedTrades(frozen, frozen)).toBe(0);
    expect(countNewRetainedTrades(frozen, current)).toBe(2);
    const afterEviction = captureTimeSales([tick(7), tick(5)], context, 9000);
    expect(countNewRetainedTrades(frozen, afterEviction)).toBe(1);
  });
  it("uses only trades strictly before the recorded book timestamp", () => {
    const tape = [tick(4), tick(3), tick(2, { price: 98 }), tick(1)];
    expect(bookLastTrade(tape)).toEqual({ price: 104, direction: 1 });
    expect(bookLastTrade(tape, 3000)).toEqual({ price: 98, direction: -1 });
    expect(bookLastTrade(tape, 2000)).toEqual({ price: 101, direction: null });
    expect(bookLastTrade(tape, 1000)).toBeUndefined();
  });
  it("keeps provider print counts separate from observations and propagates unknown counts", () => {
    const raw = [tick(0, { time: 100, tradeCount: 2 }), tick(2, { time: 99, price: 100, tradeCount: 5 })];
    const snapshot = captureTimeSales(raw, context, 9000);
    expect(combineTapeRows(snapshot.trades)[0]).toMatchObject({ observations: 2, tradeCount: 7 });
    expect(combineTapeRows(captureTimeSales([raw[0], { ...raw[1], tradeCount: 1.5 }], context, 9000).trades)[0].tradeCount).toBeUndefined();
    const csv = timeSalesCsv(snapshot, all).split("\r\n");
    expect(csv[0]).toMatch(/,"underlying_trade_count"$/);
    expect(csv[1]).toMatch(/,"2"$/);
  });
  it("combines adjacent same-price observations within 10 ms without changing the snapshot", () => {
    const raw = [100, 90, 89, 88].map((time, i) => tick(i, { time, side: "buy", price: i === 3 ? 101 : 100, quantity: 1 }));
    const snapshot = captureTimeSales(raw, context, 9000);
    expect(combineTapeRows(snapshot.trades).map(row => [row.time, row.earliest, row.quantity, row.observations])).toEqual([[100, 90, 2, 2], [89, 89, 1, 1], [88, 88, 1, 1]]);
    expect(snapshot.trades.map(row => row.quantity)).toEqual([1, 1, 1, 1]);
  });
  it("uses Vela's mean trade value baseline after 30 observations and a fivefold block threshold", () => {
    const trades = Array.from({ length: 30 }, (_, i) => tick(i, { price: 100, quantity: i === 29 ? 31 : 1 }));
    const auto = { mode: "auto", multiplier: 3 } as const;
    expect(timeSalesHighlight(trades.slice(0, 29), auto)).toBeNull();
    expect(timeSalesHighlight(trades, auto)).toEqual({ large: 600, block: 3000 });
    expect(timeSalesHighlight([], { mode: "fixed", value: 200 })).toEqual({ large: 200, block: 1000 });
  });
  it("uses quote value and includes exactly the 60-second edge of the observed tape", () => {
    const snapshot = captureTimeSales([tick(0, { time: 999 }), tick(1, { time: 1000, price: 200, quantity: 1 }), tick(2, { time: 61000, price: 100, quantity: 1 })], context, 90000);
    expect(timeSalesMinuteBalance(snapshot)).toEqual({ through: 61000, buy: 100, sell: 200, buyShare: 1 / 3 });
    expect(timeSalesMinuteBalance({ ...snapshot, trades: [] })).toBeNull();
  });
  it("sums filtered observations across pages without binary quantity drift", () => {
    const raw = Array.from({ length: 103 }, (_, i) => tick(i, { time: 1000, quantity: .1 }));
    const matches = filterTimeSales(captureTimeSales(raw, context, 9000), all);
    expect(timeSalesPage(matches, 0).trades).toHaveLength(100);
    expect(timeSalesTotals(matches)).toMatchObject({ buys: 52, sells: 51, buyVolume: "5.2", sellVolume: "5.1", delta: "0.1" });
  });
  it("weights each side by quantity across the filtered tape and leaves absent prices blank", () => {
    const snapshot = captureTimeSales([tick(0, { price: 100, quantity: 1 }), tick(2, { price: 120, quantity: 3 }), tick(1, { price: 98 })], context, 9000);
    expect(timeSalesTotals(snapshot.trades)).toMatchObject({ buyAverage: 115, sellAverage: 98 });
    expect(timeSalesTotals(filterTimeSales(snapshot, { ...all, side: "buy" }))).toMatchObject({ buyAverage: 115, sellAverage: null });
  });
  it("excludes other markets, mixed simulation, invalid data, unclassified sides and duplicate IDs", () => {
    const raw = [tick(1), tick(1), tick(2, { symbol: "HL:ETH" }), tick(3, { simulated: true }), tick(4, { price: NaN }), tick(5, { quantity: 0 }), tick(6, { side: "unknown" as "buy" }), tick(7, { time: 10001 })];
    const captured = captureTimeSales(raw, context, 9000);
    expect(captured.trades.map(t => t.id)).toEqual(["1"]); expect(captured.rejected).toBe(7);
    expect(captureTimeSales(raw, { ...context, simulated: true }, 9000).trades.map(t => t.id)).toEqual(["3"]);
  });
  it("never returns the live tape in Replay", () => {
    expect(captureTimeSales([tick(1)], { ...context, replay: true }, 9000).trades).toEqual([]);
  });
  it("does not infer classified trades from Yahoo quotes or unclassified IEX prints", () => {
    for (const symbol of ["IEX:AAPL", "YF:AAPL"]) {
      const raw = [tick(1, { symbol })];
      expect(captureTimeSales(raw, { ...context, symbol }, 9000)).toMatchObject({ trades: [], rejected: 1 });
      expect(captureTimeSales([{ ...raw[0], simulated: true }], { symbol, simulated: true, replay: false }, 9000).trades).toHaveLength(1);
    }
  });
  it("orders late arrivals by event time/sequence/ID without using delivery order as time", () => {
    const raw = [tick(9, { time: 1000 }), tick(2, { time: 2000, seq: 1 }), tick(3, { time: 2000, seq: 2 }), tick(4, { time: 2000 }), tick(5, { time: 2000 })];
    expect(captureTimeSales(raw, context, 9000).trades.map(t => t.id)).toEqual(["3", "2", "5", "4", "9"]);
  });
  it("freezes whitelisted copies independently of a mutating live buffer", () => {
    const raw = [tick(1)], snapshot = captureTimeSales(raw, context, 9000); raw[0].quantity = 999; raw.push(tick(2));
    expect(snapshot.trades).toHaveLength(1); expect(snapshot.trades[0].quantity).toBe(2);
    expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(snapshot.trades)).toBe(true); expect(Object.isFrozen(snapshot.trades[0])).toBe(true);
    expect(captureTimeSales(raw, context, 9000).trades[1].quantity).toBe(999);
  });
  it("reuses immutable observations while checking each window's membership and timestamps", () => {
    const retained = Object.freeze(tick(3));
    const future = Object.freeze(tick(6, { time: 6000 }));
    const first = captureTimeSales([retained, future], context, 4999);
    expect(first.trades.map(row => row.id)).toEqual(["3"]);
    expect(first.rejected).toBe(1);

    const late = Object.freeze(tick(2));
    const next = captureTimeSales([late, future, retained, retained], context, 5000);
    expect(next.trades.map(row => row.id)).toEqual(["6", "3", "2"]);
    expect(next.rejected).toBe(1);
    expect(next.trades[1]).toBe(first.trades[0]);
    expect(first.trades.map(row => row.id)).toEqual(["3"]);
    expect(captureTimeSales([retained], { ...context, symbol: "HL:ETH" }, 5000).trades).toEqual([]);
    expect(captureTimeSales([future], context, 4999).trades).toEqual([]);
  });
  it("applies inclusive side/quantity/product filters and rejects invalid settings", () => {
    const snapshot = captureTimeSales([tick(0), tick(1), tick(2)], context, 9000);
    expect(filterTimeSales(snapshot, { ...all, side: "sell", minimum: 2 }).map(t => t.id)).toEqual(["1"]);
    expect(filterTimeSales(snapshot, { ...all, minimum: 202, unit: "price-times-quantity" }).map(t => t.id)).toEqual(["2", "1"]);
    expect(filterTimeSales(snapshot, { ...all, minimum: 1000 })).toEqual([]);
    for (const patch of [{ minimum: -1 }, { minimum: NaN }, { side: "unknown" }, { unit: "USD" }]) expect(() => filterTimeSales(snapshot, { ...all, ...patch } as typeof all)).toThrow();
  });
  it("makes all 5,000 retained executions reachable and exports all filtered pages", () => {
    const snapshot = captureTimeSales(Array.from({ length: 5000 }, (_, i) => tick(i)), context, 6000000);
    const filtered = filterTimeSales(snapshot, all), reached = [];
    for (let page = 0; page < 50; page++) reached.push(...timeSalesPage(filtered, page).trades.map(t => t.id));
    expect(new Set(reached).size).toBe(5000); expect(timeSalesPage(filtered, 999)).toMatchObject({ page: 49, pages: 50 });
    expect(timeSalesCsv(snapshot, all).split("\r\n")).toHaveLength(5001);
    expect(timeSalesCsv(snapshot, { ...all, side: "buy" }).split("\r\n")).toHaveLength(2501);
    expect(() => captureTimeSales(Array.from({ length: 5001 }, (_, i) => tick(i)), context, 6000000)).toThrow(/5,000/);
    expect(() => timeSalesPage(filtered, -1)).toThrow();
  });
  it("exports exact model prices/quantities with UTC and source/filter metadata", () => {
    const snapshot = captureTimeSales([tick(0, { id: 'id"quoted', price: 1.23456789e-10, quantity: .000000001, seq: 42 })], context, 9000);
    const csv = timeSalesCsv(snapshot, all);
    expect(csv).toContain('"id""quoted"'); expect(csv).toContain('"1970-01-01T00:00:00.000Z"'); expect(csv).toContain('"1.23456789e-10","1e-9","buy","42"');
    expect(csv).toContain('"HL:BTC","1970-01-01T00:00:09.000Z","false","all","0","quantity"');
  });
});
