import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RendererLayerArgs, Vela } from "@luxalgo/vela";
import type { MenuOptions } from "@luxalgo/vela/ui";
const menus = vi.hoisted(() => [] as Array<{ options: MenuOptions; destroy: ReturnType<typeof vi.fn>; openAt: ReturnType<typeof vi.fn> }>);
vi.mock("@luxalgo/vela/ui", () => ({ ensureUIHost: vi.fn(), Menu: class { destroy = vi.fn(); openAt = vi.fn(); constructor(readonly options: MenuOptions) { menus.push(this); } } }));
import { bindFootprintMenu, changeFootprintMenu, clearFootprintMenuFrame, footprintMenuCurrent, footprintMenuItems, publishFootprintMenuFrame, type FootprintMenuFrame, type FootprintMenuScope } from "@/lib/orderflow/footprintMenu";
import { defaultFootprint, resolveFootprintInstances, resolveVisibleFootprint } from "@/lib/orderflow/footprint";
const scope: FootprintMenuScope = { symbol: "BTCUSDT", timeframe: "1m", epoch: 1, sourceStamp: "archive-a", replay: false };
const settings = () => ({ ...defaultFootprint(), fp2Enabled: true, fp2AverageTradeSize: false, fp5Enabled: false, fp5RowSize: 25, vrEnabled: true, vrAverageTradeSize: false, vrWidthPercent: 38 });
function frame(values = settings()): FootprintMenuFrame {
  const bar = { time: 0, volume: 10, delta: 6, poc: 101, levels: [{ price: 101, upperPrice: 102, sellVolume: 2, buyVolume: 8, imbalance: null }] };
  const args = { priceStyle: "footprint", bars: [{ time: 0 }], coords: { width: 500, timeToX: () => 100, pxPerBar: () => 100, priceToY: (p: number) => (110 - p) * 20 }, bounds: { top: 0, height: 300 }, scale: {}, theme: {} } as unknown as RendererLayerArgs;
  return { args, views: [{ id: "fp2", label: "Footprint 2", bars: [bar], style: resolveFootprintInstances(values)[1].style, step: 1, placement: { width: 80, offset: 0, within: false } }], scope: { ...scope }, visibleEnabled: true };
}
function nativeConfig() {
  return { candles: { upColor: "#089981", downColor: "#f23645", bodyVisible: true, borderVisible: false, borderUpColor: "#089981", borderDownColor: "#f23645", wickVisible: true, wickUpColor: "#089981", wickDownColor: "#f23645" },
    bars: { upColor: "#089981", downColor: "#f23645" }, line: { color: "#2962ff", width: 2 }, area: { lineColor: "#2962ff", width: 2, topColor: "#2962ff44", bottomColor: "#2962ff00" },
    baseline: { topLineColor: "#089981", bottomLineColor: "#f23645", topFillColor: "#08998144", topFillColor2: "#08998100", bottomFillColor: "#f2364544", bottomFillColor2: "#f2364500", width: 2, baselineLevel: 50 }, animations: { zoom: true, pan: true, autoscale: true, intro: false }, series: { style: "footprint", spacing: 1 }, priceScale: { animateLastPrice: false }, chartTypes: { footprint: settings(), tpo: {} } };
}
class ElementStub extends EventTarget { closest() { return null; } }
beforeEach(() => { menus.length = 0; vi.stubGlobal("Element", ElementStub); });
afterEach(() => vi.unstubAllGlobals());
it("offers the four official quick actions with actual-instance checked states", () => {
  const f = frame();
  expect(footprintMenuItems(f.views[0], true)).toMatchObject([{ id: "statistics", label: "Stat table", checked: false, hint: "Footprint 2" }, { id: "average", label: "Average trade size", checked: false }, { id: "visible", label: "Visible range profile", checked: true }, { id: "settings", label: "Footprint Settings" }]);
});
it("toggles root, secondary and range controls independently while preserving disabled settings", () => {
  const value = settings(), before = JSON.stringify(value);
  expect(changeFootprintMenu(value, "fp1", "statistics")).toMatchObject({ statisticsVisible: true, fp2AverageTradeSize: false, fp5RowSize: 25 });
  expect(changeFootprintMenu(value, "fp2", "average")).toMatchObject({ averageTradeSize: false, fp2AverageTradeSize: true, vrAverageTradeSize: false });
  expect(changeFootprintMenu(value, "vr", "statistics")).toMatchObject({ statisticsVisible: false, vrStatisticsVisible: true });
  expect(changeFootprintMenu(value, "vr", "average")).toMatchObject({ averageTradeSize: false, vrAverageTradeSize: true });
  expect(changeFootprintMenu(value, "fp2", "visible")?.vrEnabled).toBe(false);
  expect(changeFootprintMenu(value, "fp5", "average")).toBeNull(); expect(changeFootprintMenu(value, "fp6", "average")).toBeNull();
  expect(changeFootprintMenu(value, "fp2", "unknown")).toBeNull();
  expect(changeFootprintMenu({ ...value, vrEnabled: false }, "vr", "average")).toBeNull();
  expect(JSON.stringify(value)).toBe(before);
});
it("rejects changed source/market/epoch/Replay/settings while allowing ordinary live quantities", () => {
  const f = frame(), value = settings(); expect(footprintMenuCurrent(f, f, scope, value, "fp2")).toBe(true);
  for (const change of [{ symbol: "OTHER" }, { timeframe: "5m" }, { epoch: 2 }, { sourceStamp: "archive-b" }, { replay: true, through: 60000 }]) expect(footprintMenuCurrent(f, f, { ...scope, ...change }, value, "fp2")).toBe(false);
  expect(footprintMenuCurrent(f, f, scope, { ...value, fp2AverageTradeSize: true }, "fp2")).toBe(false);
  expect(footprintMenuCurrent(f, f, scope, { ...value, fp2Enabled: false }, "fp2")).toBe(false);
  expect(footprintMenuCurrent(f, f, scope, { ...value, vrEnabled: false }, "fp2")).toBe(false);
  expect(footprintMenuCurrent(f, { ...f, views: [{ ...f.views[0], bars: [{ ...f.views[0].bars[0], volume: 999 }] }] }, scope, { ...value, fp5RowSize: 50 }, "fp2")).toBe(true);
  const replay = { ...f, scope: { ...scope, replay: true, through: 60000 } };
  expect(footprintMenuCurrent(replay, replay, { ...replay.scope, through: 120000 }, value, "fp2")).toBe(false);
});
function binding() {
  const host = new ElementStub(), canvas = { getBoundingClientRect: () => ({ left: 10, top: 20 }) };
  Object.assign(host, { querySelector: () => canvas });
  const config = nativeConfig(), applyConfig = vi.fn(), openSettings = vi.fn(), renderer = { getConfig: () => config, applyConfig, openSettings } as unknown as Vela["renderer"];
  const token = Symbol(), cell = "menu-test", f = frame(); let currentScope: FootprintMenuScope = { ...scope };
  publishFootprintMenuFrame(cell, token, f);
  const off = bindFootprintMenu(host as unknown as HTMLElement, renderer, cell, () => currentScope);
  return { host, config, renderer, applyConfig, openSettings, f, token, cell, changeScope(value: FootprintMenuScope) { currentScope = value; },
    open(x = 110, y = 190) { const event = Object.assign(new Event("contextmenu", { cancelable: true }), { clientX: x, clientY: y }); host.dispatchEvent(event); return event; },
    dispose() { off(); clearFootprintMenuFrame(cell, token); } };
}
it("captures the clicked instance, applies through native config and cleans the listener/menu", () => {
  const b = binding(); expect(b.open().defaultPrevented).toBe(true); expect(menus).toHaveLength(1);
  menus[0].options.onSelect!("average");
  expect(b.applyConfig).toHaveBeenCalledWith(expect.objectContaining({ chartTypes: expect.objectContaining({ footprint: expect.objectContaining({ fp2AverageTradeSize: true, averageTradeSize: false, fp5RowSize: 25 }) }) }));
  b.dispose(); expect(menus[0].destroy).toHaveBeenCalled(); b.open(); expect(menus).toHaveLength(1);
});
it("keeps the normal chart menu available off rows and rejects already-stale targets", () => {
  const b = binding(); expect(b.open(400, 190).defaultPrevented).toBe(false); expect(menus).toHaveLength(0);
  b.changeScope({ ...scope, sourceStamp: "new" }); expect(b.open().defaultPrevented).toBe(false); expect(menus).toHaveLength(0); b.dispose();
});
it("does not commit a captured command after a scope, producer or settings replacement", () => {
  for (const kind of ["scope", "producer", "settings", "style"]) {
    const b = binding(); b.open(); const menu = menus.at(-1)!;
    if (kind === "scope") b.changeScope({ ...scope, epoch: 2 });
    if (kind === "producer") { const replacement = Symbol(); publishFootprintMenuFrame(b.cell, replacement, b.f); clearFootprintMenuFrame(b.cell, replacement); }
    if (kind === "settings") b.config.chartTypes.footprint.fp2AverageTradeSize = true;
    if (kind === "style") b.config.series.style = "candles";
    menu.options.onSelect!("statistics"); expect(b.applyConfig).not.toHaveBeenCalled(); b.dispose();
  }
});
it("opens settings for the targeted family and respects token-owned clear operations", () => {
  const b = binding(); clearFootprintMenuFrame(b.cell, Symbol()); b.open(); menus.at(-1)!.options.onSelect!("settings"); expect(b.openSettings).toHaveBeenCalledWith("Footprint"); b.dispose();
  const c = binding(), visible = resolveVisibleFootprint(c.config.chartTypes.footprint);
  publishFootprintMenuFrame(c.cell, c.token, { ...c.f, views: [{ ...c.f.views[0], id: "vr", label: "Visible range", style: visible.style }] });
  c.open(); menus.at(-1)!.options.onSelect!("settings"); expect(c.openSettings).toHaveBeenCalledWith("Visible range"); c.dispose();
});
