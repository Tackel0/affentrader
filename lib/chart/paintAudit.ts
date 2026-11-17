import type { RendererLayerArgs } from "@luxalgo/vela";
import { useChartStore } from "@/stores/useChartStore";
const frames = new Map<string, string>();
export function auditPaint(args: RendererLayerArgs, id: string, replay: boolean) {
  if (id !== "primary" || typeof window === "undefined" || !new URLSearchParams(window.location.search).has("chart-frame-audit")) return;
  const logical = args.coords.visibleLogicalRange(), from = Math.max(0, Math.floor(logical.from)), to = Math.min(args.bars.length - 1, Math.ceil(logical.to));
  const visible = args.bars.slice(from, to + 1), host = useChartStore.getState();
  const frame = { id, replay, style: args.priceStyle, native: args.bars.length, coordinates: args.coords.barCount, host: host.candles.length,
    from, to, nonflat: visible.filter(bar => bar.high > bar.low).length, valid: visible.filter(bar => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite)).length,
    head: args.bars[0]?.time, tail: args.bars.at(-1)?.time, hostHead: host.candles[0]?.time, hostTail: host.candles.at(-1)?.time,
    firstVisible: visible[0], scale: args.scale, bounds: args.bounds, width: args.coords.width };
  const key = JSON.stringify(frame);
  if (frames.get(id) === key) return; frames.set(id, key); console.debug("[chart-frame-audit]", key);
}
