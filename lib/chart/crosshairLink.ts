import type { Vela } from "@luxalgo/vela";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import type { CrosshairPoint } from "@/types/trading";
import { readLinkedCrosshair, setLinkedCrosshair, subscribeLinkedCrosshair } from "./crosshairBus";
export { subscribeLinkedCrosshair } from "./crosshairBus";

export function publishLinkedCrosshair(point: CrosshairPoint | null): void {
  if (!useWorkspaceStore.getState().sync.crosshair) return;
  setLinkedCrosshair(point, false);
}

export function receiveLinkedCrosshair(point: CrosshairPoint | null): void {
  setLinkedCrosshair(point, true);
}

export function bindLinkedCrosshair(chart: Pick<Vela, "market" | "on" | "renderer">, source: string): () => void {
  let displayedTime: number | null = null;
  let displayedPrice: number | null = null;
  let loading = false;

  const render = () => {
    const point = readLinkedCrosshair();
    const linked = !loading && useWorkspaceStore.getState().sync.crosshair && point?.source !== source ? point : null;
    const time = linked?.time ?? null;
    const price = linked && linked.symbol === chart.market.symbol ? linked.price : null;
    if (time === displayedTime && price === displayedPrice) return;
    displayedTime = time;
    displayedPrice = price;
    chart.renderer.setExternalCrosshair(time, price);
  };

  const off = [
    subscribeLinkedCrosshair(render),
    useWorkspaceStore.subscribe((state, previous) => {
      if (state.sync.crosshair !== previous.sync.crosshair) render();
    }),
    chart.on("load:start", () => { loading = true; render(); }),
    chart.on("load:end", () => { loading = false; render(); }),
  ];
  render();
  return () => off.forEach((unsubscribe) => unsubscribe());
}
