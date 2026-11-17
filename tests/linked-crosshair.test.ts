import type { Vela } from "@luxalgo/vela";
import { afterEach, expect, it, vi } from "vitest";
import { bindLinkedCrosshair, publishLinkedCrosshair, receiveLinkedCrosshair, subscribeLinkedCrosshair } from "@/lib/chart/crosshairLink";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

const initialChart = useChartStore.getState();
const initialSync = useWorkspaceStore.getState().sync;
const setSync = (crosshair: boolean) => useWorkspaceStore.setState({ sync: { ...initialSync, crosshair } });

afterEach(() => {
  receiveLinkedCrosshair(null);
  useChartStore.setState(initialChart);
  setSync(initialSync.crosshair);
});

it("updates linked coordinates only when they change and clears them while loading or unlinked", () => {
  const events = new Map<string, () => void>();
  const market = { symbol: "BTCUSDT" };
  const setExternalCrosshair = vi.fn();
  const chart = {
    market,
    renderer: { setExternalCrosshair },
    on(type: string, listener: () => void) {
      events.set(type, listener);
      return () => events.delete(type);
    },
  } as unknown as Pick<Vela, "market" | "on" | "renderer">;
  const point = { time: 60000, price: 125, source: "remote", symbol: "BTCUSDT" };
  setSync(true);
  const eventsSeen = vi.fn(), offEvents = subscribeLinkedCrosshair(eventsSeen);
  const chartStoreChanged = vi.fn(), offChartStore = useChartStore.subscribe(chartStoreChanged);
  const dispose = bindLinkedCrosshair(chart, "local");
  try {
    publishLinkedCrosshair(point);
    expect(setExternalCrosshair).toHaveBeenLastCalledWith(60000, 125);
    publishLinkedCrosshair({ ...point });
    expect(eventsSeen).toHaveBeenCalledExactlyOnceWith(point, false);
    expect(chartStoreChanged).not.toHaveBeenCalled();
    useChartStore.setState({ candles: [] });
    receiveLinkedCrosshair({ ...point, source: "another" });
    expect(setExternalCrosshair).toHaveBeenCalledTimes(1);

    setSync(false);
    expect(setExternalCrosshair).toHaveBeenLastCalledWith(null, null);
    setSync(true);
    expect(setExternalCrosshair).toHaveBeenLastCalledWith(60000, 125);
    events.get("load:start")?.();
    expect(setExternalCrosshair).toHaveBeenLastCalledWith(null, null);
    market.symbol = "ETHUSDT";
    events.get("load:end")?.();
    expect(setExternalCrosshair).toHaveBeenLastCalledWith(60000, null);
    publishLinkedCrosshair({ ...point, source: "local" });
    expect(setExternalCrosshair).toHaveBeenLastCalledWith(null, null);
    receiveLinkedCrosshair(null);
    expect(eventsSeen).toHaveBeenLastCalledWith(null, true);
  } finally {
    dispose();
    offEvents();
    offChartStore();
  }
  expect(events.size).toBe(0);
  setExternalCrosshair.mockClear();
  publishLinkedCrosshair(point);
  expect(setExternalCrosshair).not.toHaveBeenCalled();
});
