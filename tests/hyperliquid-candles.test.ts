import { describe, expect, it } from "vitest";
import { HyperliquidCandleSeries, parseHyperliquidCandle } from "@/lib/market/hyperliquidCandles";

const base = Date.UTC(2026, 9, 27, 8);
const raw = { s: "BTC", i: "1m", t: base, T: base + 59999, o: "100", h: "110", l: "90", c: "105", v: "20", n: 10 };
const candle = (changes: Partial<typeof raw> = {}) => parseHyperliquidCandle({ ...raw, ...changes })!;

describe("native cumulative candles", () => {
  it("parses exact interval aliases and case-sensitive builder coins", () => {
    const midnight = Date.UTC(2026, 9, 27);
    expect(candle({ s: "xyz:TSLA", i: "1d", t: midnight, T: midnight + 86400000 - 1 }))
      .toMatchObject({ symbol: "HL:xyz:TSLA", timeframe: "1D" });
    expect(candle({ s: "kPEPE" }).symbol).toBe("HL:kPEPE");
  });
  it.each([
    { o: "" }, { o: "NaN" }, { c: "Infinity" }, { h: "99" }, { l: "101" }, { v: "-1" },
    { n: -1 }, { n: 1.5 }, { t: base + 1 }, { T: base - 1 }, { i: "45m" }, { s: "" },
  ])("rejects malformed venue snapshots: %j", change => {
    expect(parseHyperliquidCandle({ ...raw, ...change })).toBeNull();
  });
  it("uses cumulative volume rather than adding repeated snapshots", () => {
    const series = new HyperliquidCandleSeries(), first = series.accept([], candle(), 10);
    expect(series.accept(first.bars, candle(), 10)).toMatchObject({ changed: false, accepted: true });
    const next = series.accept(first.bars, candle({ n: 11, v: "21", c: "106" }), 10);
    expect(next.bars[0]).toMatchObject({ open: 100, close: 106, volume: 21 });
    expect(next.closed).toBeUndefined();
  });
  it("rejects lower trade counts and shrinking cumulative volume", () => {
    const series = new HyperliquidCandleSeries(), first = series.accept([], candle(), 10);
    expect(series.accept(first.bars, candle({ n: 9, v: "22" }), 10)).toMatchObject({ changed: false, accepted: false });
    expect(series.accept(first.bars, candle({ n: 11, v: "19" }), 10).changed).toBe(false);
  });
  it("selects the newer cumulative baseline when REST and stream overlap", () => {
    const series = new HyperliquidCandleSeries();
    series.accept([], candle(), 10);
    expect(series.mergeHistory([{ ...candle().bar, volume: 19 }], 10)[0].volume).toBe(20);
    const newer = series.mergeHistory([{ ...candle().bar, volume: 22, close: 107 }], 10);
    expect(newer[0]).toMatchObject({ volume: 22, close: 107 });
    expect(series.accept(newer, candle({ n: 11, v: "21" }), 10).changed).toBe(false);
    expect(series.accept(newer, candle({ n: 12, v: "23" }), 10).bars[0].volume).toBe(23);
  });
  it("emits the prior full candle once and keeps older updates away from the live callback", () => {
    const series = new HyperliquidCandleSeries(), first = series.accept([], candle(), 10);
    const next = candle({ t: base + 60000, T: base + 119999, n: 1, v: "1" });
    const advanced = series.accept(first.bars, next, 10);
    expect(advanced.closed).toEqual(candle().bar);
    expect(series.accept(advanced.bars, next, 10).closed).toBeUndefined();
    const late = series.accept(advanced.bars, candle({ n: 11, v: "21" }), 10);
    expect(late.latest).toBe(false);
    expect(late.closed).toBeUndefined();
  });
  it("does not close an unconfirmed partial trade bucket", () => {
    const series = new HyperliquidCandleSeries();
    const next = series.accept([candle().bar], candle({ t: base + 60000, T: base + 119999 }), 10);
    expect(next.closed).toBeUndefined();
  });
  it("bounds retained revisions and rejects ancient reconnect snapshots", () => {
    const series = new HyperliquidCandleSeries();
    let bars = [] as ReturnType<HyperliquidCandleSeries["mergeHistory"]>;
    for (let i = 0; i < 100; i++) bars = series.accept(bars, candle({ t: base + i * 60000, T: base + (i + 1) * 60000 - 1 }), 8).bars;
    expect(bars).toHaveLength(8);
    expect(series.mergeHistory([], 8)).toHaveLength(4);
    expect(series.accept(bars, candle(), 8).changed).toBe(false);
  });
});
