import { describe, expect, it } from "vitest";
import { createDrawing, deserializeDrawing, getDrawingType, type Drawing, type Projector, type OHLCV } from "@luxalgo/vela";
import { FixedProfileCache, MAX_FIXED_BARS, MAX_DEVELOPING_BARS, type FixedProfileResult } from "@/lib/orderflow/fixedProfileModel";
import { registerFixedProfileConstruction } from "@/lib/drawings/fixedProfilePlugin";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const bar = (time: number, low: number, high: number, volume: number, down = false): OHLCV => ({ time, low, high, volume, open: down ? high : low, close: down ? low : high });
const options = { rows: 4, valueAreaPct: 70, developing: false };
const total = (result: FixedProfileResult) => result.profile.rows.reduce((sum, row) => sum + row.up + row.down, 0);
interface Surface extends Drawing { compute(projector: Projector): FixedProfileResult | null; frvpNotice: string; layout(projector: Projector): { x0: number; x1: number; grow: number; pocY: number }; }
const project = (bars: OHLCV[], inverted = false): Projector => ({ width: 1000, height: 600, xOf: time => time, yOf: price => (inverted ? price : 200 - price),
  paneIdAtY: () => "price", pxToPoint: (x, y) => ({ time: x, price: y }), barsInRange: (from, to) => bars.filter(bar => bar.time >= from && bar.time <= to) });
const drawing = (props: Record<string, unknown> = {}, reversed = false) => createDrawing("fixedrangevp", { id: "fixed", paneId: "price",
  anchors: [{ time: reversed ? 100 : 0, price: 10 }, { time: reversed ? 0 : 100, price: 20 }], props })! as Surface;
registerFixedProfileConstruction();
describe("native fixed-range estimated volume profile", () => {
  it("partitions a candle across price rows without copying its full volume to OHLC locations", () => {
    const result = new FixedProfileCache().read([bar(0, 0, 4, 40)], options)!;
    expect(result.profile.rows.map(row => row.up)).toEqual([10, 10, 10, 10]); expect(total(result)).toBe(40); expect(result.total).toBe(40);
  });
  it("allocates fractional edge overlaps and separates candle-direction up/down estimates", () => {
    const result = new FixedProfileCache().read([bar(0, 0, 4, 40), bar(1, .5, 3.5, 30, true)], options)!;
    expect(result.profile.rows.map(row => row.down)).toEqual([5, 10, 10, 5]); expect(total(result)).toBe(70);
    expect(result.profile).toMatchObject({ poc: 1, vaFrom: 1, vaTo: 2, maxTotal: 20 });
  });
  it("matches an independent slow overlap allocation over varied ranges and negative prices", () => {
    const bars = Array.from({ length: 100 }, (_, index) => bar(index, -50 + index / 5, -30 + index / 4, index + .5, index % 2 === 0));
    for (const rows of [1, 3, 24, 200]) {
      const result = new FixedProfileCache().read(bars, { ...options, rows })!, profile = result.profile;
      profile.rows.forEach(row => {
        let up = 0, down = 0;
        for (const b of bars) { const amount = b.volume! * Math.max(0, Math.min(row.price + profile.rowH, b.high) - Math.max(row.price, b.low)) / (b.high - b.low);
          if (b.close >= b.open) up += amount; else down += amount; }
        expect(row.up).toBeCloseTo(up, 8); expect(row.down).toBeCloseTo(down, 8);
      });
      expect(total(result)).toBeCloseTo(bars.reduce((sum, b) => sum + b.volume!, 0), 8);
    }
  });
  it("centers a sole flat-price bucket and includes each flat candle only once", () => {
    const result = new FixedProfileCache().read([bar(0, 100, 100, 5), bar(1, 100, 100, 3)], options)!;
    expect(result.profile.rows).toHaveLength(1); expect(result.profile.min + result.profile.rowH / 2).toBeCloseTo(100, 10); expect(total(result)).toBe(8);
  });
  it("keeps zero-volume ranges from changing the price grid and reports invalid bars separately", () => {
    const result = new FixedProfileCache().read([bar(0, -500, 1000, 0), bar(1, 0, 4, 40), bar(2, 0, 2, -1), { ...bar(3, 0, 2, 5), close: NaN }], options)!;
    expect(result.profile.min).toBe(0); expect(result.profile.rowH).toBe(1); expect(result.rejected).toBe(2); expect(result.bars).toBe(2); expect(total(result)).toBe(40);
  });
  it("keeps developing levels causal when a future candle expands the final profile grid", () => {
    const source = [bar(0, 0, 4, 40), bar(1, 1, 3, 20, true), bar(2, -100, 1000, 500)];
    const prefix = new FixedProfileCache().read(source.slice(0, 2), { ...options, developing: true })!;
    const full = new FixedProfileCache().read(source, { ...options, developing: true })!;
    expect(full.developingPoc.slice(0, 2)).toEqual(prefix.developingPoc);
    expect(full.developingVaHigh.slice(0, 2)).toEqual(prefix.developingVaHigh); expect(full.developingVaLow.slice(0, 2)).toEqual(prefix.developingVaLow);
  });
  it("invalidates appended/live/older revisions, preserves unchanged identities and trims a Replay prefix", () => {
    const cache = new FixedProfileCache(), source = [bar(0, 0, 4, 40), bar(1, 1, 3, 20)];
    const first = cache.read(source, { ...options, developing: true })!; expect(cache.read(source, { ...options, developing: true })).toBe(first);
    source.push(bar(2, 2, 8, 10)); const appended = cache.read(source, { ...options, developing: true })!; expect(appended.developingPoc.slice(0, 2)).toEqual(first.developingPoc);
    source[0].volume = 100; const changed = cache.read(source, { ...options, developing: true })!; expect(changed.total).toBe(130);
    const replay = cache.read(source.slice(0, 2), { ...options, developing: true })!; expect(replay.developingPoc).toHaveLength(2); expect(replay.total).toBe(120);
  });
  it("enforces bounded options, source sizes, price precision and total quantity", () => {
    const cache = new FixedProfileCache();
    for (const config of [{ ...options, rows: 501 }, { ...options, rows: 0 }, { ...options, valueAreaPct: NaN }]) expect(() => cache.read([], config)).toThrow();
    expect(() => cache.read(Array.from({ length: MAX_FIXED_BARS + 1 }, (_, i) => bar(i, 0, 4, 1)), options)).toThrow(/50,000/);
    expect(() => cache.read(Array.from({ length: MAX_DEVELOPING_BARS + 1 }, (_, i) => bar(i, 0, 4, 1)), { ...options, developing: true })).toThrow(/5,000/);
    expect(() => cache.read([bar(0, 1e16, 1e16 + 2, 1)], { ...options, rows: 500 })).toThrow(/distinguished/);
    expect(() => cache.read([bar(0, 0, 4, Number.MAX_VALUE), bar(1, 0, 4, Number.MAX_VALUE)], options)).toThrow(/precision/);
    expect(() => cache.read([bar(1, 0, 4, 1), bar(0, 0, 4, 1)], options)).toThrow(/ascending/);
  });
  it("recovers a failed setting revision without retaining partial or wrong-grid developing points", () => {
    const cache = new FixedProfileCache(), source = [bar(0, 1e16, 1e16 + 2, 1), bar(1, 1e16, 1e16 + 2, 2)];
    cache.read(source, { ...options, rows: 1, developing: true });
    expect(() => cache.read(source, { ...options, rows: 500, developing: true })).toThrow();
    const recovered = cache.read(source, { ...options, rows: 1, developing: true })!; expect(recovered.developingPoc).toHaveLength(2); expect(total(recovered)).toBe(3);
  });
  it("handles zero and full value-area requests without copying an extra adjacent row", () => {
    const source = [bar(0, 0, 4, 40)];
    const zero = new FixedProfileCache().read(source, { ...options, valueAreaPct: 0 })!.profile; expect(zero.vaFrom).toBe(zero.poc); expect(zero.vaTo).toBe(zero.poc);
    const full = new FixedProfileCache().read(source, { ...options, valueAreaPct: 100 })!.profile; expect(full.vaFrom).toBe(0); expect(full.vaTo).toBe(3);
  });
  it("preserves the actual native factory, reversed anchor geometry, hit tests and inverted projection", () => {
    const before = getDrawingType("fixedrangevp")!; registerFixedProfileConstruction(); expect(getDrawingType("fixedrangevp")!.create).toBe(before.create);
    const source = [bar(0, 0, 4, 40), bar(100, 0, 4, 10)];
    const shape = drawing({ rows: 4, anchor: "right" }, true), p = project(source), result = shape.compute(p)!;
    expect(result.total).toBe(50); expect(shape.layout(p)).toMatchObject({ x0: 0, x1: 100, grow: -1 });
    expect(shape.hitTest(95, shape.layout(p).pocY, p, 3)).toBe(true);
    expect(shape.layout(project(source, true)).pocY).toBeCloseTo(200 - shape.layout(p).pocY);
    expect(shape.frvpNotice).toMatch(/OHLCV estimate.*2 loaded bars/); expect(shape.priceRange()).toMatchObject({ min: 0, max: 4 });
  });
  it("uses canonical relative edges and developing prices through the actual native drawing layout", () => {
    const source = [bar(0, .1, .5, 40), bar(100, .3, .3, 100)], shape = drawing({ rows: 4, valueAreaPct: 100, showDevelopingPoc: true });
    const result = shape.compute(project(source))!;
    expect(result.profile.rows.map(row => row.up)).toEqual([10, 10, 110, 10]);
    expect(shape.layout(project(source)).pocY).toBeCloseTo(200 - .35);
    expect(shape.priceRange()).toEqual({ min: .1, max: .5 });
    expect(result.developingPoc.at(-1)?.price).toBe(.35);
  });
  it("round trips native settings and omits transient cache/notice data from persistence", () => {
    const shape = drawing({ rows: 8, showDevelopingPoc: true, vaUpColor: "#123456" }); shape.compute(project([bar(0, 0, 8, 80)]));
    const doc = shape.serialize(), restored = deserializeDrawing(JSON.parse(JSON.stringify(doc)))! as Surface;
    expect(doc.props).toMatchObject({ rows: 8, showDevelopingPoc: true, vaUpColor: "#123456" }); expect(JSON.stringify(doc)).not.toContain("frvpNotice");
    expect(restored.compute(project([bar(0, 0, 8, 80)]))!.total).toBe(80); expect(restored.schema().fields.some(field => field.path === "frvp.rows")).toBe(true);
  });
  it("fails closed inside native painting and recovers through ordinary settings edits", () => {
    const shape = drawing({ rows: 501 }); expect(shape.compute(project([bar(0, 0, 4, 40)]))).toBeNull(); expect(shape.frvpNotice).toMatch(/unavailable/);
    shape.applyProps({ rows: 4 }); expect(shape.compute(project([bar(0, 0, 4, 40)]))!.total).toBe(40); expect(shape.frvpNotice).not.toMatch(/unavailable/);
    expect(shape.compute(project([]))).toBeNull(); expect(shape.frvpNotice).toMatch(/No loaded volume/);
  });
  it("installs source/error notices in every pinned native painter bundle", () => {
    const require = createRequire(import.meta.url), dist = path.dirname(require.resolve("@luxalgo/vela"));
    const targets = readdirSync(dist).filter(name => /\.(?:js|cjs)$/.test(name) && !name.endsWith(".min.js"))
      .map(name => readFileSync(path.join(dist, name), "utf8")).filter(source => source.includes("paintFixedRangeVp(ctx, d, proj, theme)"));
    expect(targets).toHaveLength(5); for (const source of targets) expect(source.split("/* Affentrader fixed profile notice v1 */")).toHaveLength(2);
  });
});
