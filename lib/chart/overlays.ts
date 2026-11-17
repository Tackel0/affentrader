/**
 * Data model and registry for on-chart overlay primitives. Producers (compare
 * lines, chart patterns, paper-trading orders, strategy trades) publish
 * primitives per chart cell; the overlay layer paints them. Kept free of
 * Vela imports so it can be unit tested and used from stores.
 */
export interface OverlayPoint {
  time: number;
  value: number;
}
export interface OverlayLine {
  kind: "line";
  id: string;
  label?: string;
  color: string;
  width: number;
  dash?: number[];
  points: OverlayPoint[];
  /**
   * `price` plots on the pane's scale, `relative` rebases the line to the
   * first visible price bar, `own` fits the visible values to the pane.
   */
  scale: "price" | "relative" | "own";
}
export interface OverlayMarker {
  kind: "marker";
  time: number;
  price: number;
  shape: "triangleUp" | "triangleDown" | "circle" | "diamond" | "flag";
  color: string;
  label?: string;
  position: "above" | "below" | "at";
}
export interface OverlayHLine {
  orderId?:string;
  kind: "hline";
  id: string;
  price: number;
  color: string;
  label?: string;
  dash?: number[];
  width?: number;
}
export interface OverlayBox {
  kind: "box";
  time1: number;
  time2: number;
  price1: number;
  price2: number;
  fill: string;
  stroke: string;
  label?: string;
}
export interface OverlaySegment {
  kind: "segment";
  from: { time: number; price: number };
  to: { time: number; price: number };
  color: string;
  width: number;
  dash?: number[];
  label?: string;
}
export type OverlayPrimitive =
  | OverlayLine
  | OverlayMarker
  | OverlayHLine
  | OverlayBox
  | OverlaySegment;

const registry = new Map<string, Map<string, OverlayPrimitive[]>>();
const listeners = new Set<(cellId: string) => void>();

/** Replace everything `owner` has published for a chart cell. */
export function setOverlay(
  cellId: string,
  owner: string,
  primitives: OverlayPrimitive[],
) {
  const owners = registry.get(cellId) ?? new Map<string, OverlayPrimitive[]>();
  if (primitives.length) owners.set(owner, primitives);
  else owners.delete(owner);
  registry.set(cellId, owners);
  listeners.forEach((listener) => listener(cellId));
}

export function getOverlays(cellId: string): OverlayPrimitive[] {
  const owners = registry.get(cellId);
  return owners ? [...owners.values()].flat() : [];
}

export function clearOverlays(cellId: string) {
  registry.delete(cellId);
  listeners.forEach((listener) => listener(cellId));
}

export function onOverlayChange(listener: (cellId: string) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Value of a line at `time`: the last point at or before it, or null. */
export function valueAt(points: readonly OverlayPoint[], time: number): number | null {
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time <= time) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 ? points[found].value : null;
}

// Diagnostic handle for the browser console (read-only snapshot access).
if (typeof window !== "undefined")
  (window as unknown as Record<string, unknown>).__afOverlays = {
    get: getOverlays,
    set: setOverlay,
    cells: () => [...registry.keys()],
  };

