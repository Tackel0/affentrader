import { describe, expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { defaultTpo, resolveTpo, validTpo, tpoSettings } from "@/lib/orderflow/tpoSettings";
import { buildTpoSessions, createTpoCache, tpoCalendar } from "@/lib/orderflow/tpoModel";
import { scopedTpoOperations } from "@/lib/orderflow/tpoOperations";
import { tpoCellAtPoint, paintTpoHover, tpoHoverLines } from "@/lib/orderflow/tpoHover";
import { tpoSessionHit } from "@/lib/orderflow/tpoSessionMenu";
const m = 60000, day = 86400000;
const bar = (time: number) => ({ time, low: 100, high: 100, open: 100, close: 100, volume: 1 });
const bars = [bar(0), bar(60 * m)], style = { ...defaultTpo(), rowSize: 1 };
const args = { bars, priceStyle: "tpo", bounds: { top: 0, height: 300 }, scale: {}, theme: { textColor: "#111", background: "#fff" },
  coords: { width: 2000, timeToX: (time: number) => 20 + time / m * 2, pxPerBar: () => 10, priceToY: (price: number) => (110 - price) * 20 } } as unknown as RendererLayerArgs;
describe("TPO block hover", () => {
  it("identifies original block time in a packed row instead of the underlying candle time", () => {
    const sessions = buildTpoSessions(bars, style, "5m"), hit = tpoCellAtPoint(args, sessions, style, 33, 190)!;
    expect(hit).toMatchObject({ letter: "C", period: 2, lower: 100, upper: 101, start: 60 * m, end: 90 * m, rowIndex: 0 });
    expect(tpoHoverLines(hit)).toContain("Price [100, 101)");
    expect(tpoHoverLines(hit)).toContain("Until 1970-01-01 01:30:00 UTC (exclusive)");
  });
  it("uses real chart-time columns and honors a per-session override", () => {
    const sessions = buildTpoSessions(bars, style, "5m");
    expect(tpoCellAtPoint(args, [{ ...sessions[0], expanded: true }], style, 140, 190)?.letter).toBe("C");
    expect(tpoCellAtPoint(args, [{ ...sessions[0], expanded: false }], { ...style, splitPeriods: true }, 33, 190)?.letter).toBe("C");
  });
  it("excludes horizontal and vertical paint gutters, hidden cells and off-plot coordinates", () => {
    const sessions = buildTpoSessions(bars, style, "5m");
    expect(tpoCellAtPoint(args, sessions, style, 31.5, 190)).toBeNull();
    expect(tpoCellAtPoint(args, sessions, style, 25, 199.7)).toBeNull();
    expect(tpoCellAtPoint(args, sessions, { ...style, histogramVisible: false, lettersVisible: false }, 25, 190)).toBeNull();
    for (const [x, y] of [[-1, 190], [25, 301], [NaN, 190]]) expect(tpoCellAtPoint(args, sessions, style, x, y)).toBeNull();
  });
  it("supports visible letters-only cells and refuses letters that are too small to paint", () => {
    const sessions = buildTpoSessions(bars, style, "5m"), prefs = { ...style, histogramVisible: false };
    expect(tpoCellAtPoint(args, sessions, prefs, 25, 190)?.letter).toBe("A");
    const narrow = { ...args, coords: { ...args.coords, timeToX: (time: number) => 20 + time / day * 10 } } as unknown as RendererLayerArgs;
    expect(tpoCellAtPoint(narrow, sessions, prefs, 24, 190)).toBeNull();
    const flat = { ...args, coords: { ...args.coords, priceToY: (price: number) => (110 - price) * .1 } } as unknown as RendererLayerArgs;
    expect(tpoCellAtPoint(flat, sessions, prefs, 25, .95)).toBeNull();
  });
  it("matches inverted axes and the topmost paint order, including invalid projection guards", () => {
    const session = buildTpoSessions(bars, style, "5m")[0], inverted = { ...args, coords: { ...args.coords, priceToY: (price: number) => (price - 95) * 20 } } as unknown as RendererLayerArgs;
    expect(tpoCellAtPoint(inverted, [session, session], style, 25, 110)?.sessionIndex).toBe(1);
    const invalid = { ...args, coords: { ...args.coords, priceToY: () => NaN } } as unknown as RendererLayerArgs;
    expect(tpoCellAtPoint(invalid, [session], style, 25, 190)).toBeNull();
  });
  it("keeps original overnight composite block windows and clamps a short final block", () => {
    const prefs = { ...style, sessionMinutes: 45 }, source = [bar(30 * m), bar(day), bar(day + 30 * m)];
    const ops = scopedTpoOperations(prefs, "5m", "BTCUSDT"); ops.links = [[0, day]];
    const sessions = buildTpoSessions(source, { ...prefs, sessionOperations: ops }, "5m", "BTCUSDT");
    const hit = tpoCellAtPoint(args, sessions, prefs, 41, 190)!;
    expect(hit).toMatchObject({ letter: "D", start: day + 30 * m, end: day + 45 * m });
  });
  it("distinguishes repeated local hours using exact UTC windows", () => {
    const prefs = { ...style, sessionZone: "America/New_York", blockMinutes: "60" as const }, start = tpoCalendar(prefs).forDate("2026-11-01").start;
    const source = [bar(Date.parse("2026-11-01T05:00:00Z")), bar(Date.parse("2026-11-01T06:00:00Z"))];
    const view = { ...args, coords: { ...args.coords, timeToX: (time: number) => 20 + (time - start) / m * 2 } } as unknown as RendererLayerArgs;
    const sessions = buildTpoSessions(source, prefs, "5m");
    expect(tpoCellAtPoint(view, sessions, prefs, 25, 190)).toMatchObject({ letter: "B", start: source[0].time, end: source[1].time });
    expect(tpoCellAtPoint(view, sessions, prefs, 33, 190)).toMatchObject({ letter: "C", start: source[1].time, end: source[1].time + 60 * m });
  });
  it("never hits an unrevealed Replay opportunity and shares context-menu selection", () => {
    const sessions = buildTpoSessions(bars.slice(0, 1), style, "5m");
    expect(tpoCellAtPoint(args, sessions, style, 33, 190)).toBeNull();
    expect(tpoSessionHit({ args, sessions, style, symbol: "BTCUSDT", timeframe: "5m" }, 25, 190)).toBe(0);
    expect(tpoSessionHit({ args, sessions, style, symbol: "BTCUSDT", timeframe: "5m" }, 31.5, 190)).toBe(-1);
  });
  it("validates and persists the native toggle without invalidating profile math", () => {
    const { tooltipVisible: _, ...legacy } = style;
    expect(validTpo(legacy)).toBe(true); expect(resolveTpo(legacy).tooltipVisible).toBe(true);
    expect(validTpo({ ...style, tooltipVisible: "true" })).toBe(false);
    expect(resolveTpo(JSON.parse(JSON.stringify({ ...style, tooltipVisible: false }))).tooltipVisible).toBe(false);
    expect((tpoSettings().rows ?? []).some(row => "key" in row && row.key === "tooltipVisible")).toBe(true);
    const cache = createTpoCache(), first = cache.read(bars, style, "5m", "BTCUSDT");
    expect(cache.read(bars, { ...style, tooltipVisible: false }, "5m", "BTCUSDT")).toBe(first);
  });
  it("keeps tooltip bounds inside a narrow pane and respects cursor/type/toggle gating", () => {
    const boxes: number[][] = [], texts: string[] = [], ctx = { save() {}, restore() {}, measureText: (text: string) => ({ width: text.length * 6 }),
      fillRect: (...v: number[]) => boxes.push(v), strokeRect() {}, fillText: (s: string) => texts.push(s) } as unknown as CanvasRenderingContext2D;
    const view = { ...args, bounds: { top: 0, height: 200 }, coords: { ...args.coords, width: 80 }, cursor: { x: 33, y: 190 } } as unknown as RendererLayerArgs, sessions = buildTpoSessions(bars, style, "5m");
    expect(paintTpoHover(ctx, view, sessions, style)?.letter).toBe("C");
    expect(boxes[0][0]).toBeGreaterThanOrEqual(4); expect(boxes[0][0] + boxes[0][2]).toBeLessThanOrEqual(76);
    expect(boxes[0][1] + boxes[0][3]).toBeLessThanOrEqual(196); expect(texts[0]).toBe("TPO C");
    expect(paintTpoHover(ctx, { ...view, cursor: null }, sessions, style)).toBeNull();
    expect(paintTpoHover(ctx, view, sessions, { ...style, tooltipVisible: false })).toBeNull();
    expect(paintTpoHover(ctx, { ...view, priceStyle: "candles" }, sessions, style)).toBeNull();
  });
});
