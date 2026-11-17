import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachStudyNoticeHost, clearStudyNotice, currentStudyNotices, drawingNoticeAlive, drawingNoticeOwner, routeStudyNotice, studyNoticeStore } from "@/lib/chart/studyNotices";
import { useChartStore } from "@/stores/useChartStore";
import { studyTradeSource } from "@/lib/orderflow/studyTradeSource";
import type { CellContext } from "@/lib/chart/cellContext";
const cell: CellContext = { id: "primary", symbol: "HL:BTC", timeframe: "1m", replay: false };
const cleanups: Array<() => void> = [], owners: object[] = [];
const owner = () => { const value = {}; owners.push(value); return value; };
beforeEach(() => { vi.stubGlobal("requestAnimationFrame", () => 1); useChartStore.setState({ feedMode: "auto", marketEpochs: { "HL:BTC": 1 }, dataSources: { "HL:BTC:1m": "exchange" } }); });
afterEach(() => { owners.splice(0).forEach(clearStudyNotice); cleanups.splice(0).forEach(fn => fn()); studyTradeSource.clear("HL:BTC"); vi.unstubAllGlobals(); });
describe("shared chart coverage notices", () => {
  it("preserves standalone painter fallback until an accessible host attaches", () => {
    const a = owner(); expect(routeStudyNotice(a, cell, "Depth", "Observed books")).toBe(false);
    cleanups.push(attachStudyNoticeHost("primary")); expect(routeStudyNotice(a, cell, "Depth", "Observed books")).toBe(true);
    expect(currentStudyNotices(cell)).toMatchObject([{ title: "Depth", message: "Observed books" }]);
  });
  it("keeps snapshots stable for unchanged paints and batches subscriber notifications", async () => {
    cleanups.push(attachStudyNoticeHost("primary")); const receive = vi.fn(); cleanups.push(studyNoticeStore.subscribe(receive));
    const a = owner(); routeStudyNotice(a, cell, "VRVP", "983 observations"); const snapshot = studyNoticeStore.getSnapshot();
    routeStudyNotice(a, cell, "VRVP", "983 observations"); expect(studyNoticeStore.getSnapshot()).toBe(snapshot);
    routeStudyNotice(owner(), cell, "CVD", "Partial history"); await Promise.resolve(); expect(receive).toHaveBeenCalledTimes(1);
    const id = currentStudyNotices(cell)[0].id; routeStudyNotice(a, cell, "VRVP", "984 observations");
    expect(currentStudyNotices(cell)[0]).toMatchObject({ id, title: "VRVP", message: "984 observations" });
  });
  it("fences market, interval, source generation and Replay boundaries", () => {
    cleanups.push(attachStudyNoticeHost("primary")); routeStudyNotice(owner(), cell, "SVP", "Partial history");
    for (const patch of [{ symbol: "HL:ETH" }, { timeframe: "5m" as const }, { replay: true, replayThrough: 60000 }]) expect(currentStudyNotices({ ...cell, ...patch })).toEqual([]);
    useChartStore.setState({ marketEpochs: { "HL:BTC": 2 } }); expect(currentStudyNotices(cell)).toEqual([]);
    const replay = { ...cell, replay: true, replayThrough: 60000 }; routeStudyNotice(owner(), replay, "Footprint", "Recorded prefix");
    expect(currentStudyNotices(replay)).toHaveLength(1); expect(currentStudyNotices({ ...replay, replayThrough: 120000 })).toEqual([]);
    useChartStore.setState({ feedMode: "simulation" }); expect(currentStudyNotices(replay)).toEqual([]);
  });
  it("keeps multiple studies and chart cells independent through cleanup", () => {
    cleanups.push(attachStudyNoticeHost("primary"), attachStudyNoticeHost("satellite"));
    const a = owner(), b = owner(); routeStudyNotice(a, cell, "VRVP", "Observed"); routeStudyNotice(b, cell, "VRVP", "Estimate");
    routeStudyNotice(owner(), { ...cell, id: "satellite" }, "Depth", "Top levels"); expect(currentStudyNotices(cell)).toHaveLength(2);
    clearStudyNotice(a); expect(currentStudyNotices(cell)).toMatchObject([{ message: "Estimate" }]);
    expect(currentStudyNotices({ ...cell, id: "satellite" })).toHaveLength(1);
    routeStudyNotice(b, cell, "VRVP", ""); expect(currentStudyNotices(cell)).toEqual([]);
  });
  it("reference-counts hosts and releases all cell notices when the last host detaches", () => {
    const off1 = attachStudyNoticeHost("primary"), off2 = attachStudyNoticeHost("primary"), a = owner();
    routeStudyNotice(a, cell, "Depth", "Partial"); off1(); expect(currentStudyNotices(cell)).toHaveLength(1);
    off2(); expect(currentStudyNotices(cell)).toEqual([]); expect(routeStudyNotice(a, cell, "Depth", "Partial")).toBe(false);
  });
  it("filters removed/hidden drawing owners without allowing old cleanup to remove replacements", () => {
    cleanups.push(attachStudyNoticeHost("primary")); let visible = true;
    useChartStore.setState({ drawings: { "HL:BTC": { version: 1, drawings: [{ id: "fixed", visible: true }] } } });
    const a = owner(), b = owner(), alive = drawingNoticeAlive("HL:BTC", "fixed", () => visible);
    routeStudyNotice(a, cell, "FRVP", "Observed 1", alive); expect(currentStudyNotices(cell)).toHaveLength(1);
    visible = false; expect(currentStudyNotices(cell)).toEqual([]); visible = true;
    useChartStore.setState({ drawings: {} }); expect(currentStudyNotices(cell)).toEqual([]);
    routeStudyNotice(b, cell, "FRVP", "Replacement"); clearStudyNotice(a); expect(currentStudyNotices(cell)).toMatchObject([{ message: "Replacement" }]);
    routeStudyNotice(b, cell, "FRVP", "Replacement", () => false); expect(currentStudyNotices(cell)).toEqual([]);
    routeStudyNotice(b, cell, "FRVP", "Replacement", () => true); expect(currentStudyNotices(cell)).toHaveLength(1);
    expect(drawingNoticeOwner("primary", "HL:BTC", "fixed")).toBe(drawingNoticeOwner("primary", "HL:BTC", "fixed"));
    expect(drawingNoticeOwner("primary", "HL:BTC", "fixed")).not.toBe(drawingNoticeOwner("satellite", "HL:BTC", "fixed"));
  });
  it("bounds owners retained by native drawing rehydration", () => {
    cleanups.push(attachStudyNoticeHost("primary"));
    for (let i = 0; i < 400; i++) routeStudyNotice(owner(), cell, "FRVP", `Range ${i}`);
    expect(currentStudyNotices(cell)).toHaveLength(256); expect(currentStudyNotices(cell)[0].message).toBe("Range 144");
  });
});
