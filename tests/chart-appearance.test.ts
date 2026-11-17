import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appearanceDefaults, nativeChartAppearance, readChartAppearance, validAppearancePreferences, validChartAppearance, type ChartAppearancePreferences } from "@/lib/chart/appearance";
import { bindChartAppearance, chartAppearanceHost } from "@/lib/chart/appearanceBinding";
import { chartTheme } from "@/lib/chart/theme";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { createWorkspaceBackup } from "@/lib/workspaceBackup";
import { parseWorkspace } from "@/lib/workspace";
import type { WorkspaceTheme } from "@/types/workspace";
import { NativeRenderer, resolveTheme } from "@luxalgo/vela";

const config = () => ({ layout: { background: "#000000", textColor: "#b8b8b8", fontFamily: "sans-serif", fontSize: 12 },
  grid: { vertLines: { color: "#1a1a1a", visible: false }, horzLines: { color: "#1a1a1a", visible: true } },
  crosshair: { color: "#b8b8b8", labelBackground: "#b8b8b8", style: "dashed" },
  priceScale: { mode: "percent", log: false, borderColor: "#282828" }, panes: { separatorColor: "#282828" },
  margins: { top: 10, bottom: 10, right: 10 }, series: { style: "candles" }, timeScale: { timezone: "UTC" } });
const defaults = () => readChartAppearance(config())!;
const initialChart = useChartStore.getState(), initialWorkspace = useWorkspaceStore.getState();
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useChartStore.setState({ ...initialChart, chartAppearance: null }, true);
  useWorkspaceStore.setState({ ...initialWorkspace, theme: "dark", cells: structuredClone(initialWorkspace.cells), layouts: [] }, true);
});
afterEach(() => vi.restoreAllMocks());

function setup(preferences: ChartAppearancePreferences | null = null) {
  let rendered = config(), theme: WorkspaceTheme = "dark", stored = preferences;
  let native: (() => void) | undefined, external: (() => void) | undefined, themeSelect: ((value: ReturnType<typeof resolveTheme>) => void) | undefined;
  const merge = (patch: Record<string, unknown>, target: Record<string, unknown> = rendered) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === "object" && !Array.isArray(value)) merge(value as Record<string, unknown>, target[key] as Record<string, unknown>);
      else target[key] = value;
    }
  };
  const applyConfig = vi.fn((patch: ReturnType<typeof nativeChartAppearance>) => { merge(patch); native?.(); });
  const setTheme = vi.fn((palette: ReturnType<typeof chartTheme>) => {
    rendered.layout.background = palette.background!; rendered.layout.textColor = palette.textColor!; native?.();
  });
  const write = vi.fn((key: WorkspaceTheme, value: ReturnType<typeof defaults>) => { stored = { ...stored, [key]: structuredClone(value) }; external?.(); });
  const dispose = bindChartAppearance({ setTheme,
    on: (_event: string, listener: (value: ReturnType<typeof resolveTheme>) => void) => { themeSelect = listener; return () => { themeSelect = undefined; }; },
    renderer: { getConfig: () => rendered, applyConfig,
    onConfigChanged: (listener: () => void) => { native = listener; return () => { native = undefined; }; },
  } } as unknown as Parameters<typeof bindChartAppearance>[0], {
    read: () => ({ theme, preferences: stored }), write,
    selectTheme: value => { theme = value; external?.(); },
    subscribe: listener => { external = listener; return () => { external = undefined; }; },
  });
  return { rendered: () => rendered, stored: () => stored, applyConfig, setTheme, write, dispose,
    edit: (patch: Record<string, unknown>) => { merge(patch); native?.(); },
    restore: (value: ChartAppearancePreferences | null) => { stored = value; external?.(); },
    switch: (value: WorkspaceTheme) => { theme = value; external?.(); },
    nativeTheme: (value: WorkspaceTheme) => { themeSelect?.(resolveTheme(value)); } };
}

describe("persistent native canvas appearance", () => {
  it("presents the actual native theme dialog after synchronous host canvas restores settle", async () => {
    let current = { layout: { fontSize: 16 }, margins: { top: 25 } }, cached: unknown;
    const presented: unknown[] = [], target = {
      deriveTheme: (value: unknown) => value, getConfig: () => current,
      applyBackground: vi.fn(), inputsUI: { setTheme: vi.fn() }, syncThemeControl: vi.fn(),
      settingsDialog: { refreshConfig: (value: unknown) => { cached = value; }, setTheme: () => { presented.push(cached); } },
      refreshScrollButtonTheme: vi.fn(), refreshAttributionColor: vi.fn(), scheduler: { invalidate: vi.fn() },
    };
    NativeRenderer.prototype.setTheme.call(target as unknown as NativeRenderer, chartTheme("light"));
    expect(presented).toHaveLength(0);
    current = { layout: { fontSize: 12 }, margins: { top: 10 } };
    await Promise.resolve(); expect(presented).toEqual([current]);
  });
  it("validates bounded canvas fields and strict theme buckets, including unsafe or malformed imports", () => {
    const value = defaults(); expect(validChartAppearance(value)).toBe(true);
    expect(validAppearancePreferences({ dark: value })).toBe(true); expect(validAppearancePreferences({})).toBe(true);
    for (const invalid of [null, [], { other: value }, { dark: { ...value, extra: true } },
      { dark: { ...value, layout: { ...value.layout, fontSize: 33 } } },
      { dark: { ...value, layout: { ...value.layout, fontFamily: "url(https://example.com/font)" } } },
      { dark: { ...value, layout: { ...value.layout, background: "url(x)" } } },
      { dark: { ...value, margins: { ...value.margins, top: 41 } } },
      { dark: { ...value, margins: { ...value.margins, right: 1.5 } } },
      { dark: { ...value, margins: { ...value.margins, bottom: NaN } } }]) expect(validAppearancePreferences(invalid)).toBe(false);
  });
  it("copies colors and geometry without claiming visibility, scale, style or zone fields", () => {
    const original = config(), value = readChartAppearance(original)!;
    value.layout.fontSize = 16; value.margins.top = 20;
    expect(original.layout.fontSize).toBe(12); expect(original.margins.top).toBe(10);
    const patch = nativeChartAppearance(value);
    expect(patch.grid.vertLines).not.toHaveProperty("visible"); expect(patch.priceScale).not.toHaveProperty("mode");
    expect(patch).not.toHaveProperty("series"); expect(patch).not.toHaveProperty("timeScale");
    expect(readChartAppearance({})).toBeNull();
  });
  it("restores startup preferences without feedback and captures only relevant native edits", () => {
    const value = defaults(); value.layout.fontSize = 16;
    const s = setup({ dark: value }); expect(s.rendered().layout.fontSize).toBe(16); expect(s.write).not.toHaveBeenCalled();
    s.edit({ grid: { vertLines: { visible: true } }, priceScale: { log: true }, series: { style: "line" } });
    expect(s.write).not.toHaveBeenCalled();
    s.edit({ margins: { top: 22 } }); expect(s.write).toHaveBeenCalledOnce(); expect(s.stored()!.dark!.margins.top).toBe(22);
    expect(s.rendered().priceScale.log).toBe(true); expect(s.rendered().series.style).toBe("line"); s.dispose();
  });
  it("isolates dark/light preferences and factory geometry across repeated native and workspace theme changes", () => {
    const value = defaults(); value.layout.background = "#112233"; value.layout.fontSize = 16; value.margins.top = 25;
    const s = setup({ dark: value }); s.switch("light");
    expect(s.rendered().layout.background).toBe("#ffffff"); expect(s.rendered().layout.fontSize).toBe(12); expect(s.rendered().margins.top).toBe(10);
    expect(s.write).not.toHaveBeenCalled();
    s.edit({ layout: { background: "#f0f1f2", fontSize: 14 } });
    s.nativeTheme("dark"); expect(s.rendered().layout.background).toBe("#112233"); expect(s.rendered().layout.fontSize).toBe(16);
    s.nativeTheme("light"); expect(s.rendered().layout.background).toBe("#f0f1f2"); expect(s.rendered().layout.fontSize).toBe(14);
    const writes = s.write.mock.calls.length; s.nativeTheme("light"); expect(s.rendered().layout.background).toBe("#f0f1f2");
    expect(s.write).toHaveBeenCalledTimes(writes); s.dispose();
  });
  it("returns to factory defaults on legacy restore and detaches all three event paths", () => {
    const s = setup(), value = defaults(); value.margins.right = 30;
    s.restore({ dark: value }); expect(s.rendered().margins.right).toBe(30);
    s.restore(null); expect(s.rendered().margins.right).toBe(10);
    const calls = s.applyConfig.mock.calls.length; s.dispose(); s.restore({ dark: value }); s.nativeTheme("light"); s.edit({ margins: { top: 30 } });
    expect(s.applyConfig).toHaveBeenCalledTimes(calls); expect(s.write).not.toHaveBeenCalled();
  });
  it("persists independent cells and themes through layouts and validated backups", () => {
    const workspace = useWorkspaceStore.getState(), id = workspace.activeId, host = chartAppearanceHost(id), value = defaults();
    value.layout.fontSize = 16; host.write("dark", value); value.layout.fontSize = 20;
    expect(host.read()!.preferences!.dark!.layout.fontSize).toBe(16);
    useWorkspaceStore.getState().saveLayout("Canvas"); const layout = useWorkspaceStore.getState().layouts[0];
    useWorkspaceStore.getState().activate("cell-2"); expect(useChartStore.getState().chartAppearance).toBeNull();
    const other = defaults(); other.margins.top = 30; host.write("dark", other);
    expect(useChartStore.getState().chartAppearance).toBeNull(); useWorkspaceStore.getState().activate(id);
    expect(useChartStore.getState().chartAppearance!.dark!.margins.top).toBe(30);
    useWorkspaceStore.getState().loadLayout(layout.id); expect(useChartStore.getState().chartAppearance!.dark!.layout.fontSize).toBe(16);
    const backup = createWorkspaceBackup(); expect(parseWorkspace(JSON.stringify(backup)).chart.state.chartAppearance).toEqual(host.read()!.preferences);
    delete backup.chart.state.chartAppearance; for (const cell of backup.premium!.state.cells as Array<Record<string, unknown>>) delete cell.chartAppearance;
    expect(() => parseWorkspace(JSON.stringify(backup))).not.toThrow();
  });
  it("rejects malformed chart and cell imports and fences wrong themes, missing and applying owners", () => {
    for (const target of ["chart", "cell"]) {
      const backup = createWorkspaceBackup(), invalid = { dark: { ...defaults(), borderColor: "javascript:x" } };
      if (target === "chart") backup.chart.state.chartAppearance = invalid;
      else (backup.premium!.state.cells as Array<Record<string, unknown>>)[0].chartAppearance = invalid;
      expect(() => parseWorkspace(JSON.stringify(backup))).toThrow(/appearance preferences/);
    }
    const host = chartAppearanceHost(useWorkspaceStore.getState().activeId);
    host.write("light", defaults()); expect(useChartStore.getState().chartAppearance).toBeNull();
    useWorkspaceStore.setState({ applyingCell: true }); host.write("dark", defaults()); expect(host.read()).toBeUndefined();
    useWorkspaceStore.setState({ applyingCell: false, cells: [] }); host.write("dark", defaults()); expect(host.read()).toBeUndefined();
    expect(useChartStore.getState().chartAppearance).toBeNull();
  });
  it("rebases inherited crosshair inks without mutating factory values", () => {
    const initial = defaults(), light = appearanceDefaults(initial, "dark", "light");
    expect(light.crosshair.color).toBe(chartTheme("light").textColor); expect(initial.crosshair.color).toBe("#b8b8b8");
    initial.crosshair.color = "#ff00ff"; expect(appearanceDefaults(initial, "dark", "light").crosshair.color).toBe("#ff00ff");
  });
});
