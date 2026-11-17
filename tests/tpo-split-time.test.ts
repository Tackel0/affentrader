import { describe, expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { buildTpoSessions, tpoCalendar } from "@/lib/orderflow/tpoModel";
import { defaultTpo } from "@/lib/orderflow/tpoSettings";
import { paintTpoSessions } from "@/lib/orderflow/tpoRenderer";

const m = 60000;
const bar = (time: number, price = 100) => ({ time, low: price, high: price, open: price, close: price, volume: 1 });
const style = { ...defaultTpo(), rowSize: 1, splitPeriods: true, candlesVisible: false, boundariesVisible: false,
  pocVisible: false, valueAreaVisible: false, ibVisible: false };
function draw(source: ReturnType<typeof bar>[], prefs = style, project = (time: number) => 20 + time / (5 * m) * 12, spacing = 12, width = 2000) {
  const rects: number[][] = [], labels: Array<{ text: string; x: number; width: number }> = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, rect: (...values: number[]) => rects.push(values), fill() {},
    fillText: (text: string, x: number, _y: number, width: number) => labels.push({ text, x, width }) } as unknown as CanvasRenderingContext2D;
  const view = { bars: source, bounds: { top: 0, height: 500 }, scale: {}, theme: { textColor: "#fff" },
    coords: { width, timeToX: project, pxPerBar: () => spacing, priceToY: (price: number) => (110 - price) * 20 } } as unknown as RendererLayerArgs;
  paintTpoSessions(ctx, view, buildTpoSessions(source, prefs, "5m"), prefs);
  return { rects, labels };
}
describe("expanded TPO real time columns", () => {
  it("covers the producing candle centers instead of packing by a font width", () => {
    const source = [bar(0), bar(25 * m), bar(30 * m)];
    const result = draw(source);
    expect(result.rects).toEqual([[14, 180, 71.4, 19.4], [86, 180, 71.4, 19.4]]);
    expect(result.labels).toEqual([{ text: "A", x: 50, width: 71 }, { text: "B", x: 122, width: 71 }]);
  });
  it("retains missing block gaps without inventing opportunities or renumbering letters", () => {
    const result = draw([bar(0), bar(60 * m)]);
    expect(result.rects.map(rect => rect[0])).toEqual([14, 158]);
    expect(result.labels.map(label => label.text)).toEqual(["A", "C"]);
  });
  it("uses the coordinate port's compressed gap spacing rather than assuming a linear timestamp axis", () => {
    const compressed = (time: number) => time <= 60 * m ? 20 + time / (60 * m) * 12 : 32 + (time - 60 * m) / (5 * m) * 12;
    const result = draw([bar(0), bar(60 * m)], style, compressed);
    expect(result.rects[0][0]).toBe(14); expect(result.rects[0][2]).toBe(5.4);
    expect(result.rects[1][0]).toBe(26); expect(result.rects[1][2]).toBe(71.4);
    expect(result.labels.map(label => label.text)).toEqual(["A", "C"]);
  });
  it("scales and pans columns with the chart while packed profiles preserve their previous layout", () => {
    const source = [bar(0), bar(60 * m)];
    const normal = draw(source), zoom = draw(source, style, time => 40 + time / (5 * m) * 24, 24);
    expect(zoom.rects[1][0]).toBe(normal.rects[1][0] * 2);
    expect(zoom.rects[1][2]).toBeCloseTo(normal.rects[1][2] * 2 + .6);
    expect(draw(source, { ...style, splitPeriods: false }).rects.map(rect => rect[0])).toEqual([24, 32]);
  });
  it("clamps a final block to the actual session end", () => {
    const result = draw([bar(0), bar(25 * m)], { ...style, blockMinutes: "240", sessionMinutes: 30 });
    expect(result.rects).toHaveLength(1); expect(result.rects[0][2]).toBe(71.4);
  });
  it("keeps subpixel columns narrow and omits letters that cannot fit", () => {
    const result = draw([bar(0)], style, time => 20 + time / (30 * m) * .4, .05);
    expect(result.rects[0][2]).toBeCloseTo(.36); expect(result.labels).toEqual([]);
  });
  it("draws a partial weekly block at its loaded time even when the week opening is off screen", () => {
    const prefs = { ...style, sessionPeriod: "Week" as const, blockMinutes: "240" as const };
    const start = Date.parse("2026-11-02T00:00:00Z"), observed = start + 2 * 86400000;
    const result = draw([bar(observed)], prefs, time => 20 + (time - observed) / (5 * m) * 12);
    expect(result.rects[0][0]).toBe(14);
    expect(result.labels[0].text).toBe("M");
  });
  it("separates repeated local clock hours by their real UTC positions", () => {
    const prefs = { ...style, sessionZone: "America/New_York", blockMinutes: "60" as const };
    const start = tpoCalendar(prefs).forDate("2026-11-01").start;
    const first = Date.parse("2026-11-01T05:00:00Z"), second = Date.parse("2026-11-01T06:00:00Z");
    const result = draw([bar(first), bar(second)], prefs, time => 20 + (time - start) / (5 * m) * 12);
    expect(result.labels.map(label => label.text)).toEqual(["B", "C"]);
    expect(result.rects[1][0] - result.rects[0][0]).toBe(144);
  });
  it("culls offscreen blocks and excludes future Replay opportunities", () => {
    const source = [bar(0), bar(60 * m), bar(120 * m)];
    const result = draw(source, style, time => -150 + time / (5 * m) * 12, 12, 100);
    expect(result.rects).toHaveLength(1); expect(result.labels.map(label => label.text)).toEqual(["C"]);
    expect(draw(source.slice(0, 1)).labels.map(label => label.text)).toEqual(["A"]);
  });
});
