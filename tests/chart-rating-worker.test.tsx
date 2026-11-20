// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChartRating } from "@/hooks/useChartRating";
import { chartRating, type ChartRatingContext } from "@/lib/ta/chartRating";
import { unpackRatingCandles, type ChartRatingRequest, type ChartRatingResponse } from "@/lib/ta/chartRatingWire";
import type { OHLCV } from "@/types/trading";

const live: ChartRatingContext = { replayActive: false, cursorTime: null, recovering: false, error: null };

function bars(offset = 0): OHLCV[] {
  return Array.from({ length: 240 }, (_, i) => {
    const close = 100 + Math.sin(i / 8) * 3 + i / 100 + offset;
    return { time: (i + 1) * 60_000, open: close - .1, high: close + .5, low: close - .5, close, volume: 100 + i % 17 };
  });
}

class RatingWorker {
  static workers: RatingWorker[] = [];
  onmessage?: (event: MessageEvent<ChartRatingResponse>) => void;
  onerror?: (event: ErrorEvent) => void;
  postMessage = vi.fn<(request: ChartRatingRequest, transfers: Transferable[]) => void>();
  terminate = vi.fn();

  constructor() {
    RatingWorker.workers.push(this);
  }

  respond(request: ChartRatingRequest) {
    const view = chartRating(unpackRatingCandles(request.candles), request.context);
    this.onmessage?.(new MessageEvent("message", { data: { id: request.id, view } }));
  }
}

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  RatingWorker.workers = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.stubGlobal("Worker", RatingWorker);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("background chart technicals", () => {
  it("transfers exact OHLCV values and coalesces rapid updates to the newest snapshot", () => {
    const starting = bars();
    const last = bars(2);
    const { result, rerender, unmount } = renderHook(({ data }) => useChartRating(data, "BTC:1m:0", live), {
      initialProps: { data: starting },
    });
    expect(result.current.calculating).toBe(true);
    advance(0);
    const worker = RatingWorker.workers[0];
    const [[request, transfer]] = worker.postMessage.mock.calls;
    expect(transfer).toEqual([request.candles.buffer]);
    expect(unpackRatingCandles(request.candles)).toEqual(starting);

    rerender({ data: bars(1) });
    rerender({ data: last });
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    act(() => worker.respond(request));
    expect(result.current.view).toEqual(chartRating(starting, live));
    advance(199);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    advance(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    const [latest] = worker.postMessage.mock.calls[1];
    expect(unpackRatingCandles(latest.candles)).toEqual(last);
    act(() => worker.respond(latest));
    expect(result.current.view).toEqual(chartRating(last, live));
    unmount();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("withholds in-flight results when a market changes or Replay seeks backward", () => {
    const data = bars();
    const { result, rerender } = renderHook(({ market, context }) => useChartRating(data, market, context), {
      initialProps: { market: "BTC:1m:0", context: live },
    });
    advance(0);
    const worker = RatingWorker.workers[0];
    const [oldMarket] = worker.postMessage.mock.calls[0];
    const later = { ...live, replayActive: true, cursorTime: data[180].time };
    const earlier = { ...later, cursorTime: data[110].time };
    rerender({ market: "ETH:1m:1", context: later });
    act(() => worker.respond(oldMarket));
    expect(result.current.view.rating).toBeNull();
    advance(200);
    const [oldCursor] = worker.postMessage.mock.calls[1];
    act(() => worker.respond(oldCursor));
    expect(result.current.view.asOf).toBe(later.cursorTime);

    rerender({ market: "ETH:1m:1", context: earlier });
    expect(result.current.view.rating).toBeNull();
    act(() => worker.respond(oldCursor));
    advance(200);
    const [newCursor] = worker.postMessage.mock.calls[2];
    act(() => worker.respond(newCursor));
    expect(result.current.view).toEqual(chartRating(data, earlier));
  });

  it("keeps the newest available rating when a worker fails and hides it during recovery", () => {
    const { result, rerender } = renderHook(({ data, context }) => useChartRating(data, "BTC:1m:0", context), {
      initialProps: { data: bars(), context: live },
    });
    advance(0);
    const worker = RatingWorker.workers[0];
    const newest = bars(1);
    rerender({ data: newest, context: live });
    act(() => worker.onerror?.(new ErrorEvent("error", { cancelable: true })));
    advance(200);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(result.current.view).toEqual(chartRating(newest, live));
    rerender({ data: newest, context: { ...live, recovering: true } });
    expect(result.current.view).toMatchObject({ status: "recovering", rating: null });
  });
});
