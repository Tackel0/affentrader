import type { Vela, VisibleRange } from "@luxalgo/vela";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { parseInterval } from "@/lib/market/intervals";
import type { ViewportLink } from "@/types/workspace";

let frame: number | null = null;
let pending: { owner: object; publish: () => void } | null = null;
let linkedRange: ViewportLink | null = null;
const followers = new Set<(range: ViewportLink) => void>();

function sameRange(a: VisibleRange | null, b: VisibleRange, tolerance: number): boolean {
  return !!a && Math.abs(a.from - b.from) <= tolerance && Math.abs(a.to - b.to) <= tolerance;
}

export function bindLinkedViewport(chart: Pick<Vela, "on" | "market" | "getVisibleRange" | "setVisibleRange">, source: string): () => void {
  const owner = {};
  let applying = false;
  const cancelPending = () => {
    if (pending?.owner !== owner) return;
    if (frame !== null) cancelAnimationFrame(frame);
    pending = null;
    frame = null;
  };

  const offViewport = chart.on("viewport:changed", ({ from, to }) => {
    if (applying || !useWorkspaceStore.getState().sync.timeRange || !Number.isFinite(from) || !Number.isFinite(to) || from > to) return;
    const range = { from, to };
    pending = { owner, publish: () => {
      if (!useWorkspaceStore.getState().sync.timeRange || sameRange(linkedRange, range, 1)) return;
      const next = { source, ...range };
      linkedRange = next;
      followers.forEach((apply) => apply(next));
    } };
    if (frame === null) {
      frame = requestAnimationFrame(() => {
        const latest = pending;
        pending = null;
        frame = null;
        latest?.publish();
      });
    }
  });
  const offLoad = chart.on("load:start", cancelPending);
  const follow = (range: ViewportLink) => {
    if (range.source === source) return;
    const interval = parseInterval(chart.market.timeframe ?? "");
    const tolerance = interval && interval.unit !== "T" ? interval.ms / 2 : 1;
    if (sameRange(chart.getVisibleRange(), range, tolerance)) return;
    applying = true;
    try { chart.setVisibleRange(range); }
    finally { applying = false; }
  };
  followers.add(follow);
  const offWorkspace = useWorkspaceStore.subscribe((state, previous) => {
    if (previous.sync.timeRange && !state.sync.timeRange) {
      linkedRange = null;
      cancelPending();
    }
  });
  return () => {
    cancelPending(); offViewport(); offLoad(); offWorkspace(); followers.delete(follow);
    if (!followers.size) linkedRange = null;
  };
}
