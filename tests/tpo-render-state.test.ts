import { afterEach, describe, expect, it, vi } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { canvasLayer } from "@/lib/chart/canvasLayer";
import { bindCellContext } from "@/lib/chart/cellContext";
import { paintTpoSessions } from "@/lib/orderflow/tpoRenderer";
import { buildTpoSessions } from "@/lib/orderflow/tpoModel";
import { defaultTpo } from "@/lib/orderflow/tpoSettings";
const bars = Array.from({ length: 24 }, (_, i) => ({ time: i * 300000, open: 100, low: 100, high: 102, close: 101, volume: 1 }));
const style = { ...defaultTpo(), rowSize: 1, candlesVisible: false }, sessions = buildTpoSessions(bars, style, "5m");
const args = { bars, bounds: { top: 0, height: 200 }, scale: { min: 95, max: 110 }, theme: { textColor: "#ffffff" },
  coords: { dpr: 1, width: 400, timeToX: (time: number) => time / 86400000 * 400, priceToY: (price: number) => (110 - price) * 10 } } as unknown as RendererLayerArgs;
function context() {
  let depth = 0;
  const ctx = { canvas: { width: 400, height: 200 }, globalAlpha: 1, globalCompositeOperation: "source-over", save: () => { depth++; }, restore: () => { depth--; },
    setTransform() {}, clearRect() {}, scale() {}, beginPath() {}, rect: vi.fn(), fill: vi.fn(), clip() {}, moveTo() {}, lineTo() {}, stroke() {}, setLineDash() {}, fillRect: vi.fn(), fillText() {},
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([30, 60, 160, 255, 0, 0, 0, 0]) })) };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, depth: () => depth, fills: ctx.rect, paths: ctx.fill, reads: ctx.getImageData };
}
afterEach(() => vi.unstubAllGlobals());
describe("TPO canvas state and non-invasive diagnostics", () => {
  it("releases painter and wrapper state after a projection exception, then paints a complete next frame", () => {
    const f = context(), host = { dataset: {} } as HTMLElement, canvas = { width: 400, height: 200, getContext: () => f.ctx, closest: () => host } as unknown as HTMLCanvasElement;
    const detach = bindCellContext(host, () => ({ id: "test", symbol: "TEST", timeframe: "5m", replay: true }));
    const layer = canvasLayer((ctx, value) => paintTpoSessions(ctx, value, sessions, style)); layer.mount(canvas);
    try {
      const invalid = { ...args, coords: { ...args.coords, priceToY: () => { throw Error("projection failed"); } } } as unknown as RendererLayerArgs;
      expect(() => layer.render(invalid)).toThrow("projection failed"); expect(f.depth()).toBe(0);
      for (let cycle = 0; cycle < 40; cycle++) { f.fills.mockClear(); layer.render(args); expect(f.depth()).toBe(0); expect(f.fills.mock.calls.length).toBe(13); expect(f.paths.mock.calls.length).toBe(12 * (cycle + 1)); }
    } finally { layer.destroy(); detach(); }
  });
  it("keeps normal/geometry-only painting free of pixel readback and allows an explicit pixel oracle", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      const normal = context(); paintTpoSessions(normal.ctx, args, sessions, style); expect(normal.reads).not.toHaveBeenCalled();
      vi.stubGlobal("window", { location: { search: "?tpo-frame-audit=1" } }); const geometry = context(); paintTpoSessions(geometry.ctx, args, sessions, style);
      expect(geometry.reads).not.toHaveBeenCalled(); expect(JSON.parse(spy.mock.calls.at(-1)![1])).toMatchObject({ boxes: 12, histogram: true });
      vi.stubGlobal("window", { location: { search: "?tpo-frame-audit=1", hash: "#tpo-pixel-audit" } }); const pixel = context(); paintTpoSessions(pixel.ctx, args, sessions, style);
      expect(pixel.reads).toHaveBeenCalledOnce(); expect(JSON.parse(spy.mock.calls.at(-1)![1]).bluePixels).toBe(1);
      const negative = context(); paintTpoSessions(negative.ctx, args, sessions, { ...style, histogramVisible: false }); expect(JSON.parse(spy.mock.calls.at(-1)![1]).boxes).toBe(0);
    } finally { spy.mockRestore(); }
  });
});
