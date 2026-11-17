"use client";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { contextForCanvas, type CellContext } from "./cellContext";
const liveLayers = new Set<{ canvas: () => HTMLCanvasElement | undefined; repaint: () => void }>();
const dirtyCells = new Set<string>();
let paintFrame = 0;

/** Redraw host-owned canvases without relayouting Vela or dismissing its drawing settings. */
export function invalidateCanvasLayers(cellId: string) {
  dirtyCells.add(cellId);
  if (paintFrame) return;
  paintFrame = requestAnimationFrame(() => {
    paintFrame = 0;
    const cells = new Set(dirtyCells); dirtyCells.clear();
    for (const layer of liveLayers) {
      const canvas = layer.canvas();
      if (canvas?.isConnected && cells.has(contextForCanvas(canvas)?.id ?? "")) layer.repaint();
    }
  });
}

/**
 * Wrap a paint function into a Vela renderer layer. The layer clears its own
 * canvas every frame, clips to the price pane and resolves which workspace
 * cell the canvas belongs to.
 */
export function canvasLayer(
  paint: (
    ctx: CanvasRenderingContext2D,
    args: RendererLayerArgs,
    cell: CellContext,
  ) => void,
) {
  let canvas: HTMLCanvasElement | undefined, lastArgs: RendererLayerArgs | null = null;
  const entry = { canvas: () => canvas, repaint: () => { if (lastArgs) render(lastArgs); } };
  const render = (args: RendererLayerArgs) => {
      lastArgs = args;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = args.coords.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      ctx.save();
      try {
      ctx.beginPath();
      ctx.rect(0, args.bounds.top, args.coords.width, args.bounds.height);
      ctx.clip();
      const cell = contextForCanvas(canvas);
      if (cell) paint(ctx, args, cell);
      } finally { ctx.restore(); }
  };
  return {
    mount: (element: HTMLCanvasElement) => {
      canvas = element;
      liveLayers.add(entry);
    },
    render,
    destroy: () => {
      liveLayers.delete(entry); canvas = undefined; lastArgs = null;
      if (!liveLayers.size && paintFrame) { cancelAnimationFrame(paintFrame); paintFrame = 0; dirtyCells.clear(); }
    },
  };
}

/** Index range of bars whose time falls inside [from, to] (inclusive), padded by one. */
export function visibleSlice(
  bars: readonly { time: number }[],
  from: number,
  to: number,
): [number, number] {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time < from) lo = mid + 1;
    else hi = mid;
  }
  const start = Math.max(0, lo - 1);
  let end = start;
  while (end < bars.length && bars[end].time <= to) end++;
  return [start, Math.min(bars.length, end + 1)];
}
