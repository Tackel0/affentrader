import { describe, expect, it, vi } from "vitest";
import { NativeRenderer } from "@luxalgo/vela";
import type { DataWindowReadout, OHLCV } from "@luxalgo/vela";
const native = NativeRenderer.prototype as unknown as { getDataWindowReadout(): DataWindowReadout; updateLegendValues(): void; setBars(bars: OHLCV[], options?: { preserveView?: boolean }): void };
const bars: OHLCV[] = [0, 1, 2].map(index => ({ time: Date.UTC(2026, 9, 25, 0, index * 5), open: 100 + index, high: 110 + index, low: 90 + index, close: 105 + index, volume: 10 + index }));
function host(hoverLogical: number | null, data = bars) {
  return { hoverLogical, bars: data, scene: { timezone: "UTC" }, dataWindowPricePane: () => null,
    dataWindowOHLC: (bar: OHLCV) => bar ? { o: String(bar.open), h: String(bar.high), l: String(bar.low), c: String(bar.close), vol: String(bar.volume), up: true } : null,
    dataWindowGroups: vi.fn((index: number) => [{ name: "Index", rows: [{ label: "Revealed index", value: String(index), color: "#2962ff" }] }]) };
}
describe("actual native data-window index bounds", () => {
  it.each([999, -1, NaN, Infinity, 0.5, null])("falls back to the latest revealed bar for stale index %s", index => {
    const target = host(index), readout = native.getDataWindowReadout.call(target);
    expect(readout.ohlc!.c).toBe("107"); expect(readout.time).toBe("00:10");
    expect(target.dataWindowGroups).toHaveBeenCalledWith(2, null);
  });
  it("keeps a valid historical crosshair instead of replacing it with the latest bar", () => {
    const target = host(0), readout = native.getDataWindowReadout.call(target);
    expect(readout.ohlc!.c).toBe("105"); expect(readout.time).toBe("00:00");
    expect(target.dataWindowGroups).toHaveBeenCalledWith(0, null);
  });
  it("cannot read the hidden future after a Replay truncation", () => {
    const target = host(2); expect(native.getDataWindowReadout.call(target).ohlc!.c).toBe("107");
    target.bars = bars.slice(0, 1);
    expect(native.getDataWindowReadout.call(target)).toMatchObject({ time: "00:00", ohlc: { c: "105" }, groups: [{ rows: [{ value: "0" }] }] });
  });
  it("retains the native empty-series response without accessing nonexistent bars", () => {
    const target = host(20, []);
    expect(native.getDataWindowReadout.call(target)).toEqual({ date: "", time: "", ohlc: null, groups: [] });
    expect(target.dataWindowGroups).not.toHaveBeenCalled();
  });
  it.each([999, -1, NaN, Infinity, 0.5, null])("keeps legend values on the same revealed bar as the data window for index %s", index => {
    const target = { bars, hoverLogical: index, inputsUI: { setPlotValues: vi.fn() },
      scene: { indicators: new Map([["ema", { id: "ema" }]]) }, dataWindowPricePane: () => null,
      readoutRowsFor: vi.fn((_model: unknown, barIndex: number) => [{ value: String(bars[barIndex]?.close), color: "#2962ff" }]) };
    native.updateLegendValues.call(target);
    expect(target.readoutRowsFor).toHaveBeenCalledWith({ id: "ema" }, 2, null, "legend");
    expect(target.inputsUI.setPlotValues.mock.calls[0][0].get("ema")).toEqual([{ value: "107", color: "#2962ff" }]);
  });
  it("keeps valid historical legend values and clears rows when the series empties", () => {
    const target = { bars, hoverLogical: 0, inputsUI: { setPlotValues: vi.fn() },
      scene: { indicators: new Map([["ema", { id: "ema" }]]) }, dataWindowPricePane: () => null,
      readoutRowsFor: vi.fn((_model: unknown, index: number) => [{ value: String(bars[index].close), color: "#2962ff" }]) };
    native.updateLegendValues.call(target);
    expect(target.readoutRowsFor).toHaveBeenCalledWith({ id: "ema" }, 0, null, "legend");
    target.bars = []; native.updateLegendValues.call(target);
    expect(target.inputsUI.setPlotValues.mock.calls.at(-1)![0].size).toBe(0);
  });
  it.each([{ replacement: bars }, { replacement: bars.slice(0, 1) }, { replacement: [] }])("discards the previous keyboard announcement on a native series replacement", ({ replacement }) => {
    const target = { bars, introRaf: null, introPlayed: true, liveEaseTime: 1, hoverLogical: 2, zoomAnchorLogical: 0,
      liveRegion: { textContent: "Future live bar and its old RSI value" }, scene: { bars, indicators: new Map() },
      coords: { width: 0, setBars: vi.fn() }, scheduler: { invalidate: vi.fn() } };
    native.setBars.call(target, replacement);
    expect(target.liveRegion.textContent).toBe("");
    expect(target.bars).toHaveLength(replacement.length);
    expect(target.scheduler.invalidate).toHaveBeenCalled();
  });
  it("preserves the native crosshair offset when history is prepended while clearing its obsolete speech", () => {
    const target = { bars: bars.slice(1), introRaf: null, introPlayed: true, didInitialFit: true, liveEaseTime: 0, hoverLogical: 0, zoomAnchorLogical: 0,
      liveRegion: { textContent: "Previous summary" }, scene: { bars: bars.slice(1), indicators: new Map() },
      coords: { width: 0, setBars: vi.fn() }, scheduler: { invalidate: vi.fn() } };
    native.setBars.call(target, bars, { preserveView: true });
    expect(target.hoverLogical).toBe(1); expect(target.zoomAnchorLogical).toBe(1);
    expect(target.liveRegion.textContent).toBe("");
    const readoutHost = host(target.hoverLogical, target.bars);
    expect(native.getDataWindowReadout.call(readoutHost).ohlc!.c).toBe("106");
  });
});
