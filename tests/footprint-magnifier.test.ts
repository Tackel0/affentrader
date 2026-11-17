import { expect, it, vi } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { defaultFootprint, paintFootprintBar } from "@/lib/orderflow/footprint";
import { footprintMagnifierPosition, footprintMagnifierWindow, paintFootprintMagnifier } from "@/lib/orderflow/footprintMagnifier";
import { createFootprintMagnifierSurface } from "@/lib/orderflow/footprintMagnifierSurface";
import type { FootprintRowHit } from "@/lib/orderflow/footprintHover";
const bars = [0, 60000, 120000, 180000].map(time => ({ time, volume: 10, delta: 6, poc: 100, levels: [{ price: 100, upperPrice: 101, buyVolume: 8, sellVolume: 2, buyCount: 4, sellCount: 1, imbalance: null }] }));
const view = { id: "fp1", label: "Footprint 1", bars, style: { ...defaultFootprint(), candleVisible: false, valueAreaVisible: false }, step: 1, placement: { width: 40, offset: 0, within: true } };
const args = (width = 1200) => ({ coords: { width, dpr: 1, pxPerBar: () => 100, timeToX: (time: number) => width / 2 + (time / 60000 - 1) * 100, priceToY: (price: number) => (110 - price) * 20 }, scale: {}, bounds: { top: 0, height: 400 }, bars: bars.map(b => ({ time: b.time })), theme: { background: "#ffffff", textColor: "#131722", fontFamily: "Arial" } }) as unknown as RendererLayerArgs;
const hit = (width = 1200): FootprintRowHit => ({ view, bar: bars[1], row: 0, lower: 100, upper: 101, rect: { x: width / 2 - 20, y: 180, width: 40, height: 20 } });
function canvas() { const text: string[] = [], ctx = { font: "", save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, strokeRect() {}, fillRect() {}, rect() {}, clip() {}, measureText(value: string) { return { width: value.length * parseFloat(this.font.replace(/^600 /, "")) * .6 }; }, fillText(value: string) { text.push(value); } }; return { ctx: ctx as unknown as CanvasRenderingContext2D, text }; }
it("selects previous/current/next visible profiles in x order and excludes future Replay bars", () => {
  const current = hit(), shuffled = { ...current, view: { ...view, bars: [bars[3], bars[1], bars[0], bars[2]] } };
  expect(footprintMagnifierWindow(args(), shuffled).slots.map(s => s.time)).toEqual([0, 60000, 120000]);
  expect(footprintMagnifierWindow(args(), shuffled).hoveredIndex).toBe(1);
  expect(footprintMagnifierWindow(args(), current, { timeframe: "1m", through: 120000 }).slots.map(s => s.time)).toEqual([0, 60000]);
  expect(footprintMagnifierWindow({ ...args(), bars: [] }, current).slots).toEqual([]);
});
it("omits offscreen profiles and time captions for the visible-range aggregate", () => {
  expect(footprintMagnifierWindow(args(100), hit(100)).slots.map(s => s.time)).toEqual([60000]);
  const aggregate = { ...hit(), view: { ...view, id: "vr", bars: [bars[1]] } }; expect(footprintMagnifierWindow(args(), aggregate).slots[0].time).toBeNull();
});
it("places clear side panels with the native 44px leader gap", () => {
  expect(footprintMagnifierPosition(100, 180, 200, 300, 200, 1000, 500)).toEqual({ left: 224, top: 100, side: "right", clear: true });
  expect(footprintMagnifierPosition(800, 880, 200, 300, 200, 1000, 500)).toEqual({ left: 456, top: 100, side: "left", clear: true });
});
it("keeps three profiles when room permits and falls back when labels need space", () => {
  const wide = canvas(), narrow = canvas(), geometry = paintFootprintMagnifier(wide.ctx, args(), hit())!;
  expect(geometry).toMatchObject({ profiles: 3, textSize: 16, verticalScale: 1.9, bodyHeight: 240 }); expect(wide.text).toContain("00:01");
  expect(paintFootprintMagnifier(narrow.ctx, args(500), hit(500))?.profiles).toBe(1);
});
it("preserves source fields and skips empty profile windows", () => {
  const before = structuredClone(bars), c = canvas(); paintFootprintMagnifier(c.ctx, args(), hit()); expect(bars).toEqual(before);
  expect(paintFootprintMagnifier(c.ctx, args(), hit(), { slots: [], hoveredIndex: -1 })).toBeNull();
});
it("paints the visible portion of a tall cell even when its midpoint is outside the pane", () => {
  const fills: number[][] = [], c = canvas(); Object.assign(c.ctx, { fillRect: (...rect: number[]) => fills.push(rect) });
  const frame = { ...args(), coords: { ...args().coords, priceToY: (price: number) => (102 - price) * 200 - 10 }, bounds: { top: 100, height: 100 } } as unknown as RendererLayerArgs;
  paintFootprintBar(c.ctx, frame, bars[0], undefined, 1, { ...defaultFootprint(), candleVisible: false, valueAreaVisible: false, pocVisible: false }, { width: 80, offset: 0, within: true });
  expect(fills).toHaveLength(2); expect(fills.every(rect => rect[1] === 190 && rect[3] === 199)).toBe(true);
});
it("owns a topmost pointer-transparent surface and clears/resizes/removes it", () => {
  const ctx = { setTransform: vi.fn(), clearRect: vi.fn() }, children: object[] = [];
  const parent = { get lastElementChild() { return children.at(-1); }, appendChild(value: object) { const at = children.indexOf(value); if (at >= 0) children.splice(at, 1); children.push(value); Object.assign(value, { parentElement: parent }); } };
  const overlay = { width: 0, height: 0, style: {}, dataset: {}, parentElement: undefined, setAttribute: vi.fn(), getContext: () => ctx, remove() { const at = children.indexOf(overlay); if (at >= 0) children.splice(at, 1); } };
  const doc = { createElement: vi.fn(() => overlay) }, host = { width: 800, height: 400, parentElement: parent, ownerDocument: doc } as unknown as HTMLCanvasElement;
  const surface = createFootprintMagnifierSurface(); surface.mount(host); expect(surface.acquire(2)).toBe(ctx); expect(doc.createElement).toHaveBeenCalledOnce();
  expect(overlay.style).toMatchObject({ pointerEvents: "none", position: "absolute" }); expect(overlay).toMatchObject({ width: 800, height: 400 });
  parent.appendChild({}); surface.acquire(2); expect(parent.lastElementChild).toBe(overlay); host.width = 1000; surface.acquire(2); expect(overlay.width).toBe(1000);
  surface.clear(); const calls = ctx.clearRect.mock.calls.length; surface.clear(); expect(ctx.clearRect).toHaveBeenCalledTimes(calls);
  surface.destroy(); expect(children).not.toContain(overlay); expect(surface.acquire(1)).toBeUndefined();
});
