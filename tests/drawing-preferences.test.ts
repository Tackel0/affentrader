import { describe, expect, it, vi } from "vitest";
import type { Vela } from "@luxalgo/vela";
import type { DrawingPreferences } from "@/types/trading";
import { bindDrawingPreferences, DEFAULT_DRAWING_PREFERENCES, nativeDrawingTool, parseDrawingPreferences } from "@/lib/drawings/preferences";
import { parseWorkspace } from "@/lib/workspace";

const preferences = (): DrawingPreferences => ({ ...structuredClone(DEFAULT_DRAWING_PREFERENCES), snap: "weak", stay: true, favorites: ["trendline"],
  lastTools: { "lines-channels-pitchforks": "hray" }, toolDefaults: { trendline: { style: { color: "#ff0000", width: 3 } } }, toolTemplates: {} });
function nativeChart() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  const emit = (name: string, event: unknown) => listeners.get(name)?.forEach(fn => fn(event));
  const state = structuredClone(DEFAULT_DRAWING_PREFERENCES);
  const drawings = {
    setSnapMode: vi.fn((snap: DrawingPreferences["snap"]) => { state.snap = snap; emit("drawing:snap", { mode: snap }); }),
    setStayMode: vi.fn((stay: boolean) => { state.stay = stay; emit("drawing:stay", { on: stay }); }),
    setFavorites: vi.fn((favorites: DrawingPreferences["favorites"]) => { state.favorites = favorites; emit("drawing:favorites", { favorites }); }),
    setToolDefaults: vi.fn((toolDefaults: DrawingPreferences["toolDefaults"]) => { state.toolDefaults = toolDefaults; emit("drawing:defaults", { type: "trendline" }); }),
    setToolTemplates: vi.fn((toolTemplates: DrawingPreferences["toolTemplates"]) => { state.toolTemplates = toolTemplates; emit("drawing:templates", { type: "trendline" }); }),
    favorites: () => state.favorites, toolDefaults: () => state.toolDefaults, toolTemplates: () => state.toolTemplates,
  };
  const chart = { drawings, on(name: string, fn: (event: any) => void) {
    const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set);
    return () => set.delete(fn);
  } } as unknown as Vela;
  return { chart, drawings, listeners };
}
function preferenceHost(initial = preferences()) {
  let value = initial;
  const subscribers = new Set<(value: DrawingPreferences) => void>();
  const write = vi.fn((next: DrawingPreferences) => { value = next; subscribers.forEach(fn => fn(next)); });
  return { read: () => value, write, subscribe(fn: (value: DrawingPreferences) => void) { subscribers.add(fn); return () => { subscribers.delete(fn); }; }, subscribers };
}
describe("native drawing preference integration", () => {
  it("maps all legacy shortcuts to real native tools", () => {
    expect(nativeDrawingTool("cursor")).toBeNull();
    expect(nativeDrawingTool("horizontal-ray")).toBe("hray");
    expect(nativeDrawingTool("fib-retracement")).toBe("fibretracement");
    expect(nativeDrawingTool("long-position")).toBe("position");
    expect(nativeDrawingTool("anchored-vwap")).toBe("anchoredvwap");
    expect(nativeDrawingTool("fixed-profile")).toBe("fixedrangevp");
    expect(nativeDrawingTool("gartley")).toBe("gartley");
  });
  it("validates a complete backup and rejects malformed preference fields", () => {
    const valid = preferences();
    expect(parseDrawingPreferences(valid)).toEqual(valid);
    for (const patch of [{ snap: "always" }, { stay: "true" }, { favorites: ["<script>"] }, { favorites: ["hray", "hray"] }, { favorites: Array(101).fill("trendline") },
      { lastTools: { lines: 1 } }, { toolDefaults: [] }, { toolTemplates: { x: "x".repeat(250_000) } }, { constructor: "injected" }])
      expect(() => parseDrawingPreferences({ ...valid, ...patch })).toThrow("Invalid drawing preferences");
  });
  it("restores every public native preference without writing a feedback loop", () => {
    const { chart, drawings } = nativeChart(), host = preferenceHost();
    const dispose = bindDrawingPreferences(chart, host);
    expect(drawings.setSnapMode).toHaveBeenCalledExactlyOnceWith("weak");
    expect(drawings.setStayMode).toHaveBeenCalledExactlyOnceWith(true);
    expect(drawings.setFavorites).toHaveBeenCalledExactlyOnceWith(["trendline"]);
    expect(drawings.setToolDefaults).toHaveBeenCalledExactlyOnceWith(host.read().toolDefaults);
    expect(host.write).not.toHaveBeenCalled();
    dispose();
  });
  it("persists actual renderer changes, including remembered styles and templates", () => {
    const { chart, drawings } = nativeChart(), host = preferenceHost();
    const dispose = bindDrawingPreferences(chart, host);
    drawings.setSnapMode("strong"); drawings.setStayMode(false); drawings.setFavorites(["hray", "position"]);
    drawings.setToolDefaults({ hray: { style: { color: "#00ff00" } } });
    drawings.setToolTemplates({ hray: [{ name: "Support", style: { color: "#00ff00" } }] });
    expect(host.read()).toMatchObject({ snap: "strong", stay: false, favorites: ["hray", "position"], toolDefaults: { hray: { style: { color: "#00ff00" } } },
      toolTemplates: { hray: [{ name: "Support" }] } });
    expect(host.write).toHaveBeenCalledTimes(5);
    expect(drawings.setSnapMode).toHaveBeenCalledTimes(2);
    dispose();
  });
  it("pushes an external preference change once and preserves the last-used tools", () => {
    const { chart, drawings } = nativeChart(), host = preferenceHost();
    const dispose = bindDrawingPreferences(chart, host);
    host.write({ ...host.read(), snap: "strong", lastTools: { text: "note" } });
    expect(drawings.setSnapMode).toHaveBeenCalledTimes(2);
    expect(drawings.setStayMode).toHaveBeenCalledTimes(1);
    expect(host.write).toHaveBeenCalledTimes(1);
    expect(host.read().lastTools).toEqual({ text: "note" });
    dispose();
  });
  it("detaches the old owner before handing preferences to another chart", () => {
    const first = nativeChart(), second = nativeChart(), host = preferenceHost();
    const disposeFirst = bindDrawingPreferences(first.chart, host);
    first.drawings.setSnapMode("strong"); disposeFirst();
    expect([...first.listeners.values()].every(set => set.size === 0)).toBe(true);
    expect(host.subscribers.size).toBe(0);
    const disposeSecond = bindDrawingPreferences(second.chart, host);
    expect(second.drawings.setSnapMode).toHaveBeenCalledExactlyOnceWith("strong");
    first.drawings.setSnapMode("off");
    expect(host.read().snap).toBe("strong");
    disposeSecond();
  });
  it("round-trips preferences through the real workspace parser", () => {
    const data = { version: 1, chart: { state: { symbol: "BTCUSDT", timeframe: "1h", chartType: "candles", feedMode: "auto", indicators: [], drawings: {},
      pineLibraries: {}, drawingPreferences: preferences() } }, watchlists: { state: { lists: [{ id: "a", name: "Crypto", symbols: ["BTCUSDT"] }], activeId: "a" } },
      alerts: { state: { alerts: [], logs: [] } } };
    expect(parseWorkspace(JSON.stringify(data))).toEqual(data);
    data.chart.state.drawingPreferences.snap = "invalid" as "weak";
    expect(() => parseWorkspace(JSON.stringify(data))).toThrow("Invalid drawing preferences");
  });
});
