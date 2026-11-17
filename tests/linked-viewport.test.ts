import type { VisibleRange } from "@luxalgo/vela";
import { afterEach, expect, it, vi } from "vitest";
import { bindLinkedViewport } from "@/lib/chart/viewportLink";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

type LinkedChart = Parameters<typeof bindLinkedViewport>[0];
const initial = useWorkspaceStore.getState();
afterEach(() => {
  useWorkspaceStore.setState({ sync: initial.sync });
  vi.unstubAllGlobals();
});

function fakeChart(timeframe: string, quantize = (time: number) => time) {
  let visible: VisibleRange | null = null;
  const handlers = new Map<string, (range: VisibleRange) => void>();
  const move = (range: VisibleRange) => { visible = range; handlers.get("viewport:changed")?.(range); };
  const apply = vi.fn((range: VisibleRange) => move({ from: quantize(range.from), to: quantize(range.to) }));
  const chart = {
    market: { timeframe },
    on(name: string, listener: (range: VisibleRange) => void) {
      handlers.set(name, listener);
      return () => { handlers.delete(name); };
    },
    getVisibleRange: () => visible,
    setVisibleRange: apply,
  } as unknown as LinkedChart;
  return { chart, move, apply, handlers };
}

it("coalesces local moves and prevents a differently rounded follower from sending an echo", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  const flush = () => { const current = [...frames.values()]; frames.clear(); current.forEach((callback) => callback(0)); };
  const sync = { ...initial.sync, timeRange: true };
  useWorkspaceStore.setState({ sync });
  const workspaceChanged = vi.fn();
  const offWorkspace = useWorkspaceStore.subscribe(workspaceChanged);
  const primary = fakeChart("1m");
  const follower = fakeChart("5m", (time) => Math.round(time / 300_000) * 300_000);
  const offPrimary = bindLinkedViewport(primary.chart, "primary");
  const offFollower = bindLinkedViewport(follower.chart, "follower");
  try {
    primary.move({ from: 300_000, to: 900_000 });
    primary.move({ from: 420_000, to: 1_020_000 });
    expect(frames.size).toBe(1);
    flush();
    expect(follower.apply).toHaveBeenLastCalledWith({ source: "primary", from: 420_000, to: 1_020_000 });
    expect(follower.apply).toHaveBeenCalledTimes(1);
    expect(primary.apply).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);

    primary.move({ from: 360_000, to: 960_000 });
    flush();
    expect(follower.apply).toHaveBeenCalledTimes(1);

    primary.move({ from: 480_000, to: 1_080_000 });
    follower.move({ from: 600_000, to: 1_200_000 });
    flush();
    expect(primary.apply).toHaveBeenLastCalledWith({ source: "follower", from: 600_000, to: 1_200_000 });
    expect(primary.apply).toHaveBeenCalledTimes(1);
    expect(workspaceChanged).not.toHaveBeenCalled();

    primary.move({ from: 660_000, to: 1_260_000 });
    useWorkspaceStore.setState({ sync: { ...sync, timeRange: false } });
    expect(frames.size).toBe(0);
    follower.move({ from: 900_000, to: 1_500_000 });
    expect(frames.size).toBe(0);
    useWorkspaceStore.setState({ sync });
    primary.move({ from: 720_000, to: 1_320_000 });
    offPrimary();
    expect(frames.size).toBe(0);
    expect(primary.handlers.size).toBe(0);
  } finally {
    offPrimary();
    offFollower();
    offWorkspace();
  }
});
