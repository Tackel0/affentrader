import { describe, expect, it, vi } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { binanceTrade } from "@/lib/market/binanceStream";
import { BinanceFootprintBackfill, footprintBackfillRequest } from "@/lib/orderflow/footprintBackfill";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";

const start = Date.UTC(2026, 10, 21);
const row = (id: number, time = start + id * 1000) => ({ a: id, T: time, p: "100", q: "2", m: id % 2 === 0, f: id * 3, l: id * 3 + 2 });
const grid = { step: 1, ratio: 3 };

describe("Binance Footprint backfill", () => {
  it("shares one page per market, draws completed buckets and counts overlapping live executions once", async () => {
    const load = vi.fn(async ({ fromId }: { fromId?: number }) => fromId === undefined ? [row(124), row(125)] : [row(30), row(61)]);
    const source = new BinanceFootprintBackfill(load);
    const notifyA = vi.fn(), notifyB = vi.fn();
    const a = source.attach("BTCUSDT", notifyA), b = source.attach("BTCUSDT", notifyB);
    const history = new FootprintHistory("1m"), peer = new FootprintHistory("1m");
    history.add([binanceTrade({ ...row(125), s: "BTCUSDT", e: "aggTrade" }, "BTCUSDT")!]);
    const target = { through: start + 60_000, pages: 5 };
    expect(a.read(history, target)).toMatch(/loading older trades/);
    b.read(peer, target);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(notifyA).toHaveBeenCalledTimes(1));
    expect(notifyB).toHaveBeenCalledTimes(1);
    a.read(history, target);
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: "BTCUSDT", fromId: 0, limit: 124 }));
    await vi.waitFor(() => expect(notifyA).toHaveBeenCalledTimes(2));
    expect(a.read(history, target)).toMatch(/observed trades from .*gaps possible/);
    b.read(peer, target);
    expect(history.coverage.trades).toBe(4);
    expect(history.read(grid)).toEqual(peer.read(grid));
    expect(history.read(grid).map(({ time, delta, volume }) => [time - start, delta, volume])).toEqual([[0, -2, 2], [60_000, 2, 2], [120_000, 0, 4]]);
    expect(history.read(grid)[0].levels[0].sellCount).toBe(3);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("bounds initial loading and resumes backwards after an older viewport request", async () => {
    const load = vi.fn(async ({ fromId }: { fromId?: number }) => [row(fromId ?? 20_000)]);
    const notify = vi.fn(), session = new BinanceFootprintBackfill(load).attach("BTCUSDT", notify);
    const history = new FootprintHistory("1m");
    const first = { through: start, pages: 5 };
    for (let i = 1; i <= first.pages; i++) {
      session.read(history, first);
      await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(i));
    }
    expect(session.read(history, first)).toMatch(/history limit reached/);
    expect(load).toHaveBeenCalledTimes(5);
    expect(session.read(history, { ...first, pages: 16 })).toMatch(/loading older trades/);
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ fromId: 15000, limit: 1000 }));
  });

  it("cancels an outstanding page after the final renderer leaves", async () => {
    let finish!: (rows: ReturnType<typeof row>[]) => void;
    const load = vi.fn(({ signal }: { signal?: AbortSignal }) => new Promise<ReturnType<typeof row>[]>(resolve => {
      expect(signal?.aborted).toBe(false);
      finish = resolve;
    }));
    const source = new BinanceFootprintBackfill(load), notify = vi.fn();
    const a = source.attach("BTCUSDT", notify), b = source.attach("BTCUSDT", vi.fn());
    a.read(new FootprintHistory("1m"), { through: start, pages: 5 });
    const signal = load.mock.calls[0][0].signal;
    a.close();
    expect(signal?.aborted).toBe(false);
    b.close();
    expect(signal?.aborted).toBe(true);
    finish([row(1)]);
    await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps live data intact when a malformed page arrives and avoids a retry on every paint", async () => {
    const load = vi.fn(async () => [row(2), row(1)]);
    const notify = vi.fn(), session = new BinanceFootprintBackfill(load).attach("BTCUSDT", notify);
    const history = new FootprintHistory("1m");
    history.add([binanceTrade({ ...row(4), s: "BTCUSDT", e: "aggTrade" }, "BTCUSDT")!]);
    const target = { through: start, pages: 5 };
    session.read(history, target);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
    expect(session.read(history, target)).toMatch(/unavailable; live trades continue/);
    expect(session.read(history, target)).toMatch(/unavailable; live trades continue/);
    expect(load).toHaveBeenCalledOnce();
    expect(history.coverage.trades).toBe(1);
  });

  it("requests recent candle slots first and advances the target when the viewport moves back", () => {
    const request = (from: number, to: number) => footprintBackfillRequest({
      bars: Array.from({ length: 20 }, (_, i) => ({ time: start + i * 60_000, open: 1, high: 1, low: 1, close: 1 })),
      coords: { visibleLogicalRange: () => ({ from, to }) } as RendererLayerArgs["coords"],
    });
    expect(request(14, 21)).toEqual({ through: start + 15 * 60_000, pages: 5 });
    expect(request(3, 12)).toEqual({ through: start + 8 * 60_000, pages: 16 });
    expect(request(21, 24)).toBeUndefined();
  });
});
