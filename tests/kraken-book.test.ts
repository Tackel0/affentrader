import { expect, it } from "vitest";
import { KrakenBook, parseKrakenBookMessage } from "@/lib/market/krakenBook";

it("validates Kraken decimal precision and requires a fresh snapshot after corruption", () => {
  const book = new KrakenBook("BTC/USD");
  const snapshot = parseKrakenBookMessage('{"symbol":"BTC/USD","bids":[{"price":100.0,"qty":2.000}],"asks":[{"price":101.0,"qty":3.000}],"checksum":2153382246}');
  const update = parseKrakenBookMessage('{"symbol":"BTC/USD","bids":[{"price":100.0,"qty":4.000}],"asks":[],"checksum":2771476154}');
  expect(book.apply("update", update, 1)).toBeNull();
  expect(book.apply("snapshot", snapshot, 2)?.bids).toEqual([{ price: 100, quantity: 2 }]);
  expect(book.apply("update", update, 3)?.bids).toEqual([{ price: 100, quantity: 4 }]);
  expect(() => book.apply("update", { ...update as object, checksum: 0 }, 4)).toThrow(/checksum/);
  expect(book.apply("update", update, 5)).toBeNull();
  expect(book.apply("snapshot", snapshot, 6)?.bids).toEqual([{ price: 100, quantity: 2 }]);
});
