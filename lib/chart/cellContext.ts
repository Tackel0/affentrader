import type { Timeframe } from "@/types/trading";
import type { Vela } from "@luxalgo/vela";
export interface CellContext {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  replay: boolean;
  replayThrough?: number | null;
}
const contexts = new WeakMap<HTMLElement, { read: () => CellContext; redraw?: () => void }>();
export function bindCellContext(
  host: HTMLElement,
  context: () => CellContext,
  redraw?: () => void,
): () => void {
  host.dataset.velaCell = "true";
  contexts.set(host, { read: context, redraw });
  return () => {
    contexts.delete(host);
    delete host.dataset.velaCell;
  };
}
export function contextForCanvas(
  canvas: HTMLElement,
): CellContext | undefined {
  const host = canvas.closest<HTMLElement>("[data-vela-cell]");
  return host ? contexts.get(host)?.read() : undefined;
}
/** Request a real SDK frame (including grid/body modulation), not only an
 * out-of-band custom-canvas repaint with an old frame clock. */
export function requestCellFrame(canvas: HTMLElement): boolean {
  const host = canvas.closest<HTMLElement>("[data-vela-cell]"), entry = host ? contexts.get(host) : undefined;
  if (!entry?.redraw) return false;
  entry.redraw(); return true;
}

export function requestChartPaint(chart: Vela | null): void {
  (chart?.renderer as (Vela["renderer"] & { requestPaint(): void }) | undefined)?.requestPaint();
}
