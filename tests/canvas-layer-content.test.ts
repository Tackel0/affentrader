// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { canvasLayer } from "@/lib/chart/canvasLayer";
import { bindCellContext } from "@/lib/chart/cellContext";
import { createFootprintMagnifierSurface } from "@/lib/orderflow/footprintMagnifierSurface";

it("releases a dormant layer's backing buffer and restores the last Vela sizing on activation", () => {
  const host = document.createElement("div");
  const canvas = document.createElement("canvas");
  host.append(canvas);
  const unbind = bindCellContext(host, () => ({ id: "primary", symbol: "BTCUSDT", timeframe: "1m", replay: false }));
  const ctx = {
    setTransform: vi.fn(), clearRect: vi.fn(), scale: vi.fn(), save: vi.fn(),
    beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const acquire = vi.spyOn(canvas, "getContext").mockReturnValue(ctx);
  const paint = vi.fn();
  let active = false;
  const layer = canvasLayer(paint, () => active);
  const args = { coords: { width: 200, dpr: 2 }, bounds: { top: 10, height: 100 } } as unknown as RendererLayerArgs;
  const size = () => [canvas.width, canvas.height];
  canvas.width = 400;
  canvas.height = 240;
  layer.mount(canvas);
  try {
    layer.render(args);
    layer.render(args);
    expect(size()).toEqual([0, 0]);
    expect(acquire).not.toHaveBeenCalled();
    active = true;
    layer.render(args);
    expect(size()).toEqual([400, 240]);
    expect(paint).toHaveBeenCalledTimes(1);

    active = false;
    layer.render(args);
    layer.resizeBacking?.(640, 360);
    expect(size()).toEqual([0, 0]);
    layer.render(args);
    expect(size()).toEqual([0, 0]);
    expect(acquire).toHaveBeenCalledTimes(1);
    active = true;
    layer.render(args);
    expect(size()).toEqual([640, 360]);
    expect(paint).toHaveBeenCalledTimes(2);
    layer.resizeBacking?.(800, 480);
    expect(size()).toEqual([800, 480]);
  } finally {
    layer.destroy();
    unbind();
  }
});

it("releases the footprint magnifier buffer and restores it when inspecting again", () => {
  const host = document.createElement("div"), plot = document.createElement("canvas");
  host.append(plot);
  const ctx = { setTransform: vi.fn(), clearRect: vi.fn() } as unknown as CanvasRenderingContext2D;
  const acquire = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  const magnifier = createFootprintMagnifierSurface();
  magnifier.mount(plot);
  try {
    expect(magnifier.acquire(1)).toBe(ctx);
    const overlay = host.querySelector<HTMLCanvasElement>("canvas[data-footprint-magnifier]")!;
    expect([overlay.width, overlay.height]).toEqual([plot.width, plot.height]);
    magnifier.clear();
    expect([overlay.width, overlay.height]).toEqual([plot.width, plot.height]);
    magnifier.release();
    expect([overlay.width, overlay.height]).toEqual([0, 0]);
    expect(magnifier.acquire(1)).toBe(ctx);
    expect([overlay.width, overlay.height]).toEqual([plot.width, plot.height]);
    magnifier.destroy();
    expect([overlay.width, overlay.height]).toEqual([0, 0]);
    expect(host.contains(overlay)).toBe(false);
  } finally { magnifier.destroy(); acquire.mockRestore(); }
});
