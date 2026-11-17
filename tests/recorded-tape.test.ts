import { describe, expect, it, vi } from "vitest";
import type { Tick } from "@/types/trading";
import { StudyTradeSource } from "@/lib/orderflow/studyTradeSource";
import { recordedTapeSource, type RecordedTapeContext } from "@/lib/orderflow/recordedTapeSource";
import { captureRecordedTimeSales, filterTimeSales, timeSalesCsv, timeSalesPage } from "@/lib/orderflow/timeSales";
const tick = (id: string, time: number, patch: Partial<Tick> = {}): Tick => ({ id, symbol: "HL:BTC", time, price: 100, quantity: 1, side: "buy", simulated: false, ...patch });
const trades = () => [tick("a", 1000), tick("b", 2999, { side: "sell" }), tick("c", 3000)];
const all = { side: "all" as const, minimum: 0, unit: "quantity" as const };
function loaded() {
  const source = new StudyTradeSource(), data = trades();
  source.install({ selection: { symbol: "HL:BTC", from: 0, to: 10000 }, trades: data, buyVolume: "2", sellVolume: "1", delta: "1", first: 1000, last: 3000, coverage: "observed-only" });
  return source;
}
const context = (source: StudyTradeSource, through = 3000): RecordedTapeContext => ({ symbol: "HL:BTC", timeframe: "1m", replay: true, simulated: false, source: "exchange", ready: true, through, revision: source.revision("HL:BTC") });
describe("completed-boundary recorded Time & Sales", () => {
  it("uses only an explicitly installed immutable archive prefix, excluding the exact cutoff", () => {
    const source = loaded(), captured = recordedTapeSource(context(source), source, 10000).value!;
    expect(captured.trades.map(row => row.id)).toEqual(["b", "a"]); expect(captured.replayThrough).toBe(3000); expect(captured.simulated).toBe(false);
    expect(filterTimeSales(captured, { ...all, side: "sell" }).map(row => row.id)).toEqual(["b"]);
  });
  it("shrinks on backward seeks, grows on forward seeks and never changes earlier snapshots", () => {
    const source = loaded(), ahead = recordedTapeSource(context(source, 4000), source, 10000).value!;
    expect(ahead.trades).toHaveLength(3); const back = recordedTapeSource(context(source, 2000), source, 10000).value!;
    expect(back.trades.map(row => row.id)).toEqual(["a"]); expect(ahead.trades).toHaveLength(3);
    expect(recordedTapeSource(context(source, 4000), source, 10000).value!.trades).toEqual(ahead.trades);
    source.clear("HL:BTC"); expect(recordedTapeSource(context(source), source, 10000).value).toBeNull();
  });
  it("distinguishes a real empty prefix from a missing archive without consulting live data", () => {
    const source = loaded(), empty = recordedTapeSource(context(source, 500), source, 10000);
    expect(empty.value?.trades).toEqual([]); expect(empty.error).toBe("");
    const missing = new StudyTradeSource(); expect(recordedTapeSource(context(missing), missing, 10000)).toMatchObject({ value: null, error: expect.stringContaining("Load an observed archive") });
  });
  it("rejects loading/wrong/simulated chart contexts before asking for an archive", () => {
    const source = loaded(), port = { replay: vi.fn(source.replay.bind(source)), revision: source.revision.bind(source) };
    for (const patch of [{ ready: false }, { simulated: true }, { replay: false }, { source: "simulation" }, { through: null }])
      expect(recordedTapeSource({ ...context(source), ...patch }, port, 10000).value).toBeNull();
    expect(port.replay).not.toHaveBeenCalled();
    expect(recordedTapeSource({ ...context(source), symbol: "HL:ETH", revision: 0 }, source, 10000).value).toBeNull();
  });
  it("fences queued archive revisions and mismatched prefix replies", () => {
    const source = loaded(), old = context(source); source.clear("HL:BTC");
    expect(recordedTapeSource(old, source, 10000)).toMatchObject({ value: null, error: expect.stringContaining("changed") });
    const port = { revision: () => 1, replay: () => ({ trades: trades(), through: 4000, label: "archive" }) };
    expect(recordedTapeSource({ ...old, revision: 1 }, port, 10000).value).toBeNull();
  });
  it("fails closed on invalid or unrevealed archive rows instead of returning a misleading partial tape", () => {
    for (const patch of [{ time: 3000 }, { symbol: "HL:ETH" }, { simulated: true }, { quantity: 0 }, { price: NaN }, { side: "unknown" }, { id: "" }])
      expect(() => captureRecordedTimeSales({ trades: [tick("a", 1000, patch as Partial<Tick>)], through: 3000, label: "archive" }, "HL:BTC", 10000)).toThrow();
    expect(() => captureRecordedTimeSales({ trades: [tick("a", 1000), tick("a", 1001)], through: 3000, label: "archive" }, "HL:BTC", 10000)).toThrow(/duplicate/);
    expect(() => captureRecordedTimeSales({ trades: [], through: NaN, label: "archive" }, "HL:BTC", 10000)).toThrow(/boundary/);
    expect(() => captureRecordedTimeSales({ trades: [], through: 3000, label: "archive" }, "IEX:AAPL", 10000)).toThrow(/classified/);
  });
  it("whitelists and freezes archive copies with their exclusive boundary and coverage", () => {
    const input = { trades: [tick("a", 1000)], through: 3000, label: 'Partial "archive"' }, capture = captureRecordedTimeSales(input, "HL:BTC", 10000);
    input.trades[0].quantity = 999; input.through = 4000;
    expect(capture.trades[0].quantity).toBe(1); expect(capture.replayThrough).toBe(3000); expect(Object.isFrozen(capture.trades[0])).toBe(true);
    const csv = timeSalesCsv(capture, all);
    expect(csv).toContain('"recorded_replay","replay_before_utc","source_coverage"'); expect(csv).toContain('"true","1970-01-01T00:00:03.000Z","Partial ""archive"""');
  });
  it("keeps every selected observation at the full 100,000-record capacity across pages and export", () => {
    const input = { trades: Array.from({ length: 100000 }, (_, i) => tick(String(i), i + 1000)), through: 101000, label: "Observed archive only" };
    const capture = captureRecordedTimeSales(input, "HL:BTC", 200000), rows = filterTimeSales(capture, all);
    expect(timeSalesPage(rows, 999)).toMatchObject({ page: 999, pages: 1000 });
    expect(timeSalesPage(rows, 999).trades.at(-1)?.id).toBe("0");
    expect(timeSalesCsv(capture, all).split("\r\n")).toHaveLength(100001);
    expect(() => captureRecordedTimeSales({ ...input, trades: [...input.trades, tick("overflow", 100001)] }, "HL:BTC", 200000)).toThrow(/100,000/);
  });
});
