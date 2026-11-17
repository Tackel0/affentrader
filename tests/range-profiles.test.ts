import { describe, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, RendererLayerArgs, OHLCV } from "@luxalgo/vela";
import { rangePriceGrid } from "@/lib/orderflow/rangePriceGrid";
import { FixedProfileCache } from "@/lib/orderflow/fixedProfileModel";
import { defaultVisibleProfile, VisibleProfileCache, visibleProfileDescriptor, visibleProfileSettings } from "@/lib/orderflow/visibleProfile";
import { paintVisibleProfile } from "@/lib/orderflow/visibleProfileRenderer";
import { INDICATORS } from "@/lib/indicators/catalog";
import { studyArguments } from "@/lib/chart/statusLine";
const bar = (time: number, low: number, high: number, volume = 1): OHLCV => ({ time, low, high, open: low, close: high, volume });
const source = [bar(0, .1, .5, 40), bar(60000, .3, .3, 100)];
describe("fixed and visible OHLCV range profiles", () => {
  it("separates exact decimal boundaries from strictly preceding prices", () => {
    const grid = rangePriceGrid(.1, .5, 4);
    expect(grid.edges).toEqual([.1, .2, .3, .4, .5]); expect(grid.centers).toEqual([.15, .25, .35, .45]);
    expect(grid.allocation(.3, .3).first).toBe(2); expect(grid.allocation(.29999999999999993, .29999999999999993).first).toBe(1);
    expect(grid.allocation(.5, .5).first).toBe(3);
  });
  it("uses rational thirds rather than assigning from rounded projection coordinates", () => {
    const grid = rangePriceGrid(0, 1, 3);
    expect(grid.allocation(.3333333333333333, .3333333333333333).first).toBe(0);
    expect(grid.allocation(.33333333333333337, .33333333333333337).first).toBe(1);
    expect(grid.allocation(0, 1)).toEqual({ first: 0, last: 2, firstFraction: 1 / 3, fullFraction: 1 / 3 });
  });
  it("excludes zero-measure range touches and preserves point candles", () => {
    const grid = rangePriceGrid(.1, .5, 4);
    expect(grid.allocation(.2, .4)).toEqual({ first: 1, last: 2, firstFraction: .5, fullFraction: .5 });
    expect(grid.allocation(.4, .4)).toMatchObject({ first: 3, last: 3, firstFraction: 1 });
  });
  it("avoids high-price subtractive cancellation in overlap fractions", () => {
    const grid = rangePriceGrid(100000000, 100000000.0000002, 4);
    expect(grid.allocation(100000000, 100000000.0000001)).toEqual({ first: 0, last: 1, firstFraction: .5, fullFraction: .5 });
    for (let i = 1; i < grid.edges.length; i++) expect(grid.edges[i]).toBeGreaterThan(grid.edges[i - 1]);
  });
  it("conserves volume and locates the dominant boundary POC and developing levels", () => {
    const result = new FixedProfileCache().read(source, { rows: 4, valueAreaPct: 100, developing: true })!;
    expect(result.profile.rows.map(row => row.up)).toEqual([10, 10, 110, 10]); expect(result.total).toBe(140);
    expect(result.profile.poc).toBe(2); expect(result.developingPoc.at(-1)?.price).toBe(.35);
    expect(result.developingVaHigh.at(-1)?.price).toBe(.5);
  });
  it("centers flat tiny-price candles and rejects collapsed projection rows", () => {
    const result = new FixedProfileCache().read([bar(0, 3e-12, 3e-12, 5)], { rows: 40, valueAreaPct: 70, developing: true })!;
    expect(result.profile.edges[0]).toBeGreaterThan(0); expect(result.profile.centers[0]).toBe(3e-12); expect(result.total).toBe(5);
    for (const count of [0, 501, NaN]) expect(() => rangePriceGrid(0, 1, count)).toThrow();
    expect(() => rangePriceGrid(1e16, 1e16 + 2, 400)).toThrow(/distinguished/);
    expect(() => new FixedProfileCache().read([bar(0, -Number.MAX_VALUE, Number.MAX_VALUE)], { rows: 4, valueAreaPct: 70, developing: false })).toThrow(/distinguished/);
  });
  it("recalculates interior repairs and Replay prefixes with unchanged tail signatures", () => {
    const bars = [bar(0, 0, 4, 1), bar(1, 0, 4, 2), bar(2, 0, 4, 3), bar(3, 0, 4, 4)];
    const cache = new VisibleProfileCache(), style = { ...defaultVisibleProfile(), rows: 4 };
    expect(cache.read(bars, 1.2, 2.2, style)?.total).toBe(9); bars[1].volume = 20;
    expect(cache.read(bars, 1.2, 2.2, style)?.total).toBe(27);
    expect(cache.read(bars.slice(0, 2), 0, 10, style)?.total).toBe(21);
    expect(cache.read(bars, 10, 20, style)).toBeNull(); expect(() => cache.read(bars, NaN, 3, style)).toThrow();
  });
  it("validates legacy controls and directs saved catalog entries to the corrected native", () => {
    expect(visibleProfileSettings({ showPoc: false, valueAreaPct: 0 })).toMatchObject({ showPoc: false, valueAreaPct: 0 });
    for (const values of [{ rows: 1 }, { rows: 401 }, { rows: 2.5 }, { widthPct: 91 }, { valueAreaPct: NaN }]) expect(() => visibleProfileSettings(values)).toThrow();
    expect(INDICATORS.find(item => item.id === "vpvr")?.nativeId).toBe("af-visible-profile");
    expect(studyArguments({ rows: 24, widthPct: 20, showPoc: false, upColor: "#ff0000" }, "vpvr")).toBe("24 rows 70%");
  });
  it("retains native schema and suppresses payloads while suspended or stopped", () => {
    const descriptor = visibleProfileDescriptor(), native = descriptor.create(), pushData = vi.fn();
    const context = { id: "native-vrvp", pushData, emit: vi.fn() } as unknown as NativeIndicatorContext;
    expect(descriptor.inputsSchema().map(row => row.key)).toEqual(["rows", "widthPct", "upColor", "downColor", "showPoc", "valueAreaPct", "volumeSource"]);
    native.setInputs({ rows: 4 }); expect(pushData).not.toHaveBeenCalled();
    native.start(context, { rows: 8 }); expect(pushData).toHaveBeenLastCalledWith({ rows: 8, __afProfileId: "native-vrvp" });
    native.suspend(); expect(pushData).toHaveBeenLastCalledWith(null); native.setInputs({ rows: 12 }); expect(pushData).toHaveBeenCalledTimes(2);
    native.resume(); expect(pushData).toHaveBeenLastCalledWith({ rows: 12, __afProfileId: "native-vrvp" }); native.stop(); native.setInputs({ rows: 16 }); expect(pushData).toHaveBeenLastCalledWith(null);
  });
  it("paints inverted blocks with positive heights, source notice and scoped failures", () => {
    for (const inverted of [false, true]) {
      const rects: number[][] = [], text: string[] = [], outlines: number[][] = [];
      const ctx = { fillRect: (...v: number[]) => rects.push(v), strokeRect: (...v: number[]) => outlines.push(v),
        fillText: (s: string) => text.push(s), measureText: (s: string) => ({ width: s.length * 5 }) } as unknown as CanvasRenderingContext2D;
      const view = { data: { rows: 4 }, bars: source, coords: { width: 500, visibleLogicalRange: () => ({ from: 0, to: 1 }), priceToY: (p: number) => inverted ? p * 300 : 300 - p * 300 },
        bounds: { top: 0, height: 300 }, scale: {}, theme: { background: "#000000", textColor: "#ffffff" } } as unknown as RendererLayerArgs;
      paintVisibleProfile(ctx, view, new VisibleProfileCache());
      expect(rects.every(r => r[2] > 0 && r[3] > 0)).toBe(true); expect(outlines).toHaveLength(1); expect(text).toContain("VRVP · OHLCV estimate");
      expect(text.some(s => s.includes("2 visible bars") && s.includes("140"))).toBe(true);
      rects.length = 0; text.length = 0; outlines.length = 0; view.data = { rows: 401 };
      paintVisibleProfile(ctx, view, new VisibleProfileCache()); expect(outlines).toEqual([]); expect(rects).toHaveLength(1); expect(text.some(s => s.includes("Unavailable"))).toBe(true);
    }
  });
});
