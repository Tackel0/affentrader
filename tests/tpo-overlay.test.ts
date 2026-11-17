import { describe, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, RendererLayerArgs } from "@luxalgo/vela";
import { tpoOverlayDescriptor, tpoOverlayInputs, resolveTpoOverlay, tpoOverlayInputVisible, paintTpoOverlay, type TpoOverlayChannel } from "@/lib/orderflow/tpoOverlay";
import { defaultTpo, tpoSettings } from "@/lib/orderflow/tpoSettings";
import { buildTpoSessions, createTpoCache } from "@/lib/orderflow/tpoModel";
import { paintTpoSessions } from "@/lib/orderflow/tpoRenderer";
import { tpoCellAtPoint } from "@/lib/orderflow/tpoHover";
import { clearTpoSurface, publishTpoSurface, readTpoOverlaySurfaces } from "@/lib/orderflow/tpoReadout";
import { INDICATORS } from "@/lib/indicators/catalog";
const m = 60000;
const bars = Array.from({ length: 13 }, (_, i) => ({ time: i * 5 * m, low: 100, high: 102, open: 100, close: 101, volume: 1 }));
describe("Time Price Opportunity overlay", () => {
  it("derives all editable chart-type options except duplicate base candles, with primitive defaults", () => {
    const inputs = tpoOverlayInputs(), keys = inputs.map(i => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const row of tpoSettings().rows ?? []) if ("key" in row && row.key !== "candlesVisible") expect(keys).toContain(row.key);
    expect(keys).not.toContain("candlesVisible"); expect(keys).not.toContain("sessionOperations");
    for (const input of inputs) expect(["string", "number", "boolean"]).toContain(typeof input.defval);
    const defaults = tpoOverlayDescriptor().defaultInputs!(); expect(defaults.ibMinutes).toBe(60); expect(defaults.tooltipVisible).toBe(true);
  });
  it("preserves math and display settings while excluding contextual operations and duplicate candles", () => {
    const input = { ...defaultTpo(), blockMinutes: "240", sessionPeriod: "Week", ibMinutes: 90, openMarkerVisible: true, candlesVisible: true,
      sessionOperations: { scope: "untrusted", links: [[0, 1]], expanded: [[0, true]] } };
    const style = resolveTpoOverlay(input);
    expect(style).toMatchObject({ blockMinutes: "240", sessionPeriod: "Week", ibMinutes: 90, openMarkerVisible: true, candlesVisible: false });
    expect(style.sessionOperations).toEqual({ scope: "", links: [], expanded: [] });
    expect(input.candlesVisible).toBe(true);
  });
  it("hides Day-only controls on UTC calendar periods", () => {
    for (const key of ["sessionZone", "sessionStartMinutes", "sessionMinutes", "weekdaysOnly"]) {
      expect(tpoOverlayInputVisible(key, {})).toBe(true); expect(tpoOverlayInputVisible(key, { sessionPeriod: "Week" })).toBe(false);
      expect(tpoOverlayInputVisible(key, { sessionPeriod: "Month" })).toBe(false);
    }
    expect(tpoOverlayInputVisible("blockMinutes", { sessionPeriod: "Month" })).toBe(true);
  });
  it("maintains isolated payloads and clears a hidden/stopped instance", () => {
    const descriptor = tpoOverlayDescriptor(), a = descriptor.create(), b = descriptor.create(), pushA = vi.fn(), pushB = vi.fn();
    const context = (id: string, pushData: typeof pushA) => ({ id, symbol: "AAPL", timeframe: "5m", live: true, emit: vi.fn(), pushData }) as unknown as NativeIndicatorContext;
    a.start(context("a", pushA), { blockMinutes: "30" }); b.start(context("b", pushB), { blockMinutes: "60" });
    expect(pushA.mock.calls.at(-1)![0]).toMatchObject({ id: "a", symbol: "AAPL", values: { blockMinutes: "30" } });
    expect(pushB.mock.calls.at(-1)![0]).toMatchObject({ id: "b", values: { blockMinutes: "60" } });
    a.suspend?.(); expect(pushA.mock.calls.at(-1)![0]).toBeNull(); a.setInputs?.({ blockMinutes: "240" }); expect(pushA.mock.calls.at(-1)![0]).toBeNull();
    a.resume?.(); expect((pushA.mock.calls.at(-1)![0] as TpoOverlayChannel).values.blockMinutes).toBe("240");
    a.stop(); b.stop(); expect(pushB.mock.calls.at(-1)![0]).toBeNull();
  });
  it("uses the same profile math, exclusive Replay prefix and historical repair behavior", () => {
    const overlay = resolveTpoOverlay({ rowSize: 1 }), chart = { ...defaultTpo(), rowSize: 1, candlesVisible: false };
    expect(buildTpoSessions(bars, overlay, "5m")).toEqual(buildTpoSessions(bars, chart, "5m"));
    const cache = createTpoCache(), source = bars.map(b => ({ ...b })), first = cache.read(source, overlay, "5m", "AAPL");
    source[0].high = 110; expect(cache.read(source, overlay, "5m", "AAPL")[0].rows.at(-1)!.price).toBe(110);
    expect(first[0].rows.at(-1)!.price).toBe(102);
    expect(buildTpoSessions(bars.slice(0, 1), overlay, "5m")[0].rows[0].periods).toEqual(["A"]);
    expect(() => buildTpoSessions(bars, overlay, "1h")).toThrow(/divide/);
  });
  it("produces identical painted profiles and hover identities without repainting base candles", () => {
    const style = resolveTpoOverlay({ rowSize: 1, ibVisible: false, boundariesVisible: false, pocVisible: false, valueAreaVisible: false });
    const sessions = buildTpoSessions(bars, style, "5m"), capture = () => {
      const boxes: number[][] = [], ctx = { save() {}, restore() {}, beginPath() {}, rect: (...p: number[]) => boxes.push(p), fill() {}, fillText() {} } as unknown as CanvasRenderingContext2D;
      return { boxes, ctx };
    };
    const args = { bars, priceStyle: "tpo", bounds: { top: 0, height: 400 }, scale: {}, theme: { textColor: "#111" }, coords: {
      width: 1000, timeToX: (t: number) => 20 + t / m, pxPerBar: () => 5, priceToY: (p: number) => (110 - p) * 20 } } as unknown as RendererLayerArgs;
    const chart = capture(), overlay = capture(); paintTpoSessions(chart.ctx, args, sessions, style); paintTpoOverlay(overlay.ctx, { ...args, priceStyle: "candles" }, sessions, style);
    expect(overlay.boxes).toEqual(chart.boxes); expect(overlay.boxes.length).toBeGreaterThan(0);
    expect(tpoCellAtPoint(args, sessions, style, 25, 150)?.letter).toBe("A");
  });
  it("fences readouts by visible instance, source and layer token", () => {
    const style = resolveTpoOverlay({ rowSize: 1 }), token = Symbol(), other = Symbol(), context = { symbol: "AAPL", timeframe: "5m", epoch: 1, replay: true,
      seriesRange: { first: 0, last: 60 * m, count: 13, high: 102, low: 100 } };
    const sessions = buildTpoSessions(bars, style, "5m");
    publishTpoSurface("overlay-test:a", token, { ...context, sessions, style });
    publishTpoSurface("overlay-test:b", other, { ...context, sessions, style });
    try {
      expect(readTpoOverlaySurfaces("overlay-test", context, 0, ["a", "b"])).toHaveLength(2);
      expect(readTpoOverlaySurfaces("overlay-test", context, 0, [])).toEqual([]);
      expect(readTpoOverlaySurfaces("other-cell", context, 0, ["a"])).toEqual([]);
      expect(readTpoOverlaySurfaces("overlay-test", { ...context, symbol: "MSFT" }, 0, ["a"])[0].rows).toEqual([]);
      publishTpoSurface("overlay-test:a", other, { ...context, sessions, style }); clearTpoSurface("overlay-test:a", token);
      expect(readTpoOverlaySurfaces("overlay-test", context, 0, ["a"])[0].status).toBe("ready");
    } finally { clearTpoSurface("overlay-test:a", other); clearTpoSurface("overlay-test:b", other); }
  });
  it("offers the OHLC-only overlay separately from the TPO chart type", () => {
    expect(INDICATORS.find(i => i.id === "tpo-overlay")).toMatchObject({ name: "Time Price Opportunity", nativeId: "af-tpo-overlay", kind: "orderflow" });
    expect(INDICATORS.find(i => i.id === "tpo")?.nativeId).toBeUndefined();
    expect(tpoOverlayDescriptor()).toMatchObject({ overlay: true, multiInstance: true, paneHint: "price" });
  });
});
