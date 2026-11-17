import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTpoSessions } from "@/lib/orderflow/tpoModel";
import { defaultTpo } from "@/lib/orderflow/tpoSettings";
import { clearTpoSurface, publishTpoSurface, readTpoSurface } from "@/lib/orderflow/tpoReadout";
import { retainedTpoReference, tpoSnapshotDraft, validTpoAlertReference } from "@/lib/alerts/tpoDraft";
import { AlertEvaluator } from "@/lib/alerts/engine";
import { parseWorkspace } from "@/lib/workspace";
import { useAlertStore } from "@/stores/useAlertStore";
import { ALERT_STORAGE_KEY } from "@/lib/alerts/browserPersistence";
import type { PriceAlert, TpoAlertCandidate } from "@/types/trading";

const minute = 60000, start = Date.UTC(2026, 9, 28), end = start + 60 * minute;
const style = { ...defaultTpo(), sessionMinutes: 60, rowSize: .1, extendPoc: true, extendVah: true, extendVal: true };
const candle = (time: number) => ({ time, open: .2, high: .3, low: .2, close: .3, volume: 1 });
const opening = Array.from({ length: 12 }, (_, i) => candle(start + i * 5 * minute));
const revealed = start + 86400000, full = [...opening, candle(revealed)];
const context = { symbol: "BTCUSDT", timeframe: "5m", epoch: 7, replay: false,
  seriesRange: { first: start, last: revealed, count: 13, high: .3, low: .2 } };
const token = Symbol("TPO alert test"), cell = "tpo-alert-test";
const original = useAlertStore.getState();
function read(bars = full, preferences = style, replay = false) {
  const range = { first: bars[0].time, last: bars.at(-1)!.time, count: bars.length, high: .3, low: .2 };
  const current = { ...context, replay, seriesRange: range };
  publishTpoSurface(cell, token, { ...current, style: preferences, sessions: buildTpoSessions(bars, preferences, "5m") });
  return readTpoSurface(cell, current, bars.at(-1)!.time);
}
function alert(candidate: TpoAlertCandidate = read().alertCandidates![0]): PriceAlert {
  const draft = tpoSnapshotDraft(candidate, [candidate], "exchange")!;
  return { id: "tpo-test", name: draft.name!, symbol: draft.symbol!, timeframe: "5m", price: draft.price!,
    tpoReference: draft.tpoReference, condition: "crossing", status: "active", repeat: false, trigger: "once",
    frequency: "tick", sound: false, browserNotification: false, simulated: false, createdAt: end };
}
function backup(value: PriceAlert) {
  return { version: 1, chart: { state: { symbol: "BTCUSDT", timeframe: "5m", chartType: "tpo", feedMode: "auto", indicators: [], drawings: {}, pineLibraries: {} } },
    watchlists: { state: { lists: [{ id: "list", name: "Crypto", symbols: ["BTCUSDT"] }], activeId: "list" } },
    alerts: { state: { alerts: [value], logs: [] } } };
}
afterEach(() => { clearTpoSurface(cell, token); useAlertStore.setState(original); vi.unstubAllGlobals(); });

describe("completed TPO snapshot alerts", () => {
  it("takes exact canonical POC/VA edges only from the fully covered completed reference", () => {
    const view = read(), candidates = view.alertCandidates!;
    expect(candidates.map(({ level, price }) => [level, price])).toEqual([["poc", .25], ["vah", .4], ["val", .2]]);
    for (const candidate of candidates) {
      const draft = tpoSnapshotDraft(candidate, candidates, "exchange")!;
      expect(draft).toMatchObject({ price: candidate.price, source: "tpo", symbol: "BTCUSDT", timeframe: "5m",
        tpoReference: { sessionStart: start, sessionEnd: end, simulated: false } });
      expect(validTpoAlertReference(draft.tpoReference)).toBe(true);
    }
    expect(read(full, { ...style, extendPoc: false }).alertCandidates!.map(c => c.level)).toEqual(["vah", "val"]);
    expect(read(full, { ...style, extendPoc: false, extendVah: false, extendVal: false }).alertCandidates).toEqual([]);
  });
  it("withholds developing, opening/internal/trailing gaps and Replay candidates", () => {
    expect(read(opening).alertCandidates).toEqual([]);
    for (const index of [0, 5, 11]) expect(read(full.filter((_, i) => i !== index)).alertCandidates).toEqual([]);
    expect(read(full, style, true).alertCandidates).toEqual([]);
    expect(read().alertCandidates).toHaveLength(3);
    for (const changed of [{ epoch: 8 }, { symbol: "ETHUSDT" }, { timeframe: "15m" }, { replay: true },
      { seriesRange: { ...context.seriesRange, count: 14 } }, { style: { ...style, rowSize: .2 } }]) {
      expect(readTpoSurface(cell, { ...context, ...changed }, revealed).alertCandidates).toBeUndefined();
    }
  });
  it("rejects stale selection after generation, level, symbol, interval or session changes", () => {
    const candidates = read().alertCandidates!, selected = candidates[0];
    for (const patch of [{ epoch: 8 }, { symbol: "ETHUSDT" }, { timeframe: "15m" }, { price: .25001 },
      { sessionStart: start + 1 }, { sessionEnd: end + 1 }]) {
      expect(tpoSnapshotDraft({ ...selected, ...patch }, candidates, "exchange")).toBeNull();
    }
    expect(tpoSnapshotDraft(selected, candidates.slice(1), "exchange")).toBeNull();
    const draft = tpoSnapshotDraft(selected, candidates, "simulation")!;
    candidates[0].price = .9;
    expect(draft.price).toBe(.25); expect(draft.tpoReference!.price).toBe(.25);
    expect(draft.tpoReference!.simulated).toBe(true);
  });
  it("keeps provenance only for an exact unchanged single-price level, independent of evaluation interval", () => {
    const value = alert();
    expect(retainedTpoReference(value.tpoReference, { ...value, timeframe: "1h" } as PriceAlert)).toEqual(value.tpoReference);
    for (const patch of [{ price: .26 }, { symbol: "ETHUSDT" }, { simulated: true }, { condition: "entering_band" as const }, { condition: "exiting_band" as const }])
      expect(retainedTpoReference(value.tpoReference, { ...value, ...patch })).toBeUndefined();
    for (const condition of ["crossing", "crossing_up", "crossing_down"] as const)
      expect(retainedTpoReference(value.tpoReference, { ...value, condition })).toEqual(value.tpoReference);
  });
  it("round trips saved workspace provenance and preserves legacy price alerts", () => {
    const value = alert(), workspace = backup(value);
    expect(parseWorkspace(JSON.stringify(workspace)).alerts.state.alerts).toEqual([value]);
    delete value.tpoReference;
    expect(parseWorkspace(JSON.stringify(backup(value))).alerts.state.alerts).toEqual([value]);
  });
  it("rejects invalid or misleading imported provenance", () => {
    const value = alert();
    for (const patch of [{ price: .3 }, { symbol: "ETHUSDT" }, { simulated: true }, { timeframe: "bad" }, { level: "ib" }, { level: ["poc"] },
      { sessionStart: end }, { sessionEnd: Infinity }, { sessionStart: -1 }, { unexpected: true }]) {
      const changed = { ...value, tpoReference: { ...value.tpoReference, ...patch } } as PriceAlert;
      expect(() => parseWorkspace(JSON.stringify(backup(changed)))).toThrow("Invalid TPO alert reference");
    }
    expect(() => parseWorkspace(JSON.stringify(backup({ ...value, condition: "entering_band", upperPrice: .5 })))).toThrow("Invalid TPO alert reference");
  });
  it("persists provenance through the real Zustand storage, rehydrates it and removes it on a manual threshold edit", async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) });
    const value = alert(); useAlertStore.getState().add(value);
    const serialized = saved.get(ALERT_STORAGE_KEY)!;
    expect(JSON.parse(serialized).state.alerts[0].tpoReference).toEqual(value.tpoReference);
    useAlertStore.setState({ alerts: [] }); saved.set(ALERT_STORAGE_KEY, serialized);
    await useAlertStore.persist.rehydrate();
    expect(useAlertStore.getState().alerts[0].tpoReference).toEqual(value.tpoReference);
    const edited = { ...value, price: .5 };
    useAlertStore.getState().update(value.id, { status: "paused" });
    expect(useAlertStore.getState().alerts[0].tpoReference).toEqual(value.tpoReference);
    useAlertStore.getState().edit(value.id, { price: edited.price });
    expect(JSON.parse(saved.get(ALERT_STORAGE_KEY)!).state.alerts[0].tpoReference).toBeUndefined();
    useAlertStore.getState().add({ ...value, id: "second" });
    useAlertStore.getState().update("second", { condition: "entering_band", upperPrice: .5 });
    expect(useAlertStore.getState().alerts.find(a => a.id === "second")!.tpoReference).toBeUndefined();
  });
  it.each(["crossing", "crossing_up", "crossing_down"] as const)("evaluates %s through the real engine, rebaselines on source changes and fires once", condition => {
    const value = { ...alert(), condition }, evaluator = new AlertEvaluator();
    const [from, to] = condition === "crossing_down" ? [.3, .25] : [.2, .25];
    expect(evaluator.evaluate([value], value.symbol, from, end + 1, true, "tick")).toEqual([]);
    expect(evaluator.evaluate([value], value.symbol, to, end + 2, false, "tick")).toEqual([]);
    expect(evaluator.evaluate([value], value.symbol, from, end + 3, false, "tick")).toEqual([]);
    expect(evaluator.evaluate([value], value.symbol, to, end + 4, false, "tick")).toEqual([value.id]);
    evaluator.evaluate([value], value.symbol, from, end + 5, false, "tick");
    expect(evaluator.evaluate([value], value.symbol, to, end + 6, false, "tick")).toEqual([]);
  });
  it("uses only new matching-interval closes for close-based snapshots", () => {
    const value = { ...alert(), frequency: "close" as const, trigger: "once_per_close" as const, repeat: true }, evaluator = new AlertEvaluator();
    expect(evaluator.evaluate([value], value.symbol, .2, end, false, "close", "5m")).toEqual([]);
    expect(evaluator.evaluate([value], value.symbol, .3, end + 5 * minute, false, "close", "1m")).toEqual([]);
    expect(evaluator.evaluate([value], value.symbol, .3, end, false, "close", "5m")).toEqual([]);
    expect(evaluator.evaluate([value], value.symbol, .25, end + 5 * minute, false, "close", "5m")).toEqual([value.id]);
    expect(evaluator.evaluate([value], value.symbol, .2, end + 5 * minute, false, "close", "5m")).toEqual([]);
  });
});
