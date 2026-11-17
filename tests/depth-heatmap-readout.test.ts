import { defaultDepthHeatmap } from "@/lib/orderflow/depthHeatmap";
import { paintDepthHeatmap } from "@/lib/orderflow/depthHeatmapRenderer";
import { expect, it, vi } from "vitest";
import { clearDepthSurface, depthHeatmapReadout, publishDepthSurface } from "@/lib/orderflow/depthHeatmapReadout";

it("reads only the latest modeled sample in the selected Replay candle and rejects stale identities", () => {
  const identity = { symbol: "HL:BTC", timeframe: "1m", live: false, source: "exchange", replayThrough: 120000 };
  const owner = { now: 120000, message: "" };
  publishDepthSurface("test", {
    owner, identity,
    cells: [
      { from: 59000, to: 60000, lower: 100, upper: 101, bid: 8, ask: 0 },
      { from: 61000, to: 63000, lower: 100, upper: 101, bid: 2, ask: 0 },
      { from: 119000, to: 120000, lower: 100, upper: 101, bid: 5, ask: 1 },
      { from: 120000, to: 121000, lower: 100, upper: 101, bid: 99, ask: 0 },
    ],
  });
  try {
    expect(depthHeatmapReadout("test", identity, 60000, 100)).toEqual({ receivedAt: 119000, displayedUntil: 120000, lower: 100, upper: 101, bid: 5, ask: 1 });
    expect(depthHeatmapReadout("test", identity, 0, 100)?.bid).toBe(8);
    expect(depthHeatmapReadout("test", identity, 120000, 100)).toBeNull();
    expect(depthHeatmapReadout("test", identity, 60000, 101)).toMatchObject({ receivedAt: 119000, lowest: 100, highest: 101, bid: undefined, topBid: { bid: 5 }, topAsk: { ask: 1 } });
    expect(depthHeatmapReadout("test", { ...identity, replayThrough: 60000 }, 0, 100)).toBeUndefined();
    expect(depthHeatmapReadout("test", { ...identity, source: "other" }, 60000, 100)).toBeUndefined();
  } finally {
    clearDepthSurface("test", owner);
  }
  expect(depthHeatmapReadout("test", identity, 60000, 100)).toBeUndefined();
});

it("publishes a sample for readout even when its time projection is outside the canvas", () => {
  const identity = { symbol: "HL:BTC", timeframe: "1m", live: true, source: "exchange", replayThrough: null };
  const owner = {
    now: 62000, message: "", identity, style: { ...defaultDepthHeatmap(), rowSize: 1 },
    columns: [{ observedAt: 61000, exchangeTime: 61000,
      bids: [{ price: 100, quantity: 2 }], asks: [{ price: 101, quantity: 3 }] }],
  };
  const fillRect = vi.fn();
  const ctx = { fillRect } as unknown as CanvasRenderingContext2D;
  const args = { coords: { width: 100, timeToX: (time: number) => time - 60000 } } as Parameters<typeof paintDepthHeatmap>[1];
  try {
    paintDepthHeatmap(ctx, args, owner, () => true, cells => publishDepthSurface("test", { owner, identity, cells }));
    expect(fillRect).not.toHaveBeenCalled();
    expect(depthHeatmapReadout("test", identity, 60000, 100.5)).toEqual({
      receivedAt: 61000, displayedUntil: 62000, lower: 100, upper: 101, bid: 2, ask: 0,
    });
  } finally {
    clearDepthSurface("test", owner);
  }
});

it("publishes an empty model while awaiting the first order-book sample", () => {
  const inspect = vi.fn();
  paintDepthHeatmap({} as CanvasRenderingContext2D, {} as Parameters<typeof paintDepthHeatmap>[1],
    { now: 1000, message: "Collecting observed depth snapshots." }, () => true, inspect);
  expect(inspect).toHaveBeenCalledExactlyOnceWith([]);
});
