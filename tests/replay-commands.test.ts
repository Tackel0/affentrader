import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { bindReplayCommands, type ReplayCommandHost } from "@/lib/chart/replayCommands";
import type { ReplayCommand } from "@/types/workspace";
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
async function settle() { for (let i = 0; i < 6; i++) await Promise.resolve(); }
function setup(pending: ReplayCommand | null = null) {
  const store = createStore<{ command: ReplayCommand | null; other: number }>(() => ({ command: pending, other: 0 }));
  const bars = [{ time: 1000, open: 1, high: 2, low: 1, close: 2, volume: 10 }, { time: 2000, open: 2, high: 3, low: 2, close: 3, volume: 20 }];
  const env = { symbol: "HL:BTC", timeframe: "5m", epoch: 0, owner: "cell-1", bars };
  const chart = { market: { symbol: env.symbol, timeframe: env.timeframe }, historyComplete: vi.fn(async () => {}),
    replay: { start: vi.fn(async (_options: { from: number }) => {}), stop: vi.fn(), step: vi.fn(), play: vi.fn(), pause: vi.fn() } };
  let revision = 0, identity = true, id = 0;
  const host: ReplayCommandHost = { pending: () => store.getState().command,
    claim(command) { if (store.getState().command !== command) return false; store.setState({ command: null }); return true; },
    subscribe: listener => store.subscribe(listener), advance: () => ++revision, current: value => identity && revision === value,
    environment: () => env, present: vi.fn(), error: vi.fn() };
  const off = bindReplayCommands(chart as unknown as Parameters<typeof bindReplayCommands>[0], host);
  return { chart, env, host, off, store, identity: (value: boolean) => { identity = value; },
    send: (action: ReplayCommand["action"], options: Partial<ReplayCommand> = {}) => store.setState({ command: { id: ++id, action, ...options } }) };
}
describe("primary Replay command delivery", () => {
  it("delivers every rapid step before React could coalesce the command slot", () => {
    const f = setup(); f.send("step"); f.send("step"); f.send("step");
    expect(f.chart.replay.step).toHaveBeenCalledTimes(3); expect(f.store.getState().command).toBeNull();
    f.store.setState({ other: 1 }); expect(f.chart.replay.step).toHaveBeenCalledTimes(3); f.off();
  });
  it("stops synchronously before a sidebar/style/reset update can follow the click", () => {
    const f = setup(); f.send("stop"); expect(f.chart.replay.stop).toHaveBeenCalledOnce();
    f.store.setState({ other: 1 }); expect(f.chart.replay.stop).toHaveBeenCalledOnce(); f.off();
  });
  it("cancels an entry still awaiting initial history when Stop wins", async () => {
    const f = setup(), wait = deferred(); f.chart.historyComplete.mockReturnValue(wait.promise);
    f.send("start"); f.send("stop"); wait.resolve(); await settle();
    expect(f.chart.replay.start).not.toHaveBeenCalled(); expect(f.host.present).not.toHaveBeenCalled(); expect(f.chart.replay.stop).toHaveBeenCalledOnce(); f.off();
  });
  it("uses the latest seek and fresh candles after history settles", async () => {
    const f = setup(), wait = deferred(); f.chart.historyComplete.mockReturnValue(wait.promise);
    f.send("start", { from: 1000 }); f.send("seek", { from: 2000 }); wait.resolve(); await settle();
    expect(f.chart.replay.start).toHaveBeenCalledExactlyOnceWith({ from: 2000 }); expect(f.host.present).toHaveBeenCalledExactlyOnceWith(f.env.bars[1]); f.off();
  });
  it.each(["symbol", "timeframe", "epoch", "owner"])("rejects stale %s before native Replay starts", async field => {
    const f = setup(), wait = deferred(); f.chart.historyComplete.mockReturnValue(wait.promise); f.send("start");
    Object.assign(f.env, { [field]: field === "epoch" ? 1 : "changed" }); wait.resolve(); await settle();
    expect(f.chart.replay.start).not.toHaveBeenCalled(); expect(f.host.error).toHaveBeenCalledOnce(); f.off();
  });
  it("does not publish an old selected bar after a later Stop or destroyed chart", async () => {
    for (const change of ["stop", "destroy"]) {
      const f = setup(), wait = deferred(); f.chart.replay.start.mockReturnValue(wait.promise); f.send("start"); await settle();
      expect(f.chart.replay.start).toHaveBeenCalledOnce(); if (change === "stop") f.send("stop"); else { f.identity(false); f.off(); }
      wait.resolve(); await settle(); expect(f.host.present).not.toHaveBeenCalled(); f.off();
    }
  });
  it("consumes a command queued before binding once and detaches completely", () => {
    const f = setup({ id: 1, action: "step" }); expect(f.chart.replay.step).toHaveBeenCalledOnce();
    f.off(); f.send("stop"); expect(f.chart.replay.stop).not.toHaveBeenCalled(); expect(f.store.getState().command?.action).toBe("stop");
  });
  it("retains all play/pause/speed commands and reports only current failures", async () => {
    const f = setup(); f.send("play", { intervalMs: 200 }); f.send("pause"); f.send("play");
    expect(f.chart.replay.play.mock.calls).toEqual([[200], [1000]]); expect(f.chart.replay.pause).toHaveBeenCalledOnce();
    const wait = deferred(); f.chart.historyComplete.mockImplementation(() => wait.promise.then(() => { throw new Error("old failure"); }));
    f.send("start"); f.send("stop"); wait.resolve(); await settle(); expect(f.host.error).not.toHaveBeenCalled(); f.off();
  });
});
