import { describe, expect, it } from "vitest";
import type { OHLCV, RendererLayerArgs } from "@luxalgo/vela";
import { TpoVolumeLadderCache, paintTpoVolumeLadder, tpoLadderPlacement } from "@/lib/orderflow/tpoVolumeLadder";
import { buildTpoSessions, createTpoCache } from "@/lib/orderflow/tpoModel";
import { defaultTpo, resolveTpo, validTpo } from "@/lib/orderflow/tpoSettings";
import { tpoOverlayInputs } from "@/lib/orderflow/tpoOverlay";
import { scopedTpoOperations } from "@/lib/orderflow/tpoOperations";
import { clearTpoSurface, publishTpoSurface, readTpoSurface } from "@/lib/orderflow/tpoReadout";
import { tpoPriceText } from "@/lib/orderflow/tpoMarkerRenderer";
const m = 60000, day = 86400000;
const bar = (time: number, volume: number | undefined = 4): OHLCV => ({ time, open: 100, close: 102, low: 100, high: 102, volume });
const source = [bar(0, 4), bar(5 * m, 8)], style = { ...defaultTpo(), rowSize: 1, ladderVisible: true, ladderRows: 2 };
const sessions = buildTpoSessions(source, style, "5m");
describe("TPO candle-volume ladder", () => {
  it("keeps canvas price labels compact while retaining tiny nonzero prices", () => {
    expect(tpoPriceText(350.3974914550781)).toBe("350.39749");
    expect(Number(tpoPriceText(0.000000003456789123))).toBeGreaterThan(0);
  });
  it("conserves candle volume without copying TPO counts or claiming aggressor quantities", () => {
    const ladder = new TpoVolumeLadderCache().read(source, sessions, style).get(0)!;
    expect(ladder.status).toBe("ready"); expect(ladder.profile?.total).toBe(12);
    expect(ladder.profile?.profile.rows.map(r => r.up + r.down)).toEqual([6, 6]);
    expect(ladder.profile?.profile.centers[ladder.profile.profile.poc]).toBe(100.5);
    expect(sessions[0].rows[sessions[0].valueArea.poc].grid?.center).toBe(101.5);
    expect(ladder.message).toContain("no aggressor classification");
  });
  it("keeps rows/value area independent and reuses allocations across color/placement edits", () => {
    const cache = new TpoVolumeLadderCache(), first = cache.read(source, sessions, style).get(0)!;
    const display = cache.read(source, sessions, { ...style, ladderColor: "#ff0000", ladderPosition: "Left" }).get(0)!;
    expect(display.profile).toBe(first.profile);
    const edited = cache.read(source, sessions, { ...style, ladderRows: 4, ladderValueAreaPercent: 100 }).get(0)!;
    expect(edited.profile?.profile.rows).toHaveLength(4); expect(edited.profile?.total).toBe(12);
    expect(edited.profile?.profile.vaFrom).toBe(0); expect(edited.profile?.profile.vaTo).toBe(3);
  });
  it("repairs a historical volume-only change while retaining TPO price/time math", () => {
    const bars = source.map(b => ({ ...b })), tpo = createTpoCache(), ladder = new TpoVolumeLadderCache();
    const model = tpo.read(bars, style, "5m", "BTCUSDT"), before = ladder.read(bars, model, style).get(0)!;
    bars[0].volume = 40;
    expect(tpo.read(bars, style, "5m", "BTCUSDT")).toBe(model);
    expect(ladder.read(bars, model, style).get(0)?.profile?.total).toBe(48); expect(before.profile?.total).toBe(12);
  });
  it("allocates only revealed composite member windows, excluding non-session and future candles", () => {
    const prefs = { ...style, sessionMinutes: 30 }, bars = [bar(0, 4), bar(15 * m, 8), bar(12 * 60 * m, 1000), bar(day, 12)];
    const ops = scopedTpoOperations(prefs, "5m", "BTCUSDT"); ops.links = [[0, day]];
    const model = buildTpoSessions(bars, { ...prefs, sessionOperations: ops }, "5m", "BTCUSDT");
    expect(new TpoVolumeLadderCache().read(bars, model, prefs).get(0)?.profile?.total).toBe(24);
    const prefix = bars.slice(0, 2), prefixModel = buildTpoSessions(prefix, { ...prefs, sessionOperations: ops }, "5m", "BTCUSDT");
    expect(new TpoVolumeLadderCache().read(prefix, prefixModel, prefs).get(0)?.profile?.total).toBe(12);
  });
  it("tracks missing/invalid candle volumes instead of treating omissions as zero", () => {
    const bars = [bar(0), { ...bar(5 * m), volume: undefined }, bar(10 * m, -1)], model = buildTpoSessions(bars, style, "5m");
    expect(new TpoVolumeLadderCache().read(bars, model, style).get(0)).toMatchObject({ status: "partial", missing: 1, rejected: 1, profile: { total: 4 } });
  });
  it("keeps a zero/missing-volume or invalid ladder from destroying the valid TPO profile", () => {
    const zero = [bar(0, 0)], model = buildTpoSessions(zero, style, "5m");
    expect(new TpoVolumeLadderCache().read(zero, model, style).get(0)).toMatchObject({ status: "unavailable", profile: null });
    const duplicated = [bar(0), bar(0)];
    expect(new TpoVolumeLadderCache().read(duplicated, buildTpoSessions(duplicated, style, "5m"), style).get(0)?.status).toBe("error");
    expect(model[0].valueArea.total).toBe(3);
  });
  it("supports legacy settings and bounds every native/chart-overlay option", () => {
    const legacy = Object.fromEntries(Object.entries(defaultTpo()).filter(([key]) => !key.startsWith("ladder")));
    expect(validTpo(legacy)).toBe(true); expect(resolveTpo(legacy)).toEqual(defaultTpo());
    for (const patch of [{ ladderRows: 0 }, { ladderRows: 1.5 }, { ladderWidthPercent: 101 }, { ladderValueAreaPercent: 0 }, { ladderPosition: "Center" }, { ladderColor: "bad" }]) expect(validTpo({ ...style, ...patch })).toBe(false);
    const keys = tpoOverlayInputs().map(i => i.key);
    for (const key of Object.keys(defaultTpo()).filter(k => k.startsWith("ladder"))) expect(keys).toContain(key);
  });
  it("keeps numeric schema defaults valid against their HTML min and step", () => {
    for (const input of tpoOverlayInputs()) if (typeof input.defval === "number" && input.step && input.min !== undefined) {
      const steps = (input.defval - input.min) / input.step;
      expect(Math.abs(steps - Math.round(steps)), input.key).toBeLessThan(1e-8);
    }
  });
  it("places a fractional-width ladder beside the actual profile body on either side", () => {
    expect(tpoLadderPlacement(100, 200, { ...style, ladderWidthPercent: 40 })).toEqual({ x: 204, width: 40 });
    expect(tpoLadderPlacement(100, 200, { ...style, ladderWidthPercent: 40, ladderPosition: "Left" })).toEqual({ x: 56, width: 40 });
    const cache = new TpoVolumeLadderCache(); expect(cache.read(source, sessions, { ...style, ladderVisible: false }).size).toBe(0);
  });
  it("projects independent volume rows/POC/VA on normal and inverted scales", () => {
    const ladder = new TpoVolumeLadderCache().read(source, sessions, style).get(0)!;
    for (const invert of [false, true]) {
      const boxes: number[][] = [], paths: number[][] = [], labels: string[] = [];
      const ctx = { save() {}, restore() {}, fillRect: (...p: number[]) => boxes.push(p), beginPath() {}, moveTo: (...p: number[]) => paths.push(p), lineTo() {}, stroke() {}, fillText: (s: string) => labels.push(s) } as unknown as CanvasRenderingContext2D;
      const args = { bounds: { top: 0, height: 500 }, scale: {}, theme: { textColor: "#fff" }, coords: { width: 1000, priceToY: (p: number) => invert ? p * 2 : 400 - p * 2 } } as unknown as RendererLayerArgs;
      paintTpoVolumeLadder(ctx, args, ladder, { ...style, ladderLabelsVisible: true }, 100, 200);
      expect(boxes).toHaveLength(2); expect(boxes.every(b => b[0] === 204 && b[2] === 30)).toBe(true);
      expect(paths[0][1]).toBe(invert ? 201 : 199); expect(labels).toContain("VPOC 100.5");
    }
  });
  it("reports estimate provenance and fences stale volume-only readouts", () => {
    const ladders = new TpoVolumeLadderCache().read(source, sessions, style), token = Symbol(), context = { symbol: "BTCUSDT", timeframe: "5m", epoch: 1, replay: false, style,
      seriesRange: { first: 0, last: 5 * m, count: 2, high: 102, low: 100, volume: 8 } };
    publishTpoSurface("ladder-test", token, { ...context, sessions, ladders });
    try {
      const readout = readTpoSurface("ladder-test", context, 0); expect(readout.status).toBe("ready");
      expect(readout.rows).toContainEqual({ label: "Volume ladder observed candle volume", value: "12" });
      expect(readTpoSurface("ladder-test", { ...context, seriesRange: { ...context.seriesRange, volume: 9 } }, 0).status).toBe("waiting");
    } finally { clearTpoSurface("ladder-test", token); }
  });
});
