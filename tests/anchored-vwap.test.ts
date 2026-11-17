import { describe, expect, it } from "vitest";
import { createDrawing, deserializeDrawing, getDrawingType, type Drawing, type Projector } from "@luxalgo/vela";
import type { OHLCV } from "@/types/trading";
import { anchoredVwap, AnchoredVwapCache, MAX_ANCHORED_VWAP_BARS, type VwapSample } from "@/lib/orderflow/anchoredVwap";
import { registerAnchoredVwapConstruction } from "@/lib/drawings/anchoredVwapPlugin";
import { drawingGeometry, defaultDrawingTarget, drawingValues } from "@/lib/alerts/drawing";
import type { DrawingAlertCondition } from "@/types/drawingAlerts";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const bar = (time: number, price: number, volume = 1): OHLCV => ({ time, open: price, high: price, low: price, close: price, volume });
interface Surface extends Drawing {
  series(projector: Projector): VwapSample[] | null;
  layout(projector: Projector): { mid: number[][]; upper: number[][]; lower: number[][] };
  vwapNotice: string;
}
const project = (bars: OHLCV[], yOf = (price: number) => 200 - price): Projector => ({ width: 1000, height: 600, xOf: time => time, yOf,
  paneIdAtY: () => "price", pxToPoint: (x, y) => ({ time: x, price: y }), barsInRange: (from, to) => bars.filter(bar => bar.time >= from && bar.time <= to) });
const drawing = () => createDrawing("anchoredvwap", { id: "vwap", paneId: "price", anchors: [{ time: 0, price: 100 }] })! as Surface;
registerAnchoredVwapConstruction();
describe("volume weighted HLC3 Anchored VWAP", () => {
  it("matches independent weighted two-pass means and population deviations at every prefix", () => {
    const source = Array.from({ length: 100 }, (_, i) => ({ ...bar(i, 100 + i % 13, i % 7), high: 110 + i % 13, low: 95 + i % 13 }));
    const result = anchoredVwap(source, 0, 2);
    for (const point of result.samples) {
      const rows = source.slice(0, point.time + 1), sum = rows.reduce((s, b) => s + b.volume!, 0);
      const mean = rows.reduce((s, b) => s + (b.high + b.low + b.close) / 3 * b.volume!, 0) / sum;
      const dev = Math.sqrt(rows.reduce((s, b) => s + ((b.high + b.low + b.close) / 3 - mean) ** 2 * b.volume!, 0) / sum);
      expect(point.mid).toBeCloseTo(mean, 10); expect(point.upper).toBeCloseTo(mean + 2 * dev, 10); expect(point.lower).toBeCloseTo(mean - 2 * dev, 10);
    }
  });
  it("does not invent a TWAP for leading or entirely absent volume", () => {
    const zero = [bar(0, 1, 0), bar(1, 1e20, 0)]; expect(anchoredVwap(zero, 0).samples).toEqual([]);
    const full = anchoredVwap([...zero, bar(2, 100, 10), bar(3, -1e20, 0)], 0);
    expect(full.samples).toEqual([2, 3].map(time => ({ time, mid: 100, upper: 100, lower: 100, deviation: 0 })));
    expect(anchoredVwap([...zero, bar(2, 100, 10)], 0, 1, 1).samples).toEqual([]);
  });
  it("retains small variance on a large price base", () => {
    const result = anchoredVwap([1, 2, 3].map((v, i) => bar(i, 1e12 + v)), 0).samples.at(-1)!;
    expect(result.mid).toBe(1e12 + 2); expect(result.deviation).toBeCloseTo(Math.sqrt(2 / 3), 12);
  });
  it("supports large finite opposite prices without overflowing squared variance", () => {
    const result = anchoredVwap([bar(0, -1e308), bar(1, 1e308)], 0).samples.at(-1)!;
    expect(result.mid).toBe(0); expect(result.deviation / 1e308).toBeCloseTo(1, 14);
    expect(() => anchoredVwap([bar(0, -1e308), bar(1, 1e308)], 0, 2)).toThrow(/precision/);
  });
  it("rejects unavailable anchor history and invalid selected bars and options", () => {
    expect(() => anchoredVwap([bar(1, 100)], 0)).toThrow(/history/);
    for (const bad of [bar(0, NaN), bar(0, 100, -1), bar(0, 100, Infinity), { ...bar(0, 100), low: 101 }]) expect(() => anchoredVwap([bad], 0)).toThrow();
    expect(() => anchoredVwap([bar(0, 100), bar(0, 101)], 0)).toThrow(/ascending/);
    expect(() => anchoredVwap([bar(0, 100), bar(NaN, 101)], 0)).toThrow(/timestamps/);
    for (const multiplier of [0, -1, NaN, 101]) expect(() => anchoredVwap([bar(0, 100)], 0, multiplier)).toThrow();
    expect(() => anchoredVwap(Array.from({ length: MAX_ANCHORED_VWAP_BARS + 1 }, (_, i) => bar(i, 100)), 0)).toThrow(/50,000/);
    expect(() => anchoredVwap([bar(0, 100, Number.MAX_VALUE), bar(1, 100, Number.MAX_VALUE)], 0)).toThrow(/precision/);
  });
  it("excludes future prices and invalid future volume at a bounded replay time", () => {
    const prefix = [bar(0, 100), bar(1, 110, 2)], future = bar(2, 10000, Infinity);
    expect(anchoredVwap([...prefix, future], 0, 1, 1)).toEqual(anchoredVwap(prefix, 0));
    const all = anchoredVwap([...prefix, bar(2, 10000)], 0); expect(all.samples.slice(0, 2)).toEqual(anchoredVwap(prefix, 0).samples);
  });
  it("invalidates in-place source revisions and settings, recovers after failure and gates dropped history", () => {
    const cache = new AnchoredVwapCache(), source = [bar(0, 100), bar(1, 110)];
    const first = cache.read(source, 0, 1); expect(cache.read(source.map(b => ({ ...b })), 0, 1)).toBe(first);
    source[0].volume = 3; const next = cache.read(source, 0, 1); expect(next.samples.at(-1)!.mid).toBe(102.5);
    expect(cache.read(source, 0, 2)).not.toBe(next); source[0].volume = -1; expect(() => cache.read(source, 0, 2)).toThrow();
    source[0].volume = 3; expect(cache.read(source, 0, 1).samples).toEqual(next.samples);
    expect(() => cache.read(source.slice(1), 0, 1)).toThrow(/history/);
  });
  it("keeps the native class, geometry, hit tests and logarithmic/inverted projections", () => {
    const before = getDrawingType("anchoredvwap")!; registerAnchoredVwapConstruction(); expect(getDrawingType("anchoredvwap")!.create).toBe(before.create);
    const shape = drawing(), source = [bar(0, 100), bar(100, 110)], p = project(source);
    const samples = shape.series(p)!; expect(shape.hitTest(100, 200 - samples[1].mid, p, 3)).toBe(true);
    expect(shape.handlePoints(p)).toEqual([[0, 100]]);
    expect(shape.layout(project(source, v => v)).mid[1][1]).toBe(samples[1].mid);
    expect(shape.layout(project(source, Math.log)).upper[1][1]).toBe(Math.log(samples[1].upper));
    expect(shape.priceRange()).toMatchObject({ min: 100, max: 110 }); expect(shape.timeExtent()).toMatchObject({ min: 0, max: 100 });
    expect(shape.vwapNotice).toMatch(/HLC3 VWAP.*2 loaded bars/);
  });
  it("round trips settings while omitting transient computation and clears stale extents on failure", () => {
    const shape = drawing(); shape.applyProps({ multiplier: 2, midColor: "#123456" }); shape.series(project([bar(0, 100), bar(1, 110)]));
    const doc = shape.serialize(); expect(doc.props).toMatchObject({ multiplier: 2, midColor: "#123456" }); expect(JSON.stringify(doc)).not.toMatch(/vwapNotice|cachedRange|deviation/);
    const restored = deserializeDrawing(JSON.parse(JSON.stringify(doc)))! as Surface;
    expect(restored.series(project([bar(0, 100), bar(1, 110)]))!.at(-1)!.upper).toBe(115);
    expect(restored.series(project([bar(1, 110)]))).toBeNull(); expect(restored.priceRange()).toBeNull(); expect(restored.timeExtent()).toBeNull(); expect(restored.vwapNotice).toMatch(/history/);
    expect(restored.series(project([bar(0, 100, 0)]))).toBeNull(); expect(restored.vwapNotice).toMatch(/no positive volume/);
    expect(restored.series(project([bar(0, 100)]))).toHaveLength(1);
  });
  it("shares exact native levels/zones with alert calculations for every replay prefix", () => {
    const shape = drawing(), geometry = drawingGeometry(shape.serialize())!, c: DrawingAlertCondition = { type: "drawing", geometry, ...defaultDrawingTarget(geometry) };
    const source = [bar(0, 100, 0), bar(1, 110), bar(2, 120, 3)];
    for (let i = 0; i < source.length; i++) {
      const native = shape.series(project(source.slice(0, i + 1)))?.at(-1);
      c.target = { type: "zone" }; const zone = drawingValues(c, source, "1m", i);
      if (!native) { expect(zone).toBeUndefined(); continue; }
      expect(zone).toMatchObject({ low: native.lower, high: native.upper });
      for (const series of ["mid", "upper", "lower"] as const) { c.target = { type: "level", series }; expect(drawingValues(c, source, "1m", i)!.levels).toEqual([native[series]]); }
    }
  });
  it("installs the source/error caption in all five pinned native painters", () => {
    const require = createRequire(import.meta.url), dist = path.dirname(require.resolve("@luxalgo/vela"));
    const sources = readdirSync(dist).filter(n => /\.(?:js|cjs)$/.test(n) && !n.endsWith(".min.js")).map(n => readFileSync(path.join(dist, n), "utf8")).filter(s => s.includes("/* Affentrader anchored VWAP notice v1 */"));
    expect(sources).toHaveLength(5); for (const source of sources) expect(source).toContain("this.paintAnchoredVwap(ctx, d, proj, theme);");
  });
});
