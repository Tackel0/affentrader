// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { bindCellContext } from "@/lib/chart/cellContext";
import { bindOrderLineEditor, registerChartOrderLines } from "@/lib/trading/chartOrderLines";
import type { Order } from "@/lib/trading/broker";
import { usePaperStore } from "@/stores/usePaperStore";

const { registerLayer } = vi.hoisted(() => ({ registerLayer: vi.fn() }));
vi.mock("@luxalgo/vela", () => ({ registerRendererLayer: registerLayer }));
vi.mock("@/lib/trading/paperCommands", () => ({ paperCommands: { cancelReviewed: vi.fn() } }));

it("skips canvas and DOM layout while no order is visible and clears the last line once", () => {
  const { live, mode } = usePaperStore.getState();
  const order: Order = { id: "limit-1", symbol: "BTCUSDT", side: "buy", type: "limit", quantity: 1, price: 100, reduceOnly: false, status: "working", createdAt: 1 };
  const parent = document.createElement("div");
  const host = document.createElement("div");
  const canvas = document.createElement("canvas");
  parent.append(host);
  host.append(canvas);
  document.body.append(parent);
  const context = { id: "primary", symbol: "BTCUSDT", timeframe: "1m", replay: false };
  const unbindCell = bindCellContext(host, () => context);
  const editor = vi.fn();
  const unbindEditor = bindOrderLineEditor(context.id, editor);
  const rect = vi.spyOn(canvas, "getBoundingClientRect");
  const ctx = {
    setTransform: vi.fn(), clearRect: vi.fn(), scale: vi.fn(), save: vi.fn(), restore: vi.fn(),
    beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), setLineDash: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    stroke: vi.fn(), measureText: () => ({ width: 40 }), fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(),
  };
  const acquire = vi.spyOn(canvas, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  const args = {
    coords: { dpr: 1, width: 390, priceToY: (price: number) => price },
    scale: {}, bounds: { top: 0, height: 200 }, theme: { background: "#131722" },
  } as unknown as RendererLayerArgs;
  let repaint: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { repaint = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { repaint = undefined; });
  usePaperStore.setState({ mode: "live", live: { ...live, orders: [{ ...order, status: "filled" }] } });
  registerChartOrderLines();
  const layer = registerLayer.mock.lastCall![0].create();
  layer.mount(canvas);
  try {
    const root = parent.querySelector<HTMLDivElement>(".chart-order-lines")!;
    for (let frame = 0; frame < 30; frame++) layer.render(args);
    expect(root.hidden).toBe(true);
    expect(rect).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();

    usePaperStore.setState({ live: { ...live, orders: [order] } });
    repaint?.(0);
    expect(root.hidden).toBe(false);
    expect(rect).toHaveBeenCalledOnce();
    expect(ctx.clearRect).toHaveBeenCalledOnce();
    root.querySelector<HTMLButtonElement>(".chart-order-price")!.click();
    expect(editor).toHaveBeenCalledWith(expect.objectContaining({ order }));

    usePaperStore.setState({ live: { ...live, orders: [{ ...order, status: "canceled" }] } });
    repaint?.(0);
    for (let frame = 0; frame < 30; frame++) layer.render(args);
    expect(root.hidden).toBe(true);
    expect(root.children).toHaveLength(0);
    expect(rect).toHaveBeenCalledOnce();
    expect(ctx.clearRect).toHaveBeenCalledTimes(2);
  } finally {
    layer.destroy();
    unbindCell();
    unbindEditor();
    parent.remove();
    usePaperStore.setState({ live, mode });
    vi.unstubAllGlobals();
  }
});
