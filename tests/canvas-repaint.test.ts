import { afterEach, describe, expect, it, vi } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { NativeRenderer } from "@luxalgo/vela";
import { canvasLayer, invalidateCanvasLayers } from "@/lib/chart/canvasLayer";
import { bindCellContext } from "@/lib/chart/cellContext";

const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); vi.unstubAllGlobals(); });
function frames() {
  let queued: FrameRequestCallback | null = null;
  const request = vi.fn((callback: FrameRequestCallback) => { queued = callback; return 1; });
  const cancel = vi.fn(() => { queued = null; });
  vi.stubGlobal("requestAnimationFrame", request); vi.stubGlobal("cancelAnimationFrame", cancel);
  return { request, cancel, flush() { const callback = queued; queued = null; callback?.(100); } };
}
function layer(id: string) {
  const host = { dataset: {} } as HTMLElement;
  const unbind = bindCellContext(host, () => ({ id, symbol: "BTCUSDT", timeframe: "1h", replay: false }));
  const ctx = Object.fromEntries(["setTransform", "clearRect", "scale", "save", "beginPath", "rect", "clip", "restore"].map(name => [name, vi.fn()]));
  const canvas = { width: 500, height: 200, isConnected: true, closest: () => host, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const paint = vi.fn(), value = canvasLayer(paint);
  value.mount(canvas);
  const args = { coords: { dpr: 1, width: 500 }, bounds: { top: 5, height: 180 }, nowMs: 1 } as RendererLayerArgs;
  value.render(args);
  disposers.push(() => { value.destroy(); unbind(); });
  return { value, paint, canvas, args, ctx };
}
describe("host overlay repaint without renderer relayout", () => {
  it("requests a native frame without touching canvas geometry", () => {
    const requestPaint = (NativeRenderer.prototype as unknown as { requestPaint(): void }).requestPaint;
    const invalidate = vi.fn();
    const syncSize = vi.fn();
    requestPaint.call({ scheduler: { invalidate }, syncSize });
    expect(invalidate).toHaveBeenCalledExactlyOnceWith(4);
    expect(syncSize).not.toHaveBeenCalled();
  });
  it("coalesces updates and paints the latest projection rather than resizing the chart", () => {
    const clock = frames(), overlay = layer("primary");
    invalidateCanvasLayers("primary"); invalidateCanvasLayers("primary"); invalidateCanvasLayers("primary");
    const latest = { ...overlay.args, nowMs: 2 };
    overlay.value.render(latest);
    expect(clock.request).toHaveBeenCalledTimes(1);
    clock.flush();
    expect(overlay.paint).toHaveBeenCalledTimes(3);
    expect(overlay.paint.mock.calls.at(-1)![1]).toBe(latest);
    expect(overlay.ctx.rect).toHaveBeenLastCalledWith(0, 5, 500, 180);
  });
  it("repaints only the requested workspace cell", () => {
    const clock = frames(), first = layer("primary"), second = layer("satellite");
    invalidateCanvasLayers("primary"); clock.flush();
    expect(first.paint).toHaveBeenCalledTimes(2);
    expect(second.paint).toHaveBeenCalledTimes(1);
    invalidateCanvasLayers("satellite"); clock.flush();
    expect(second.paint).toHaveBeenCalledTimes(2);
  });
  it("skips disconnected canvases and cancels the final frame on teardown", () => {
    const clock = frames(), overlay = layer("primary");
    Object.assign(overlay.canvas, { isConnected: false });
    invalidateCanvasLayers("primary"); clock.flush();
    expect(overlay.paint).toHaveBeenCalledTimes(1);
    invalidateCanvasLayers("primary"); overlay.value.destroy();
    expect(clock.cancel).toHaveBeenCalledWith(1);
    clock.flush(); expect(overlay.paint).toHaveBeenCalledTimes(1);
  });
});
