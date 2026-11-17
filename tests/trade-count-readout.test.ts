import { describe, expect, it, vi } from "vitest";
import { NativeRenderer } from "@luxalgo/vela";

// Exercise the shipped renderer method, rather than a second host formatter.
const readout = (NativeRenderer.prototype as unknown as {
  readoutRowsFor(model: unknown, idx: number, pane: unknown, surface: string): { label: string; value: string }[];
}).readoutRowsFor;
function fixture(type: string, value: number | null, candle = false) {
  const price = vi.fn((v: number, options: { decimals: number }) => v.toFixed(options.decimals));
  const fallback = vi.fn((v: number) => `price:${v}`);
  const target = { scene: { format: { price }, panes: new Map(), offsetOf: () => 1 },
    theme: { upColor: "green" }, seriesTitle: () => "Count", dataWindowFmt: fallback };
  const series = candle ? { kind: "candle", bars: [{ close: value }], style: {} }
    : { kind: "line", points: [{ value }], style: { color: "green" } };
  return { target, model: { native: { type }, series: [series] }, price, fallback };
}
describe("native count value surfaces", () => {
  it("formats all three count families in integer units on both surfaces, including candle/offset reads", () => {
    for (const type of ["af-trade-count", "af-trade-count-delta", "af-ctcd"]) {
      for (const value of [0, -8, 58, Number.MAX_SAFE_INTEGER]) {
        for (const surface of ["dataWindow", "legend"]) {
          for (const candle of [false, true]) {
            const { target, model, price, fallback } = fixture(type, value, candle);
            expect(readout.call(target, model, 1, {}, surface)[0].value).toBe(String(value));
            expect(price).toHaveBeenCalledWith(value, { decimals: 0, mode: "price", surface });
            expect(fallback).not.toHaveBeenCalled();
          }
        }
      }
    }
  });
  it("uses the configured locale formatter and preserves missing/hidden/other study semantics", () => {
    const f = fixture("af-ctcd", 1234);
    f.price.mockImplementation(v => new Intl.NumberFormat("de-DE").format(v));
    expect(readout.call(f.target, f.model, 1, {}, "dataWindow")[0].value).toBe("1.234");
    for (const value of [null, NaN, Infinity]) {
      const missing = fixture("af-ctcd", value);
      expect(readout.call(missing.target, missing.model, 1, {}, "legend")).toEqual([]);
    }
    const hidden = fixture("af-trade-count", 58);
    Object.assign(hidden.model.series[0], { display: { dataWindow: false } });
    expect(readout.call(hidden.target, hidden.model, 1, {}, "dataWindow")).toEqual([]);
    for (const [type, value] of [["af-cvd", 8], ["af-ctcd", 1.5], ["af-ctcd", Number.MAX_SAFE_INTEGER + 1]] as const) {
      const other = fixture(type, value);
      expect(readout.call(other.target, other.model, 1, {}, "legend")[0].value).toBe(`price:${value}`);
      expect(other.price).not.toHaveBeenCalled();
    }
  });
});
