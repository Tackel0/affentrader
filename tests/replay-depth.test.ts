import { expect, it } from "vitest";
import type { OrderBook } from "@/types/trading";
import { ReplayDepth } from "@/lib/orderflow/replayDepth";

it("reveals only recent books received and timestamped before the Replay boundary", () => {
  const archive = new ReplayDepth();
  const book: OrderBook = {
    symbol: "HL:BTC", time: 59000, simulated: false,
    bids: [{ price: 99, quantity: 2 }], asks: [{ price: 100, quantity: 3 }],
  };
  archive.accept(book, 59001);
  expect(archive.before(book.symbol, 60000, 65000)).toBeUndefined();
  archive.recording = book.symbol;
  archive.accept(book, 59001);
  book.bids[0].quantity = 4;
  archive.accept({ ...book, time: 60000 }, 60001);
  archive.accept({ ...book, time: 61000, simulated: true }, 61001);
  expect(archive.before(book.symbol, 60000, 65000)?.bids[0].quantity).toBe(2);
  expect(archive.window(book.symbol, 60000, 65000, 10).map(column => column.observedAt)).toEqual([59001]);
  expect(archive.window(book.symbol, 59001, 65000, 10)).toEqual([]);
  expect(archive.window(book.symbol, 120002, 120002, 1)).toEqual([]);
  expect(archive.before(book.symbol, 61000, 65000)?.observedAt).toBe(60001);
  expect(archive.before(book.symbol, 59001, 65000)).toBeUndefined();
  expect(archive.before(book.symbol, 64000, 65000)).toBeUndefined();
  expect(archive.before("HL:ETH", 60000, 65000)).toBeUndefined();
  expect(archive.before(book.symbol, 60000, 660000)).toBeUndefined();
});
