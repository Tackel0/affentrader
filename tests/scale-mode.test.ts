import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { nativePriceScale, priceScalePatch, priceScaleSelection, samePriceScale, validScaleMode, type PriceScaleSelection } from "@/lib/chart/scaleMode";
import { bindPriceScale, priceScaleHost } from "@/lib/chart/priceScale";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { createWorkspaceBackup } from "@/lib/workspaceBackup";
import { parseWorkspace } from "@/lib/workspace";
import type { Vela } from "@luxalgo/vela";

const initialChart = useChartStore.getState(), initialWorkspace = useWorkspaceStore.getState();
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useChartStore.setState({ ...initialChart, scaleMode: "price", logarithmic: false }, true);
  useWorkspaceStore.setState({ ...initialWorkspace, cells: structuredClone(initialWorkspace.cells), layouts: [] }, true);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("price, percentage and indexed scales", () => {
  it("converges a legacy native Log-only toggle to absolute log units without feedback", () => {
    vi.useFakeTimers(); let config = { priceScale: { mode: "percent", log: false } }, listener: (() => void) | undefined;
    const write = vi.fn(), renderer = { getConfig: () => config,
      applyConfig: (patch: typeof config) => { config = patch; listener?.(); return renderer; },
      onConfigChanged: (callback: () => void) => { listener = callback; return () => { listener = undefined; }; } };
    const dispose = bindPriceScale({ renderer } as unknown as Pick<Vela, "renderer">, new EventTarget(), {
      read: () => ({ mode: "percent", logarithmic: false }), write, subscribe: () => () => {} });
    config.priceScale.log = true; listener?.();
    expect(config.priceScale).toEqual({ mode: "price", log: true });
    expect(write).toHaveBeenCalledExactlyOnceWith({ mode: "price", logarithmic: true }); dispose();
  });
  it("normalizes legacy and log choices and rejects unknown imported modes", () => {
    expect(priceScaleSelection(undefined, true)).toEqual({ mode: "price", logarithmic: true });
    expect(priceScaleSelection("percent", false)).toEqual({ mode: "percent", logarithmic: false });
    expect(priceScaleSelection("indexed", true)).toEqual({ mode: "price", logarithmic: true });
    expect(validScaleMode("log")).toBe(false); expect(validScaleMode("indexed")).toBe(true);
    expect(nativePriceScale({ priceScale: { mode: "percent", log: false } })).toEqual({ mode: "percent", logarithmic: false });
    expect(nativePriceScale({ priceScale: { mode: "regular", log: false } })).toBeNull();
  });

  it("keeps store patches coherent while preserving candles and unrelated preferences", () => {
    const candles = useChartStore.getState().candles;
    useChartStore.getState().set({ logarithmic: true });
    useChartStore.getState().set({ scaleMode: "percent" });
    expect(useChartStore.getState()).toMatchObject({ scaleMode: "percent", logarithmic: false });
    expect(useChartStore.getState().candles).toBe(candles);
    useChartStore.getState().set({ logarithmic: true });
    expect(useChartStore.getState()).toMatchObject({ scaleMode: "price", logarithmic: true });
    expect(priceScalePatch({}, { scaleMode: "indexed", logarithmic: false })).toEqual({});
  });

  it("reads and applies the native mode/log pair atomically without feedback", () => {
    vi.useFakeTimers(); let config = { priceScale: { mode: "price", log: true }, series: { style: "candles" } };
    let nativeListener: (() => void) | undefined, hostListener: ((value: PriceScaleSelection) => void) | undefined;
    let stored: PriceScaleSelection = { mode: "percent", logarithmic: false };
    const write = vi.fn((value: PriceScaleSelection) => { stored = value; hostListener?.(value); });
    const applyConfig = vi.fn((patch: { priceScale: { mode: string; log: boolean } }) => { config = { ...config, priceScale: { ...patch.priceScale } }; nativeListener?.(); return renderer; });
    const renderer = { getConfig: () => config, applyConfig, onConfigChanged: (listener: () => void) => { nativeListener = listener; return () => { nativeListener = undefined; }; } };
    const dispose = bindPriceScale({ renderer } as unknown as Pick<Vela, "renderer">, new EventTarget(), {
      read: () => stored, write, subscribe: listener => { hostListener = listener; return () => { hostListener = undefined; }; } });
    expect(config.priceScale).toEqual({ mode: "percent", log: false }); expect(config.series.style).toBe("candles"); expect(write).not.toHaveBeenCalled();
    config.priceScale = { mode: "price", log: true }; nativeListener?.();
    expect(write).toHaveBeenCalledExactlyOnceWith({ mode: "price", logarithmic: true }); expect(applyConfig).toHaveBeenCalledOnce();
    stored = { mode: "indexed", logarithmic: false }; hostListener?.(stored);
    expect(config.priceScale).toEqual({ mode: "indexed", log: false }); expect(write).toHaveBeenCalledOnce();
    dispose(); expect(nativeListener).toBeUndefined(); expect(hostListener).toBeUndefined();
  });

  it("preserves relative scales and log isolation across cells, named layouts and validated backups", () => {
    const id = useWorkspaceStore.getState().activeId, first = priceScaleHost(id);
    first.write({ mode: "percent", logarithmic: false }); useWorkspaceStore.getState().saveLayout("Percent");
    const layout = useWorkspaceStore.getState().layouts[0];
    useWorkspaceStore.getState().activate("cell-2");
    priceScaleHost("cell-2").write({ mode: "indexed", logarithmic: false });
    expect(first.read()).toEqual({ mode: "percent", logarithmic: false });
    useWorkspaceStore.getState().activate(id); expect(useChartStore.getState().scaleMode).toBe("percent");
    useChartStore.getState().set({ logarithmic: true }); useWorkspaceStore.getState().loadLayout(layout.id);
    expect(first.read()).toEqual({ mode: "percent", logarithmic: false });
    const backup = createWorkspaceBackup(); expect(parseWorkspace(JSON.stringify(backup)).chart.state).toMatchObject({ scaleMode: "percent", logarithmic: false });
    expect(samePriceScale(first.read(), { mode: "percent", logarithmic: false })).toBe(true);
  });

  it("rejects incompatible and malformed chart/cell imports but accepts old logarithmic backups", () => {
    for (const mode of ["log", "percent", "indexed"]) {
      const backup = createWorkspaceBackup(); backup.chart.state.scaleMode = mode; backup.chart.state.logarithmic = true;
      expect(() => parseWorkspace(JSON.stringify(backup))).toThrow(/price scale mode/);
    }
    const backup = createWorkspaceBackup();
    (backup.premium!.state.cells as Array<Record<string, unknown>>)[0].scaleMode = "unknown";
    expect(() => parseWorkspace(JSON.stringify(backup))).toThrow(/price scale mode/);
    delete backup.chart.state.scaleMode; backup.chart.state.logarithmic = true;
    for (const cell of backup.premium!.state.cells as Array<Record<string, unknown>>) delete cell.scaleMode;
    expect(() => parseWorkspace(JSON.stringify(backup))).not.toThrow();
  });

  it("does not persist intermediate or missing cell owners and detaches subscriptions", () => {
    const host = priceScaleHost(useWorkspaceStore.getState().activeId), listener = vi.fn(), dispose = host.subscribe(listener);
    useWorkspaceStore.setState({ applyingCell: true }); useChartStore.getState().set({ scaleMode: "percent" });
    expect(listener).not.toHaveBeenCalled(); host.write({ mode: "indexed", logarithmic: false });
    expect(useChartStore.getState().scaleMode).toBe("percent"); useWorkspaceStore.setState({ applyingCell: false });
    expect(listener).toHaveBeenCalledExactlyOnceWith({ mode: "percent", logarithmic: false }); dispose();
    useWorkspaceStore.setState({ cells: [] }); host.write({ mode: "price", logarithmic: true });
    expect(useChartStore.getState().logarithmic).toBe(false);
  });
});
