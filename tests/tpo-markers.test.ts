import { describe, expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { buildTpoSessions, createTpoCache } from "@/lib/orderflow/tpoModel";
import { defaultTpo, resolveTpo, tpoSettings, validTpo, type TpoPreferences } from "@/lib/orderflow/tpoSettings";
import { tpoMidpoint, tpoMarkers } from "@/lib/orderflow/tpoMarkers";
import { paintTpoMarkers, layoutTpoPriceLabels } from "@/lib/orderflow/tpoMarkerRenderer";
import { scopedTpoOperations } from "@/lib/orderflow/tpoOperations";
import { publishTpoSurface, readTpoSurface, clearTpoSurface } from "@/lib/orderflow/tpoReadout";
const m = 60000, day = 86400000;
const bar = (time: number, open = 100, close = 102, low = 99, high = 105) => ({ time, open, close, low, high, volume: 1 });
const bars = [bar(0), bar(30 * m, 102, 104), bar(day, 107, 108, 106, 110)];
const style = { ...defaultTpo(), rowSize: 1 };
const on = { ...style, openMarkerVisible: true, closeMarkerVisible: true, midpointVisible: true, pocLabelVisible: true, vahLabelVisible: true, valLabelVisible: true };
function paint(prefs: TpoPreferences = on, invert = false, sessions = buildTpoSessions(bars, prefs, "30m")) {
  const paths: number[][] = [], fills: Array<{ color: string; path: number[][] }> = [], labels: string[] = [], strokes: number[][][] = [];
  const target = { fillStyle: "", save() {}, restore() {}, setLineDash() {}, beginPath() { paths.length = 0; }, moveTo: (...p: number[]) => paths.push(p), lineTo: (...p: number[]) => paths.push(p),
    fill() { fills.push({ color: target.fillStyle, path: paths.map(p => [...p]) }); }, stroke() { strokes.push(paths.map(p => [...p])); }, fillRect() {}, fillText(text: string) { labels.push(text); } };
  const args = { bounds: { top: 0, height: 300 }, scale: {}, theme: { textColor: "#111", background: "#fff" },
    coords: { width: 1000, timeToX: (time: number) => 20 + time / m, priceToY: (price: number) => invert ? (price - 95) * 10 : (115 - price) * 10 } } as unknown as RendererLayerArgs;
  paintTpoMarkers(target as unknown as CanvasRenderingContext2D, args, sessions[0], prefs, 24, 900);
  return { fills, labels, strokes };
}
describe("TPO session price markers and labels", () => {
  it("uses exact decimal midpoints without overflowing, cancellation or subnormal loss", () => {
    expect(tpoMidpoint(.2, .3)).toBe(.25); expect(tpoMidpoint(-.3, .2)).toBe(-.05);
    expect(tpoMidpoint(Number.MAX_VALUE, Number.MAX_VALUE)).toBe(Number.MAX_VALUE);
    expect(tpoMidpoint(-Number.MAX_VALUE, Number.MAX_VALUE)).toBe(0);
    expect(tpoMidpoint(Number.MIN_VALUE, Number.MIN_VALUE)).toBe(Number.MIN_VALUE);
    for (const [low, high] of [[2, 1], [NaN, 1], [0, Infinity]]) expect(() => tpoMidpoint(low, high)).toThrow();
  });
  it("uses opening/last revealed closes and actual extremes rather than price-grid bounds", () => {
    const sessions = buildTpoSessions(bars, style, "30m");
    expect(sessions[0].markers).toEqual({ open: { price: 100, time: 0, status: "observed" }, close: { price: 104, time: 30 * m, status: "observed" }, low: 99, high: 105, midpoint: 102 });
    expect(buildTpoSessions(bars.slice(0, 1), style, "30m")[0].markers?.close.price).toBe(102);
  });
  it("withholds unknown session openings and invalid optional OHLC without damaging the TPO rows", () => {
    expect(buildTpoSessions(bars.slice(1), style, "30m")[0].markers?.open.status).toBe("missing");
    const invalid = buildTpoSessions([{ ...bars[0], open: 999, close: NaN }], style, "30m")[0];
    expect(invalid.rows.length).toBeGreaterThan(0); expect(invalid.markers?.open.status).toBe("invalid"); expect(invalid.markers?.close.price).toBeNull();
    expect(tpoMarkers([{ time: 0, low: 99, high: 105 }], 0, 99, 105).close.status).toBe("missing");
  });
  it("recomputes composite opening, last close and midpoint from member observations", () => {
    const ops = scopedTpoOperations(style, "30m", "BTCUSDT"); ops.links = [[0, day]];
    const composite = buildTpoSessions(bars, { ...style, sessionOperations: ops }, "30m", "BTCUSDT")[0];
    expect(composite.markers).toMatchObject({ open: { price: 100 }, close: { price: 108, time: day }, low: 99, high: 110, midpoint: 104.5 });
    expect(buildTpoSessions(bars.slice(0, 2), { ...style, sessionOperations: ops }, "30m", "BTCUSDT")[0].markers?.midpoint).toBe(102);
  });
  it("invalidates isolated opening/close corrections while reusing display edits", () => {
    const source = bars.map(b => ({ ...b })), cache = createTpoCache(), first = cache.read(source, style, "30m", "BTCUSDT");
    expect(cache.read(source, on, "30m", "BTCUSDT")).toBe(first);
    source[0].open = 101; const changed = cache.read(source, style, "30m", "BTCUSDT"); expect(changed).not.toBe(first); expect(changed[0].markers?.open.price).toBe(101);
    expect(changed[0].rows).toBe(first[0].rows); expect(changed[0].valueArea).toBe(first[0].valueArea); expect(changed[0].initialBalance).toBe(first[0].initialBalance);
    source[1].close = 103; expect(cache.read(source, style, "30m", "BTCUSDT")[0].markers?.close.price).toBe(103);
  });
  it("validates and resolves optional legacy settings and exposes native controls", () => {
    const legacy = Object.fromEntries(Object.entries(style).filter(([key]) => !/Marker|midpoint|LabelVisible/.test(key)));
    expect(validTpo(legacy)).toBe(true); expect(resolveTpo(legacy)).toEqual(style);
    for (const patch of [{ openMarkerVisible: 1 }, { midpointColor: "bad" }, { pocLabelVisible: "true" }]) expect(validTpo({ ...style, ...patch })).toBe(false);
    const keys = (tpoSettings().rows ?? []).flatMap(r => "key" in r ? [r.key] : []);
    for (const key of ["openMarkerVisible", "closeMarkerVisible", "midpointVisible", "pocLabelVisible", "vahLabelVisible", "valLabelVisible"]) expect(keys).toContain(key);
    expect(resolveTpo(JSON.parse(JSON.stringify(on)))).toEqual(on);
  });
  it("paints arrows at actual candle times and prices on regular and inverted scales", () => {
    for (const invert of [false, true]) {
      const result = paint(on, invert);
      expect(result.fills).toHaveLength(2);
      expect(result.fills[0]).toMatchObject({ color: on.openMarkerColor, path: [[20, invert ? 50 : 150], [14, invert ? 46 : 146], [14, invert ? 54 : 154]] });
      expect(result.fills[1].path[0]).toEqual([50, invert ? 90 : 110]);
      expect(result.labels).toHaveLength(3); expect(result.labels.some(s => s.startsWith("POC "))).toBe(true);
      expect(result.strokes.some(path => path[0][1] === (invert ? 70 : 130) && path[0][0] === 24)).toBe(true);
    }
  });
  it("respects independent controls and skips unavailable opening arrows", () => {
    const off = paint(style); expect(off.fills).toEqual([]); expect(off.labels).toEqual([]); expect(off.strokes).toEqual([]);
    const close = paint({ ...style, closeMarkerVisible: true }); expect(close.fills).toHaveLength(1); expect(close.labels).toEqual([]);
    const partial = buildTpoSessions(bars.slice(1), on, "30m"); expect(paint(on, false, partial).fills).toHaveLength(1);
  });
  it("separates coincident labels within the pane and retains their exact price anchor", () => {
    const labels = layoutTpoPriceLabels([{ text: "POC 1", y: 1 }, { text: "VAH 1", y: 1 }, { text: "VAL 1", y: 1 }], 0, 100);
    expect(labels.map(l => l.y)).toEqual([1, 1, 1]); expect(labels.map(l => l.textY)).toEqual([7, 20, 33]);
    const bottom = layoutTpoPriceLabels([{ text: "a", y: 99 }, { text: "b", y: 99 }], 0, 100);
    expect(bottom.map(l => l.textY)).toEqual([80, 93]);
    expect(layoutTpoPriceLabels([{ text: "outside", y: 101 }], 0, 100)).toEqual([]);
  });
  it("labels the last close as observed rather than final when coverage is incomplete", () => {
    const sessions = buildTpoSessions(bars, on, "30m"), token = Symbol(), context = { symbol: "BTCUSDT", timeframe: "30m", epoch: 1, replay: true,
      seriesRange: { first: 0, last: day, count: 3, high: 110, low: 106 }, style: on };
    publishTpoSurface("markers-test", token, { ...context, sessions });
    try {
      const rows = readTpoSurface("markers-test", context, 0).rows;
      expect(rows).toContainEqual({ label: "Session open price", value: "100" });
      expect(rows).toContainEqual({ label: "Close marker status", value: "last observed; final close unproven" });
      expect(rows).toContainEqual({ label: "Observed range midpoint", value: "102" });
    } finally { clearTpoSurface("markers-test", token); }
  });
  it("withholds a stale marker snapshot while a close-only native correction is awaiting paint", () => {
    const token = Symbol(), context = { symbol: "BTCUSDT", timeframe: "30m", epoch: 1, replay: false, style,
      seriesRange: { first: 0, last: day, count: 3, high: 110, low: 106, open: 107, close: 108 } };
    publishTpoSurface("marker-stale", token, { ...context, sessions: buildTpoSessions(bars, style, "30m") });
    try {
      expect(readTpoSurface("marker-stale", context, day).status).toBe("ready");
      expect(readTpoSurface("marker-stale", { ...context, seriesRange: { ...context.seriesRange, close: 109 } }, day).status).toBe("waiting");
      expect(readTpoSurface("marker-stale", { ...context, seriesRange: { ...context.seriesRange, open: 106 } }, day).status).toBe("waiting");
    } finally { clearTpoSurface("marker-stale", token); }
  });
});
