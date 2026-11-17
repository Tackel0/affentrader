import { expect, it } from "vitest";
import { depthSnapshotCsv } from "@/lib/orderflow/depthSnapshotCsv";

it("exports the visible ranks and identifies the clock used by each provider", () => {
  const bids = Array.from({ length: 10 }, (_, index) => ({ price: 100 - index, quantity: 0.012345678901234 }));
  const book = { bids, asks: [{ price: 101, quantity: 2 }] };
  const live = depthSnapshotCsv(book, { symbol: "BTCUSDT", snapshotTime: 1000 }).split("\r\n");
  expect(live).toHaveLength(8);
  expect(live[1]).toBe('"BTCUSDT","live","1970-01-01T00:00:01.000Z","local_receipt","","","bid","1","100","0.012345678901234",""');
  expect(live[7]).toContain('"ask","1","101","2"');
  const paused = depthSnapshotCsv(book, { symbol: "BTCUSDT", snapshotTime: 1000, pausedAt: 3000 });
  expect(paused.split("\r\n")[1]).toMatch(/,"1970-01-01T00:00:03.000Z"$/);
  const replay = depthSnapshotCsv(book, { symbol: "HL:BTC", snapshotTime: 1000, observedAt: 1200, replayThrough: 2000 });
  expect(replay).toContain('"recorded_replay","1970-01-01T00:00:01.000Z","venue","1970-01-01T00:00:01.200Z","1970-01-01T00:00:02.000Z"');
});
