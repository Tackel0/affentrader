import { describe, expect, it } from "vitest";
import {
  buildLiquidationHeatmap, completedLiquidationBars, defaultLiquidationHeatmap,
  estimatedLiquidationPrice, liquidationHeatmapSettings, liquidationReference,
} from "@/lib/orderflow/liquidationHeatmap";
import type { OHLCV } from "@/types/trading";

const minute = 60_000;
const candle = (index: number, values: Partial<OHLCV> = {}): OHLCV => ({
  time: index * minute, open: 100, high: 100.5, low: 99.5, close: 100, volume: 100, ...values,
});
const defaults = defaultLiquidationHeatmap;
const build = (bars: OHLCV[]) => buildLiquidationHeatmap(bars, bars.length, "1m", defaults);

describe("liquidation estimates from completed candles", () => {
  it("uses the isolated linear margin formula on each side", () => {
    expect(estimatedLiquidationPrice(100, 10, 0, "long")).toBeCloseTo(90);
    expect(estimatedLiquidationPrice(100, 10, 0, "short")).toBeCloseTo(110);
    const long = estimatedLiquidationPrice(100, 20, 0.005, "long");
    const short = estimatedLiquidationPrice(100, 20, 0.005, "short");
    expect(5 + long - 100).toBeCloseTo(long * 0.005);
    expect(5 + 100 - short).toBeCloseTo(short * 0.005);
  });

  it("starts bands only after their source candle closes and adds overlapping volume", () => {
    const first = build([candle(0)]);
    const overlap = build([candle(0), candle(1)]);
    expect(first.bands).toHaveLength(6);
    expect(first.bands.every(band => band.from === minute && band.to === null)).toBe(true);
    expect(overlap.bands.filter(band => band.to === null)).toHaveLength(6);
    expect(overlap.bands.filter(band => band.to === null).every(band => band.from === 2 * minute)).toBe(true);
    expect(overlap.maxWeight).toBeCloseTo(first.maxWeight * 2);
  });

  it("ends crossed rows on the correct side and does not carry estimates across missing candles", () => {
    const crossed = build([candle(0), candle(1), candle(2, { low: 80, volume: 0 })]);
    expect(crossed.bands.filter(band => band.side === "long" && band.to === null)).toHaveLength(0);
    expect(crossed.bands.filter(band => band.side === "short" && band.to === null)).toHaveLength(3);
    const gap = build([candle(0), candle(1), candle(3)]);
    expect(gap.bands.every(band => band.to === null ? band.from === 4 * minute : band.to <= 2 * minute)).toBe(true);
    expect(gap.maxWeight).toBeCloseTo(1 / 3);
  });

  it("ignores forming and unrevealed bars, validates inputs and bounds retained bands", () => {
    const bars = [candle(0), candle(1), candle(2, { low: 1, high: 200, volume: 1e9 })];
    const end = completedLiquidationBars(bars, "1m", 2 * minute);
    expect(end).toBe(2);
    expect(buildLiquidationHeatmap(bars, end, "1m", defaults)).toEqual(build(bars.slice(0, 2)));
    expect(completedLiquidationBars(bars, "100T", 3 * minute)).toBe(0);
    expect(build([candle(0, { volume: NaN })]).bands).toEqual([]);
    const inputs = liquidationHeatmapSettings({ lookback: 99999, rowPercent: NaN, leverages: "constructor", maintenancePercent: 3, longColor: "invalid" });
    expect(inputs).toMatchObject({ ...defaults, lookback: 360, maintenancePercent: 0.75 });
    const many = Array.from({ length: 800 }, (_, index) => candle(index));
    expect(buildLiquidationHeatmap(many, many.length, "1m", inputs).bands.length).toBeLessThanOrEqual(360 * 6);
  });

  it("distinguishes perpetual, spot and unsupported references", () => {
    for (const symbol of ["HL:BTC", "HL:xyz:TSLA", "BYBIT:LINEAR:BTCUSDT"]) expect(liquidationReference(symbol)).toBe("Perpetual reference");
    for (const symbol of ["BTCUSDT", "KRK:BTC/USD", "BYBIT:SPOT:BTCUSDT"]) expect(liquidationReference(symbol)).toBe("Spot reference");
    for (const symbol of ["YF:AAPL", "IEX:TSLA", "BYBIT:LINEAR:invalid"]) expect(liquidationReference(symbol)).toBeNull();
  });
});
