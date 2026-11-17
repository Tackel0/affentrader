// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useWindowLink } from "@/hooks/useWindowLink";
import { publishLinkedCrosshair, receiveLinkedCrosshair } from "@/lib/chart/crosshairLink";
import { useLinkStore } from "@/stores/useLinkStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

vi.mock("@/lib/windowScope", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/windowScope")>(),
  popoutId: () => undefined, pruneWindows: () => {},
}));

it("forwards local cursor updates once per frame and never echoes remote clears or crosses link groups", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const messages = vi.fn();
  let channel: FakeChannel | undefined;
  class FakeChannel {
    onmessage?: (event: { data: unknown }) => void;
    postMessage = messages;
    close = vi.fn();
    constructor() { channel = this; }
  }
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)); };
  const before = useLinkStore.getState().group, sync = useWorkspaceStore.getState().sync;
  useLinkStore.setState({ group: "red" });
  useWorkspaceStore.setState({ sync: { ...sync, crosshair: true } });
  const hook = renderHook(() => useWindowLink());
  const point = { time: 60_000, price: 120, source: "chart", symbol: "BTCUSDT" };
  try {
    publishLinkedCrosshair(point);
    publishLinkedCrosshair({ ...point, price: 125 });
    expect(frames.size).toBe(1);
    flush();
    expect(messages).toHaveBeenCalledExactlyOnceWith({ type: "crosshair", from: "main", group: "red", point: { time: 60_000, price: 125, symbol: "BTCUSDT" } });
    channel?.onmessage?.({ data: { type: "crosshair", from: "other", group: "red", point: null } });
    expect(frames.size).toBe(0);
    publishLinkedCrosshair(point);
    useLinkStore.setState({ group: "green" });
    expect(frames.size).toBe(0);
    flush();
    expect(messages).toHaveBeenCalledTimes(1);
  } finally {
    hook.unmount();
    receiveLinkedCrosshair(null);
    useLinkStore.setState({ group: before });
    useWorkspaceStore.setState({ sync });
    vi.unstubAllGlobals();
  }
  expect(channel?.close).toHaveBeenCalledOnce();
});
