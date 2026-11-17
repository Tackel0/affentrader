import { expect, it, vi } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "@/types/trading";
import { defaultFootprint } from "@/lib/orderflow/footprint";
import { FOOTPRINT_MODES } from "@/lib/orderflow/footprintModes";
import { footprintHoverLines, footprintHoverModifier, footprintMagnifierRows, footprintRowAtPoint, paintFootprintHover, type FootprintHoverView } from "@/lib/orderflow/footprintHover";
const bar: FootprintBar = { time: 0, volume: 40, delta: 10, poc: 100, levels: [100, 101, 102, 104, 110].map((price, i) => ({ price, upperPrice: price + 1, buyVolume: i === 4 ? 100 : 8, sellVolume: 2, buyCount: i === 2 ? null : 2, sellCount: 1, imbalance: null })) };
const style = { ...defaultFootprint(), candleVisible: false, valueAreaVisible: false, histogramVisible: true };
const view: FootprintHoverView = { id: "fp2", label: "Footprint 2", bars: [bar], style, step: 1, placement: { width: 80, offset: 0, within: true } };
const args = (invert = false) => ({ priceStyle: "footprint", bars: [{ time: 0 }], cursor: { x: 100, y: invert ? 30 : 170 }, coords: { width: 500, timeToX: () => 100, pxPerBar: () => 100, priceToY: (price: number) => invert ? (price - 100) * 20 : (110 - price) * 20 }, scale: {}, bounds: { top: 0, height: 400 }, theme: { textColor: "#112233", background: "#ffffff" } }) as unknown as RendererLayerArgs;
function context() {
  const text: string[] = [], fills: number[][] = [], outlines: number[][] = []; let depth = 0;
  const ctx = { save() { depth++; }, restore() { depth--; }, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, rect() {}, clip() {}, fillRect(...values: number[]) { fills.push(values); }, strokeRect(...values: number[]) { outlines.push(values); }, fillText(value: string) { text.push(value); } } as unknown as CanvasRenderingContext2D;
  return { ctx, text, fills, outlines, depth: () => depth };
}
it.each([false, true])("hits complete canonical row bands on inverted=%s", invert => {
  const a = args(invert), y = invert ? 30 : 170;
  expect(footprintRowAtPoint(a, [view], 100, y)).toMatchObject({ lower: 101, upper: 102, row: 1, view: { id: "fp2" } });
  for (const [x, y] of [[59, 170], [140, 170], [-1, 170], [100, -1], [100, 400], [NaN, 170]]) expect(footprintRowAtPoint(a, [view], x, y)).toBeNull();
  expect(footprintRowAtPoint(args(), [view], 100, 180)?.lower).toBe(100);
  expect(footprintRowAtPoint(args(), [view], 100, 180, true)?.lower).toBe(100);
});
it("uses the actual hovered instance and topmost paint order rather than inspection selection", () => {
  const left = { ...view, id: "fp1", placement: { width: 80, offset: -90, within: false } };
  expect(footprintRowAtPoint(args(), [left, view], 10, 170)?.view.id).toBe("fp1");
  expect(footprintRowAtPoint(args(), [view, { ...view, id: "fp5" }], 100, 170)?.view.id).toBe("fp5");
});
it("reads observed filtered rows while excluding unloaded, future Replay and wrong-style data", () => {
  const hidden = { ...view, bars: [{ ...bar, levels: bar.levels.map(row => ({ ...row, filtered: true })) }] };
  expect(footprintRowAtPoint(args(), [hidden], 100, 170, true)?.lower).toBe(101);
  expect(footprintRowAtPoint({ ...args(), bars: [] }, [view], 100, 170, true)).toBeNull();
  expect(footprintRowAtPoint({ ...args(), priceStyle: "candles" }, [view], 100, 170, true)).toBeNull();
  expect(footprintRowAtPoint(args(), [view], 100, 170, true, { timeframe: "1m", through: 59999 })).toBeNull();
  expect(footprintRowAtPoint(args(), [view], 100, 170, true, { timeframe: "1m", through: NaN })).toBeNull();
  expect(footprintRowAtPoint(args(), [view], 100, 170, true, { timeframe: "1m", through: 60000 })?.lower).toBe(101);
});
it("reads dense histograms without numeric labels while Shift also inspects narrow lanes", () => {
  const dense = { ...args(), coords: { ...args().coords, priceToY: (price: number) => (110 - price) * 2 } } as unknown as RendererLayerArgs;
  expect(footprintRowAtPoint(dense, [view], 100, 17)?.lower).toBe(101);
  expect(footprintRowAtPoint(dense, [view], 100, 17, true)?.lower).toBe(101);
  const narrow = { ...view, placement: { width: 20, offset: 0, within: true } };
  expect(footprintRowAtPoint(args(), [narrow], 100, 170)?.lower).toBe(101);
  expect(footprintRowAtPoint(args(), [{ ...narrow, placement: { ...narrow.placement, opacity: 0 } }], 100, 170, true)).toBeNull();
  expect(footprintRowAtPoint(args(), [narrow], 100, 170, true)?.lower).toBe(101);
});
it("reads raw per-row bid/ask, total and delta and keeps neighboring price gaps blank", () => {
  const hit = footprintRowAtPoint(args(), [view], 100, 150)!;
  expect(footprintHoverLines(hit)).toEqual(["Footprint 2 · [102, 103)", "Bid 2 × Ask 8", "Total 10 · Delta 6", "Partial observations · Shift: magnify"]);
  expect(footprintMagnifierRows(hit).map(row => row.price)).toEqual([100, 101, 102, 104]);
  expect(footprintMagnifierRows(hit)).not.toContainEqual(expect.objectContaining({ price: 103 }));
});
it("renders a magnified profile using original full-profile normalization", () => {
  const a = args(), drawing = context(), before = JSON.stringify(bar);
  paintFootprintHover(drawing.ctx, a, [view], true);
  const profiles = drawing.fills.slice(2);
  expect(profiles.length).toBeGreaterThan(0);
  // The off-lens 100-volume row still sets the scale: local 8-volume bars use 8% of a half-lane.
  expect(Math.max(...profiles.map(rect => rect[2]))).toBeCloseTo(80 * 1.9 / 2 * .08);
  expect(drawing.text).toContain("00:00");
  expect(drawing.depth()).toBe(0); expect(JSON.stringify(bar)).toBe(before);
});
it("preserves raw numeric/count labels and unknown count dashes in every magnified mode", () => {
  for (const volumeMode of FOOTPRINT_MODES) {
    const drawing = context(), a = args(); a.cursor = { x: 100, y: 150 };
    paintFootprintHover(drawing.ctx, a, [{ ...view, style: { ...style, volumeMode, cellValues: "bid-ask-trades", averageTradeSize: true } }], true);
    expect(drawing.text).toContain("—"); expect(drawing.text).toContain("00:00");
    expect(drawing.depth()).toBe(0);
  }
});
it("clamps readouts and scales the magnifier to a smaller pane", () => {
  for (const magnify of [false, true]) {
    const drawing = context(), a = { ...args(), coords: { ...args().coords, width: 220 } } as unknown as RendererLayerArgs;
    paintFootprintHover(drawing.ctx, a, [view], magnify);
    const [x, y, width, height] = drawing.fills[0];
    expect(x).toBeGreaterThanOrEqual(0); expect(x + width).toBeLessThanOrEqual(220); expect(y + height).toBeLessThanOrEqual(400);
  }
  const small = context(); paintFootprintHover(small.ctx, { ...args(), bounds: { top: 0, height: 200 } }, [view], true); expect(small.fills.length).toBeGreaterThan(0); expect(small.fills.flat().every(Number.isFinite)).toBe(true);
  const off = context(); expect(paintFootprintHover(off.ctx, { ...args(), cursor: null }, [view], true)).toBeNull();
});
it("repaints stationary Shift transitions only for the hovered chart and releases listeners on destroy", () => {
  const host = new EventTarget(), doc = new EventTarget(), win = new EventTarget(), invalidate = vi.fn();
  Object.assign(doc, { defaultView: win });
  const canvas = { closest: () => host, ownerDocument: doc } as unknown as HTMLCanvasElement;
  const event = (type: string, values: object = {}) => Object.assign(new Event(type), values);
  const modifier = footprintHoverModifier(invalidate); modifier.mount(canvas);
  doc.dispatchEvent(event("keydown", { key: "Shift" })); expect(modifier.shift).toBe(false);
  host.dispatchEvent(event("pointermove", { shiftKey: false })); doc.dispatchEvent(event("keydown", { key: "Shift" })); expect(modifier.shift).toBe(true);
  doc.dispatchEvent(event("keydown", { key: "Shift", repeat: true })); expect(invalidate).toHaveBeenCalledTimes(1);
  doc.dispatchEvent(event("keyup", { key: "Shift", shiftKey: false })); expect(modifier.shift).toBe(false);
  host.dispatchEvent(event("pointermove", { shiftKey: true })); win.dispatchEvent(event("blur")); expect(modifier.shift).toBe(false);
  host.dispatchEvent(event("pointermove", { shiftKey: true })); host.dispatchEvent(event("pointerleave")); expect(modifier.shift).toBe(false);
  host.dispatchEvent(event("pointermove", { shiftKey: true })); doc.dispatchEvent(event("visibilitychange")); expect(modifier.shift).toBe(false);
  modifier.destroy(); const calls = invalidate.mock.calls.length;
  host.dispatchEvent(event("pointermove", { shiftKey: true })); doc.dispatchEvent(event("keydown", { key: "Shift" })); expect(modifier.shift).toBe(false); expect(invalidate).toHaveBeenCalledTimes(calls);
});
