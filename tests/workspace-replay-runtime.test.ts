import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceReplay } from "@luxalgo/vela/workspace";
import type { Vela } from "@luxalgo/vela";
import { createWorkspaceReplayRuntime, type ReplayCellIdentity } from "@/lib/chart/workspaceReplayRuntime";
import { bindReplayClock, nativeReplayBoundary } from "@/lib/chart/replayClock";
const base = Date.UTC(2026, 10, 6, 12), minute = 60000;
const runtimes: ReturnType<typeof createWorkspaceReplayRuntime>[] = [];
afterEach(() => { runtimes.splice(0).forEach(runtime => runtime.destroy()); vi.useRealTimers(); });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function chart(timeframe: string, step: number, count = 25, start = base) {
  const bars = Array.from({ length: count }, (_, i) => ({ time: start + i * step * minute, open: 100, high: 102, low: 99, close: 101, volume: 1 }));
  const listeners = new Map<string, Set<(value: never) => void>>(), emit = (event: string, value: unknown) => listeners.get(event)?.forEach(listener => listener(value as never));
  let index = -1, active = false, playing = false, intervalMs = 1000, gate: Promise<void> | undefined;
  const instance = { data: {}, market: { symbol: "KRK:BTC/USD", timeframe }, ready: async () => {}, historyComplete: async () => {},
    on(event: string, listener: (value: never) => void) { const set = listeners.get(event) ?? new Set(); set.add(listener); listeners.set(event, set); return () => { set.delete(listener); }; },
    replay: {
      get state() { return { active, playing, cursorTime: active ? bars[index]?.time ?? null : null, nextTime: active ? bars[index + 1]?.time ?? null : null, remaining: active ? bars.length - index - 1 : 0, intervalMs }; },
      get bounds() { return { first: bars[0].time, last: bars.at(-1)!.time }; },
      start: vi.fn(async ({ from }: { from: number }) => { if (gate) await gate; index = bars.findLastIndex(bar => bar.time <= from); active = true; playing = false; emit("replay:start", { cursorTime: bars[index]?.time ?? null, remaining: bars.length - index - 1 }); }),
      step() { if (!active) return false; if (index + 1 >= bars.length) { active = false; emit("replay:end", { reason: "finished" }); return false; } index++; emit("replay:step", { cursorTime: bars[index].time, remaining: bars.length - index - 1 }); return true; },
      play(ms?: number) { playing = true; intervalMs = ms ?? intervalMs; emit("replay:play", { intervalMs }); },
      pause() { playing = false; emit("replay:pause", undefined); },
      stop() { if (!active) return; active = false; playing = false; emit("replay:end", { reason: "stopped" }); },
    },
  };
  return { instance, asVela: instance as unknown as Vela, bars: () => active ? bars.slice(0, index + 1) : bars,
    gate(value: Promise<void> | undefined) { gate = value; }, emit };
}
function setup() {
  let active = "fast";
  const identities: ReplayCellIdentity[] = [{ id: "fast", symbol: "KRK:BTC/USD", timeframe: "1m" }, { id: "slow", symbol: "KRK:BTC/USD", timeframe: "5m" }];
  const runtime = createWorkspaceReplayRuntime(WorkspaceReplay, { activeId: () => active, expected: () => identities }); runtimes.push(runtime);
  return { runtime, identities, activate(id: string) { active = id; runtime.activeChanged(); } };
}
it("uses the real SDK shared clock and keeps each native orderflow cutoff on completed own-timeframe bars", async () => {
  const { runtime, activate } = setup(), fast = chart("1m", 1), slow = chart("5m", 5, 9, base - 15 * minute);
  await runtime.register("fast", fast.asVela).ready; await runtime.register("slow", slow.asVela).ready;
  const offFast = bindReplayClock(fast.asVela), offSlow = bindReplayClock(slow.asVela);
  const cutoff = (cell: ReturnType<typeof chart>) => nativeReplayBoundary({ data: cell.asVela.data, symbol: cell.instance.market.symbol, timeframe: cell.instance.market.timeframe, bars: cell.bars });
  await runtime.replay.start({ from: base + minute });
  expect(cutoff(fast)).toBe(base + 2 * minute); expect(cutoff(slow)).toBe(base);
  activate("slow"); expect(runtime.replay.state.cursorTime).toBe(base - 5 * minute);
  runtime.replay.step(); expect(cutoff(fast)).toBe(base + 3 * minute); expect(cutoff(slow)).toBe(base);
  runtime.replay.step(); runtime.replay.step(); expect(cutoff(fast)).toBe(base + 5 * minute); expect(cutoff(slow)).toBe(base + 5 * minute);
  expect(runtime.replay.state.cursorTime).toBe(base); expect(runtime.replay.state.active).toBe(true);
  offFast(); offSlow();
});
it("waits for a joining chart's native start promise and rebinds remounted React cells at the same shared cut", async () => {
  const { runtime } = setup(), fast = chart("1m", 1), slow = chart("5m", 5, 9, base - 15 * minute);
  const first = runtime.register("fast", fast.asVela); await first.ready; await runtime.register("slow", slow.asVela).ready;
  await runtime.replay.start({ from: base + minute }); first.dispose();
  const replacement = chart("1m", 1), gate = deferred(); replacement.gate(gate.promise);
  const joined = runtime.register("fast", replacement.asVela); let ready = false; void joined.ready.then(() => { ready = true; });
  await settle(); expect(ready).toBe(false); expect(replacement.instance.replay.state.active).toBe(false);
  gate.resolve(); await joined.ready; expect(replacement.instance.replay.state.cursorTime).toBe(base + minute);
  first.dispose(); await runtime.historyComplete(); expect(runtime.replay.state.active).toBe(true);
});
it("pauses while a visible cell is absent and honors an explicit pause instead of resuming after remount", async () => {
  vi.useFakeTimers(); const { runtime } = setup(), fast = chart("1m", 1), slow = chart("5m", 5, 9, base - 15 * minute);
  await runtime.register("fast", fast.asVela).ready; const old = runtime.register("slow", slow.asVela); await old.ready;
  await runtime.replay.start({ from: base }); runtime.replay.play(50); expect(runtime.replay.state.playing).toBe(true);
  old.dispose(); expect(runtime.replay.state.playing).toBe(false); const before = fast.instance.replay.state.cursorTime;
  vi.advanceTimersByTime(500); expect(fast.instance.replay.state.cursorTime).toBe(before);
  const replacement = chart("5m", 5, 9, base - 15 * minute), gate = deferred(); replacement.gate(gate.promise);
  const joined = runtime.register("slow", replacement.asVela); runtime.replay.pause(); gate.resolve(); await joined.ready;
  expect(runtime.replay.state.playing).toBe(false); runtime.replay.play(50); vi.advanceTimersByTime(50);
  expect(fast.instance.replay.state.cursorTime).toBe(base + minute); runtime.replay.stop();
  expect(fast.instance.replay.state.active).toBe(false); expect(replacement.instance.replay.state.active).toBe(false);
});
it("fails closed for a partial or mismatched grid instead of starting just the ready chart", async () => {
  const { runtime, identities } = setup(), fast = chart("1m", 1), slow = chart("5m", 5, 9, base - 15 * minute);
  await runtime.register("fast", fast.asVela).ready;
  await expect(runtime.replay.start({ from: base })).rejects.toThrow(/every visible chart/); expect(fast.instance.replay.start).not.toHaveBeenCalled();
  await runtime.register("slow", slow.asVela).ready; identities[1].symbol = "KRK:ETH/USD";
  await expect(runtime.replay.start({ from: base })).rejects.toThrow(/grid changed/); expect(runtime.replay.state.active).toBe(false);
});
it("resumes a playing session only after all replacement charts have joined", async () => {
  vi.useFakeTimers(); const { runtime } = setup(), fast = chart("1m", 1), slow = chart("5m", 5, 9, base - 15 * minute);
  await runtime.register("fast", fast.asVela).ready; const old = runtime.register("slow", slow.asVela); await old.ready;
  await runtime.replay.start({ from: base }); runtime.replay.play(50); old.dispose();
  const replacement = chart("5m", 5, 9, base - 15 * minute), gate = deferred(); replacement.gate(gate.promise);
  const joined = runtime.register("slow", replacement.asVela); await settle(); expect(runtime.replay.state.playing).toBe(false);
  gate.resolve(); await joined.ready; expect(runtime.replay.state.playing).toBe(true);
  vi.advanceTimersByTime(50); expect(fast.instance.replay.state.cursorTime).toBe(base + minute);
});
it("ends Replay everywhere and reports a failed late join without an unhandled SDK rejection", async () => {
  const { runtime } = setup(), fast = chart("1m", 1), slow = chart("5m", 5, 9, base - 15 * minute);
  await runtime.register("fast", fast.asVela).ready; const old = runtime.register("slow", slow.asVela); await old.ready;
  await runtime.replay.start({ from: base }); old.dispose();
  const failed = chart("5m", 5, 9, base - 15 * minute); failed.instance.replay.start.mockRejectedValueOnce(new Error("historical source unavailable"));
  await expect(runtime.register("slow", failed.asVela).ready).rejects.toThrow(/historical source unavailable/);
  await settle(); expect(runtime.replay.state.active).toBe(false); expect(fast.instance.replay.state.active).toBe(false); expect(failed.instance.replay.state.active).toBe(false);
});
it("rejects a failed group start without publishing a successful session or leaving another cell in Replay", async () => {
  const { runtime } = setup(), fast = chart("1m", 1), slow = chart("5m", 5, 9, base - 15 * minute);
  await runtime.register("fast", fast.asVela).ready; await runtime.register("slow", slow.asVela).ready;
  const started = vi.fn(); runtime.controller.on("replay:start", started);
  slow.instance.replay.start.mockRejectedValueOnce(new Error("history failed"));
  await expect(runtime.replay.start({ from: base })).rejects.toThrow(/history failed/);
  expect(started).not.toHaveBeenCalled(); expect(runtime.replay.state.active).toBe(false);
  expect(fast.instance.replay.state.active).toBe(false); expect(slow.instance.replay.state.active).toBe(false);
});
