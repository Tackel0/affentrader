import { describe, expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { buildTpoSessions, createTpoCache, tpoCalendar } from "@/lib/orderflow/tpoModel";
import { publishTpoSurface, readTpoSurface, clearTpoSurface } from "@/lib/orderflow/tpoReadout";
import { defaultTpo, resolveTpo, validTpo } from "@/lib/orderflow/tpoSettings";
import { changeTpoOperations, scopedTpoOperations, validTpoOperations } from "@/lib/orderflow/tpoOperations";
import { tpoSessionLayout } from "@/lib/orderflow/tpoRenderer";
import { tpoSessionHit } from "@/lib/orderflow/tpoSessionMenu";
import { tpoReferenceLevels } from "@/lib/orderflow/tpoReferenceLevels";
const m = 60000, day = 86400000, symbol = "BTCUSDT";
const bar = (time: number, low = 100, high = low) => ({ time, open: low, close: high, low, high, volume: 1 });
const style = { ...defaultTpo(), rowSize: 1, sessionMinutes: 60 };
const bars = [bar(0), bar(30 * m, 101), bar(day, 100), bar(day + 30 * m, 102), bar(2 * day, 99), bar(2 * day + 30 * m, 102)];
function merged() {
  let ops = scopedTpoOperations(style, "30m", symbol);
  ops = changeTpoOperations(ops, [[0], [day], [2 * day]], 0, "following");
  return { ...style, sessionOperations: ops };
}
describe("TPO session operations", () => {
  it("recomputes a composite from all contributing opportunities on one price grid", () => {
    const sessions = buildTpoSessions(bars, merged(), "30m", symbol);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].members?.map(w => w.start)).toEqual([0, day]);
    expect(sessions[0].rows.map(row => [row.price, row.count, row.periodIndices])).toEqual([[100, 2, [0, 2]], [101, 1, [1]], [102, 1, [3]]]);
    expect(sessions[0].valueArea.poc).toBe(0);
    expect(sessions[0].completion).toMatchObject({ status: "complete", expectedBars: 4, missingSlots: 0 });
    expect(sessions[0].coverage).toMatchObject({ loadedBars: 4, missingSlots: 0, observedBlocks: 4 });
    expect(tpoReferenceLevels(sessions[0])?.from).toBe(day + 60 * m);
  });
  it("chains previous/following merges and restores original sessions on unmerge", () => {
    const prefs = merged(); prefs.sessionOperations = changeTpoOperations(prefs.sessionOperations, [[0, day], [2 * day]], 1, "previous");
    expect(buildTpoSessions(bars, prefs, "30m", symbol)).toHaveLength(1);
    prefs.sessionOperations = changeTpoOperations(prefs.sessionOperations, [[0, day, 2 * day]], 0, "unmerge");
    expect(buildTpoSessions(bars, prefs, "30m", symbol)).toEqual(buildTpoSessions(bars, style, "30m", symbol));
  });
  it("unmerges only the selected composite and supports unmerge all", () => {
    const ops = { ...scopedTpoOperations(style, "30m", symbol), links: [[0, day], [2 * day, 3 * day]] as [number, number][] };
    expect(changeTpoOperations(ops, [[0, day], [2 * day, 3 * day]], 0, "unmerge").links).toEqual([[2 * day, 3 * day]]);
    expect(changeTpoOperations(ops, [[0, day], [2 * day, 3 * day]], 0, "unmerge-all").links).toEqual([]);
    expect(ops.links).toHaveLength(2);
  });
  it("never extends a merge into an unknown future Replay session or bridges an unloaded linked member", () => {
    const prefs = merged();
    const prefix = buildTpoSessions(bars.slice(0, 2), prefs, "30m", symbol);
    expect(prefix).toHaveLength(1); expect(prefix[0].end).toBe(60 * m); expect(prefix[0].members).toBeUndefined();
    expect(buildTpoSessions(bars.filter(b => b.time < day || b.time >= 2 * day), prefs, "30m", symbol)).toHaveLength(2);
  });
  it("keeps missing opening bars incomplete and recomputes auto grid/structure over the composite", () => {
    const prefs = merged(), partial = buildTpoSessions(bars.slice(1), prefs, "30m", symbol)[0];
    expect(partial.partialStart).toBe(true); expect(partial.completion.status).toBe("incomplete");
    expect(tpoReferenceLevels(partial)).toBeNull();
    expect(partial.initialBalance.status).toBe("incomplete");
    const automatic = buildTpoSessions(bars, { ...prefs, rowSize: 0 }, "30m", symbol)[0];
    expect(automatic.step).toBeGreaterThan(0); expect(automatic.structure.poorLow?.opportunities).toBe(2);
  });
  it("preserves original elapsed block windows on expanded composites across overnight gaps", () => {
    const prefs = merged(), session = buildTpoSessions(bars, prefs, "30m", symbol)[0];
    const args = { coords: { timeToX: (time: number) => time / m, pxPerBar: () => 30 } } as unknown as RendererLayerArgs;
    const layout = tpoSessionLayout(args, { ...session, expanded: true }, prefs);
    expect(layout.cellAt(0, 0)).toEqual({ x: -15, width: 30 });
    expect(layout.cellAt(0, 2)).toEqual({ x: 1425, width: 30 });
  });
  it("isolates operations by symbol, interval and calendar settings and serializes them without aliasing", () => {
    const prefs = merged();
    for (const [p, tf, sym] of [[prefs, "30m", "ETHUSDT"], [prefs, "15m", symbol], [{ ...prefs, sessionMinutes: 90 }, "30m", symbol]] as const)
      expect(scopedTpoOperations(p, tf, sym).links).toEqual([]);
    expect(validTpo(prefs)).toBe(true);
    const resolved = resolveTpo(JSON.parse(JSON.stringify(prefs))); expect(resolved.sessionOperations).toEqual(prefs.sessionOperations);
    resolved.sessionOperations!.links.length = 0; expect(prefs.sessionOperations.links).toHaveLength(1);
    const { sessionOperations: _, ...legacy } = style; expect(validTpo(legacy)).toBe(true);
  });
  it("invalidates composite/expansion edits and in-place historical repairs", () => {
    const source = bars.map(b => ({ ...b })), cache = createTpoCache(), first = cache.read(source, style, "30m", symbol);
    const prefs = merged(); expect(cache.read(source, prefs, "30m", symbol)).not.toBe(first);
    prefs.sessionOperations = changeTpoOperations(prefs.sessionOperations, [[0, day], [2 * day]], 0, "expand");
    expect(cache.read(source, prefs, "30m", symbol)[0].expanded).toBe(true);
    source[0].high = 110; expect(cache.read(source, prefs, "30m", symbol)[0].rows.at(-1)?.price).toBe(110);
  });
  it("validates bounded operations and ignores actions without a neighboring profile", () => {
    const ops = scopedTpoOperations(style, "30m", symbol);
    expect(changeTpoOperations(ops, [[0]], 0, "previous")).toEqual(ops);
    for (const patch of [{ links: [[2, 1]] }, { links: [[1, 2], [1, 2]] }, { expanded: [[0, "true"]] }, { expanded: [[0, true], [0, false]] }, { scope: "x".repeat(513) }])
      expect(validTpoOperations({ ...ops, ...patch })).toBe(false);
  });
  it("hit-tests the actual profile cells and obeys per-session expansion overrides", () => {
    const sessions = buildTpoSessions(bars, style, "30m", symbol), args = { priceStyle: "tpo", bounds: { top: 0, height: 500 }, scale: {},
      coords: { width: 5000, timeToX: (time: number) => time / m + 20, pxPerBar: () => 30, priceToY: (price: number) => (110 - price) * 20 } } as unknown as RendererLayerArgs;
    const frame = { args, sessions, style, symbol, timeframe: "30m" };
    expect(tpoSessionHit(frame, 26, 190)).toBe(0); expect(tpoSessionHit(frame, 100, 190)).toBe(-1);
    expect(tpoSessionHit({ ...frame, args: { ...args, priceStyle: "candles" } }, 26, 190)).toBe(-1);
    expect(tpoSessionLayout(args, { ...sessions[0], expanded: true }, style).split).toBe(true);
    expect(tpoSessionLayout(args, { ...sessions[0], expanded: false }, { ...style, splitPeriods: true }).split).toBe(false);
  });
  it("preserves day boundaries and letter periods across a 25-hour DST session", () => {
    const prefs = { ...style, sessionZone: "America/New_York", sessionMinutes: 1440, blockMinutes: "240" as const };
    const calendar = tpoCalendar(prefs), a = calendar.forDate("2026-11-01"), b = calendar.forDate("2026-11-02");
    const ops = scopedTpoOperations(prefs, "5m", symbol); ops.links = [[a.start, b.start]];
    const composite = buildTpoSessions([bar(a.start), bar(b.start)], { ...prefs, sessionOperations: ops }, "5m", symbol)[0];
    expect(composite.rows[0].periodIndices).toEqual([0, 7]);
    expect(composite.periodSpans?.map(s => [s.first, s.count, s.start, s.end])).toEqual([[0, 7, a.start, a.end], [7, 6, b.start, b.end]]);
  });
  it("reads cloned persisted operations by value and identifies the selected composite arrangement", () => {
    const prefs = merged(); prefs.sessionOperations = changeTpoOperations(prefs.sessionOperations, [[0, day], [2 * day]], 0, "expand");
    const sessions = buildTpoSessions(bars, prefs, "30m", symbol), token = Symbol(), context = { symbol, timeframe: "30m", epoch: 1, replay: false,
      seriesRange: { first: 0, last: bars.at(-1)!.time, count: bars.length, high: 102, low: 102 }, style: prefs };
    publishTpoSurface("ops-test", token, { ...context, style: structuredClone(prefs), sessions });
    try {
      const readout = readTpoSurface("ops-test", context, 0);
      expect(readout.status).toBe("ready");
      expect(readout.rows).toContainEqual({ label: "Composite sessions", value: "2" });
      expect(readout.rows).toContainEqual({ label: "TPO arrangement", value: "Expanded into chart time columns" });
    } finally { clearTpoSurface("ops-test", token); }
  });
});
