import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { expect, it, vi } from "vitest";
import { ReplayDepthDb, type StoredDepth } from "@/lib/orderflow/replayDepthDb";

it("restores the latest sample across connections and expires old snapshots", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  let now = 1000000;
  const store = new ReplayDepthDb("test-depth", () => now);
  const reopened = new ReplayDepthDb("test-depth", () => now);
  const record = (receivedAt: number): StoredDepth => ({
    symbol: "HL:BTC", receivedAt, bucket: Math.floor(receivedAt / 1000),
    book: { symbol: "HL:BTC", time: receivedAt, simulated: false, bids: [{ price: 100, quantity: 2 }], asks: [{ price: 101, quantity: 3 }] },
  });
  try {
    await store.update([record(999500)]);
    await reopened.update([record(999100)]);
    expect(await reopened.update([], true)).toEqual([record(999500)]);
    await reopened.update([record(999800)]);
    expect(await store.update([], true)).toEqual([record(999800)]);
    now += 601000;
    expect(await reopened.update([], true)).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});
