import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { bindNativeChartType, chartTypeHost } from "@/lib/chart/nativeChartType";
import { bindNativeLayoutMode } from "@/lib/chart/nativeLayoutMode";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { createWorkspaceBackup } from "@/lib/workspaceBackup";
import { parseWorkspace } from "@/lib/workspace";
import type { ChartType } from "@/types/trading";
import type { Vela } from "@luxalgo/vela";
import { NativeRenderer } from "@luxalgo/vela";

const initialChart = useChartStore.getState(), initialWorkspace = useWorkspaceStore.getState();
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useChartStore.setState({ ...initialChart }, true);
  useWorkspaceStore.setState({ ...initialWorkspace, cells: structuredClone(initialWorkspace.cells), layouts: [] }, true);
});
afterEach(() => vi.restoreAllMocks());

function setup() {
  let native = "candles", stored: ChartType = "candles";
  let event: ((value: { from: string; to: string }) => void) | undefined, changed: (() => void) | undefined;
  const write = vi.fn((value: ChartType) => { stored = value; changed?.(); });
  const offChart = vi.fn(() => { event = undefined; }), offHost = vi.fn(() => { changed = undefined; });
  const chart = { renderer: { supports: () => true, get: () => native }, on: (_name: unknown, listener: typeof event) => { event = listener; return offChart; } } as unknown as Pick<Vela, "on" | "renderer">;
  const dispose = bindNativeChartType(chart, { read: () => stored, write, subscribe: listener => { changed = listener; return offHost; } });
  return { write, dispose, offChart, offHost, stored: () => stored,
    nativeChange: (to: string) => { event?.({ from: native, to }); native = to; },
    hostChange: (to: ChartType) => { stored = to; changed?.(); },
    setNative: (to: string) => { native = to; } };
}

describe("native settings chart-type bridge", () => {
  it("refreshes the actual native dialog snapshot before re-presenting it at a new breakpoint", () => {
    const latest = { series: { style: "line" }, grid: { vertLines: { visible: false } } };
    let cached: unknown = { series: { style: "candles" } };
    const presented: unknown[] = [];
    const target = { layoutMode: "desktop", getConfig: () => latest,
      settingsDialog: { refreshConfig: (config: unknown) => { cached = config; }, setLayoutMode: (mode: string) => { presented.push({ mode, cached }); } },
      updateScrollToRealtimeButton: vi.fn() };
    const method = NativeRenderer.prototype.setLayoutMode;
    method.call(target as unknown as NativeRenderer, "mobile");
    expect(presented).toEqual([{ mode: "mobile", cached: latest }]);
    method.call(target as unknown as NativeRenderer, "mobile");
    expect(presented).toHaveLength(1);
  });
  it("tracks viewport presentation changes once and detaches the live media query", () => {
    const query = Object.assign(new EventTarget(), { matches: false }), setLayoutMode = vi.fn();
    const dispose = bindNativeLayoutMode({ setLayoutMode } as unknown as Pick<Vela["renderer"], "setLayoutMode">, query);
    expect(setLayoutMode).toHaveBeenLastCalledWith("desktop");
    query.matches = true; query.dispatchEvent(new Event("change")); query.dispatchEvent(new Event("change"));
    expect(setLayoutMode.mock.calls).toEqual([["desktop"], ["mobile"]]);
    query.matches = false; query.dispatchEvent(new Event("change"));
    expect(setLayoutMode).toHaveBeenLastCalledWith("desktop");
    dispose(); query.matches = true; query.dispatchEvent(new Event("change"));
    expect(setLayoutMode).toHaveBeenCalledTimes(3);
  });
  it("waits for the pre-change event to settle and publishes only the latest selection", async () => {
    const s = setup(); s.nativeChange("line"); expect(s.write).not.toHaveBeenCalled();
    s.nativeChange("area"); await Promise.resolve(); expect(s.write).toHaveBeenCalledExactlyOnceWith("area"); s.dispose();
  });
  it("ignores already reflected, unknown and abandoned native selections", async () => {
    const s = setup(); s.nativeChange("candles"); await Promise.resolve();
    s.nativeChange("unsupported-style"); await Promise.resolve();
    s.nativeChange("line"); s.setNative("bars"); await Promise.resolve();
    expect(s.write).not.toHaveBeenCalled(); s.dispose();
  });
  it("does not overwrite a newer toolbar or restored host choice with a queued callback", async () => {
    const s = setup(); s.nativeChange("line"); s.hostChange("heikinashi"); await Promise.resolve();
    expect(s.stored()).toBe("heikinashi"); expect(s.write).not.toHaveBeenCalled(); s.dispose();
  });
  it("detaches both subscriptions and rejects callbacks already queued at unmount", async () => {
    const s = setup(); s.nativeChange("line"); s.dispose(); await Promise.resolve();
    expect(s.write).not.toHaveBeenCalled(); expect(s.offChart).toHaveBeenCalledOnce(); expect(s.offHost).toHaveBeenCalledOnce();
  });
  it("does not subscribe or read unsupported renderer features", () => {
    const on = vi.fn(), subscribe = vi.fn();
    bindNativeChartType({ renderer: { supports: () => false }, on } as unknown as Pick<Vela, "on" | "renderer">,
      { read: () => "candles", write: vi.fn(), subscribe })();
    expect(on).not.toHaveBeenCalled(); expect(subscribe).not.toHaveBeenCalled();
  });
  it("keeps dialog writes attached to their own cell across activation and rejects application/removal", () => {
    const id = useWorkspaceStore.getState().activeId, host = chartTypeHost(id);
    useWorkspaceStore.getState().activate("cell-2"); const second = useChartStore.getState().chartType;
    host.write("line"); expect(useChartStore.getState().chartType).toBe(second);
    useWorkspaceStore.getState().activate(id); expect(useChartStore.getState().chartType).toBe("line");
    useWorkspaceStore.setState({ applyingCell: true }); host.write("bars"); expect(useChartStore.getState().chartType).toBe("line");
    useWorkspaceStore.setState({ applyingCell: false, cells: [] }); host.write("area"); expect(host.read()).toBeUndefined();
    expect(useChartStore.getState().chartType).toBe("line");
  });
  it("carries a native-origin choice through actual layouts, cells and validated backups", async () => {
    const id = useWorkspaceStore.getState().activeId, host = chartTypeHost(id);
    let event: ((value: { from: string; to: string }) => void) | undefined, rendered = "candles";
    const chart = { renderer: { supports: () => true, get: () => rendered }, on: (_name: unknown, listener: typeof event) => { event = listener; return () => {}; } } as unknown as Pick<Vela, "on" | "renderer">;
    const dispose = bindNativeChartType(chart, host); event!({ from: "candles", to: "line" }); rendered = "line"; await Promise.resolve();
    useWorkspaceStore.getState().saveLayout("Native line"); const layout = useWorkspaceStore.getState().layouts[0];
    useWorkspaceStore.getState().activate("cell-2"); useWorkspaceStore.getState().activate(id);
    expect(useChartStore.getState().chartType).toBe("line");
    useChartStore.getState().set({ chartType: "bars" }); useWorkspaceStore.getState().loadLayout(layout.id);
    const backup = createWorkspaceBackup(); expect(parseWorkspace(JSON.stringify(backup)).chart.state.chartType).toBe("line");
    expect((backup.premium!.state.cells as Array<{ id: string; chartType: string }>).find(cell => cell.id === id)?.chartType).toBe("line"); dispose();
  });
});
