import { describe, expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { createFootprintReveal, footprintBodyModulation, footprintCandleHalfWidth, footprintRawSpacing, footprintRevealTarget } from "@/lib/orderflow/footprintReveal";
import { defaultFootprint, footprintPlacements, paintFootprintBar, paintFootprintInstanceCandles, type FootprintInstance } from "@/lib/orderflow/footprint";
import { paintFootprintStatistics } from "@/lib/orderflow/footprintStatistics";
const instance = (id: string, position: "left" | "right" | "within"): FootprintInstance => ({ id, label: id, style: { ...defaultFootprint(), position, valueAreaVisible: false, pocVisible: false } });
const args = { bars: [{ time: 0, open: 100, high: 103, low: 99, close: 102, volume: 5 }],
  coords: { pxPerBar: () => 100, bodySpacing: () => 100, getViewport: () => ({ barSpacing: 100 }), timeToX: () => 200, width: 500, priceToY: (p: number) => (110 - p) * 20, visibleTimeRange: () => ({ from: 0, to: 1 }) },
  bounds: { top: 0, height: 400 }, scale: {}, theme: { background: "#ffffff", textColor: "#112233" } } as unknown as RendererLayerArgs;
const bar = { time: 0, volume: 5, delta: 3, poc: 100, levels: [{ price: 100, upperPrice: 101, buyVolume: 4, sellVolume: 1, imbalance: null }] };
function canvas() {
  const fills: { x: number; width: number; alpha: number }[] = [], strokes: number[] = [], texts: string[] = [], saved: number[] = [];
  const ctx = { globalAlpha: 1, save() { saved.push(this.globalAlpha); }, restore() { this.globalAlpha = saved.pop()!; },
    fillRect(x: number, _y: number, width: number) { fills.push({ x, width, alpha: this.globalAlpha }); },
    strokeRect() { strokes.push(this.globalAlpha); }, stroke() { strokes.push(this.globalAlpha); }, fillText(text: string) { texts.push(text); }, beginPath() {}, moveTo() {}, lineTo() {} };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, strokes, texts };
}
describe("reference Footprint zoom reveal", () => {
  it("matches the 5–10 raw-spacing smoothstep without a fixed profile-width gate", () => {
    for (const [spacing, expected] of [[1, 0], [5, 0], [6, .104], [7.5, .5], [9, .896], [10, 1], [200, 1]]) expect(footprintRevealTarget(spacing, true)).toBeCloseTo(expected, 12);
    expect(footprintRevealTarget(100, false)).toBe(0); expect(footprintRevealTarget(NaN, true)).toBe(0);
  });
  it("reads prototype-based raw spacing and body spacing separately from stretched pitch", () => {
    class Coords { getViewport() { return { barSpacing: 7.5 }; } pxPerBar() { return 100; } bodySpacing() { return 10; } }
    const view = { ...args, coords: new Coords() } as unknown as RendererLayerArgs;
    expect(footprintRawSpacing(view)).toBe(7.5); expect(footprintRevealTarget(footprintRawSpacing(view), true)).toBe(.5);
    expect(footprintCandleHalfWidth(view)).toBe(3.5);
  });
  it("uses 140 ms exponential easing and gives the same result at different frame rates", () => {
    const a = createFootprintReveal(), b = createFootprintReveal(); a.update(0, 5, true, "a"); b.update(0, 5, true, "a");
    expect(a.update(140, 10, true, "a")).toBeCloseTo(1 - Math.exp(-1), 12);
    b.update(70, 10, true, "a"); expect(b.update(140, 10, true, "a")).toBeCloseTo(a.opacity, 12);
    expect(a.animating).toBe(true); for (let time = 280; time < 2000; time += 140) a.update(time, 10, true, "a");
    expect(a.opacity).toBe(1); expect(a.animating).toBe(false);
  });
  it("snaps on first/nonpositive/long-gap frames and resets after source changes or Replay rewinds", () => {
    const reveal = createFootprintReveal(); expect(reveal.update(100, 10, true, "first", 100)).toBe(1);
    expect(reveal.update(100, 5, true, "first", 101)).toBe(0);
    expect(reveal.update(1201, 10, true, "first", 102)).toBe(1);
    expect(reveal.update(1217, 5, true, "second", 103)).toBe(0);
    reveal.update(1233, 10, true, "second", 104); expect(reveal.opacity).toBeGreaterThan(0);
    expect(reveal.update(1249, 5, true, "second", 80)).toBe(0);
    reveal.reset(); expect(reveal.animating).toBe(false); expect(reveal.opacity).toBe(0);
  });
  it("restores candle bodies and grid as observed data becomes unavailable", () => {
    const reveal = createFootprintReveal(); reveal.update(0, 10, true, "same");
    expect(reveal.update(140, 10, false, "same")).toBeCloseTo(Math.exp(-1));
    const full = footprintBodyModulation(1, ["left", "within"]);
    expect(full.candleBodyScale).toBeCloseTo(.07); expect(full.candleBodyAlpha).toBeCloseTo(.07); expect(full.gridAlpha).toBe(0);
    expect(footprintBodyModulation(0, ["left", "within"])).toEqual({ candleBodyScale: 1, candleBodyAlpha: 1, gridAlpha: 1 });
  });
  it("packs one-sided, two-sided and Within profiles against the actual candle body", () => {
    const right = instance("r", "right"), left = instance("l", "left"), within = instance("w", "within");
    expect(footprintPlacements(args, [right]).get("r")).toMatchObject({ width: 84, offset: 50 });
    const both = footprintPlacements(args, [left, right, within]);
    expect(both.get("l")).toMatchObject({ width: 42, offset: -29 }); expect(both.get("r")).toMatchObject({ width: 42, offset: 29 });
    expect(both.get("w")).toMatchObject({ width: 4, offset: 0 });
    expect(footprintPlacements(args, [within]).get("w")).toMatchObject({ width: 70, offset: 0 });
  });
  it("keeps adjacent side groups separated throughout a zoom transition", () => {
    const instances = [instance("a", "left"), instance("b", "left"), instance("c", "right"), instance("d", "right"), instance("e", "within")];
    for (const opacity of [0, .1, .5, 1]) {
      const placements = [...footprintPlacements(args, instances, opacity).values()].map(p => [p.offset - p.width / 2, p.offset + p.width / 2]).sort((a, b) => a[0] - b[0]);
      for (let index = 1; index < placements.length; index++) expect(placements[index][0]).toBeGreaterThanOrEqual(placements[index - 1][1] - 1e-9);
    }
  });
  it("paints narrow positive-width histograms with the reveal opacity and no unreadable labels", () => {
    const c = canvas(); paintFootprintBar(c.ctx, args, bar, undefined, 1, instance("r", "right").style, { width: 10, offset: 0, within: false, opacity: .5 });
    expect(c.fills.length).toBeGreaterThan(0); expect(c.fills.every(fill => fill.alpha <= .5)).toBe(true); expect(c.texts).toEqual([]); expect(c.ctx.globalAlpha).toBe(1);
    const hidden = canvas(); paintFootprintBar(hidden.ctx, args, bar, undefined, 1, defaultFootprint(), { width: 100, offset: 0, within: false, opacity: 0 }); expect(hidden.fills).toEqual([]); expect(hidden.texts).toEqual([]);
  });
  it("keeps candle wicks opaque while only body fill fades for Within", () => {
    const c = canvas(), within = instance("w", "within"), placements = footprintPlacements(args, [within]);
    paintFootprintInstanceCandles(c.ctx, args, [within], placements, 1);
    expect(c.strokes).toEqual([1]); expect(c.fills[0].width).toBe(70); expect(c.fills[0].alpha).toBeCloseTo(.07);
    const side = canvas(), right = instance("r", "right"); paintFootprintInstanceCandles(side.ctx, args, [right], footprintPlacements(args, [right]), 1);
    expect(side.fills[0]).toMatchObject({ width: 4, alpha: 1 });
  });
  it("withholds statistics below 60% reveal and restores inherited canvas alpha", () => {
    const c = canvas(), style = { ...defaultFootprint(), statisticsVisible: true };
    paintFootprintStatistics(c.ctx, args, bar, 1, style, 200, 100, .59); expect(c.texts).toEqual([]);
    paintFootprintStatistics(c.ctx, args, bar, 1, style, 200, 100, .6); expect(c.texts.length).toBeGreaterThan(0); expect(c.ctx.globalAlpha).toBe(1);
  });
});
