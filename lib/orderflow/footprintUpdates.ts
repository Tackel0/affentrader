import type { Tick } from "@/types/trading";
/** Trades can arrive without a changed native candle. Batch only the owning live
 * footprint's canvas; a pending delivery cannot repaint a switched or destroyed cell. */
export function footprintUpdates(subscribe: (receive: (tick: Tick) => void) => () => void, invalidate: (cellId: string) => void) {
  let target: { id: string; symbol: string } | undefined, timer: ReturnType<typeof setTimeout> | undefined, dead = false;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const off = subscribe(tick => {
    if (!target || tick.symbol !== target.symbol || timer !== undefined || dead) return;
    const current = target;
    timer = setTimeout(() => { timer = undefined; if (!dead && target === current) invalidate(current.id); }, 50);
  });
  return {
    set(next: { id: string; symbol: string } | undefined) {
      if (next?.id === target?.id && next?.symbol === target?.symbol) return;
      clear(); target = next;
    },
    destroy() { dead = true; clear(); target = undefined; off(); },
  };
}
