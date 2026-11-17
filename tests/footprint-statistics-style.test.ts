import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { defaultFootprint } from "@/lib/orderflow/footprint";
import { footprintSignedNumber } from "@/lib/orderflow/footprintFormat";
import { FOOTPRINT_STAT_TOGGLES, footprintStatistics, footprintStatisticRows, paintFootprintStatistics } from "@/lib/orderflow/footprintStatistics";
import type { FootprintBar } from "@/types/trading";
const all = { ...defaultFootprint(), statisticsVisible: true, ...Object.fromEntries(FOOTPRINT_STAT_TOGGLES.map(key => [key, true])) };
const bar = (buyVolume = 12345, sellVolume = 1234): FootprintBar => ({ time: 0, volume: buyVolume + sellVolume, delta: buyVolume - sellVolume, poc: 100, levels: [{ price: 100, upperPrice: 101, buyVolume, sellVolume, buyCount: 12345, sellCount: 1234, imbalance: null }] });
function paint(source = bar(), patch = {}, themePatch = {}) {
  const texts: Array<{ text: string; color: string; align: string }> = [];
  const ctx = { fillStyle: "", textAlign: "", font: "", globalAlpha: 1, save() {}, restore() {}, fillRect() {}, fillText(text: string) { texts.push({ text, color: this.fillStyle, align: this.textAlign }); } };
  const args = { coords: { priceToY: (p: number) => (110 - p) * 20 }, bounds: { top: 0, height: 600 }, scale: {}, theme: { background: "#000000", fontFamily: "Arial", upColor: "#112233", downColor: "#445566", ...themePatch } } as unknown as RendererLayerArgs;
  paintFootprintStatistics(ctx as unknown as CanvasRenderingContext2D, args, source, 1, { ...all, buyColor: "#abcdef", sellColor: "#fedcba", bidColor: "#ff0000", askColor: "#00ff00", statisticsColor: "#778899", ...patch }, 250, 400);
  return texts;
}
it("formats large volumes and actual trade counts with the reference compact k scale", () => {
  expect(footprintStatisticRows(footprintStatistics(bar()), all).map(row => row.text)).toEqual(["14k", "12k (91%)", "1.2k (9%)", "+11k", "82%", "14k", "1.2k", "12k"]);
});
it("retains signed tiny deltas, signed rounded values and unsigned exact zero", () => {
  expect([0, -0, .001, -.001, 1.25, -1.25, 9999, -10000, NaN].map(footprintSignedNumber)).toEqual(["0", "0", "+0.0", "-0.0", "+1.3", "-1.3", "+10.0k", "-10k", "—"]);
});
it("omits undefined side percentage suffixes while keeping the standalone delta dash", () => {
  expect(footprintStatisticRows(footprintStatistics(bar(0, 0)), all).map(row => row.text)).toEqual(["0", "0", "0", "0", "—", "0", "0", "0"]);
});
it("uses chart theme direction colors independently of candle and footprint palettes", () => {
  const values = paint().filter(row => row.align === "right");
  expect(values.map(row => row.color)).toEqual(["#778899", "#112233", "#445566", "#112233", "#112233", "#778899", "#445566", "#112233"]);
  expect(paint(bar(1, 10)).filter(row => row.align === "right").slice(3, 5).map(row => row.color)).toEqual(["#445566", "#445566"]);
  expect(paint(bar(10, 10)).filter(row => row.align === "right").slice(3, 5).map(row => row.color)).toEqual(["#778899", "#778899"]);
});
it("preserves exact raw statistics and unavailable-count provenance when formatting", () => {
  const source = bar(.123456789, .012345678), original = structuredClone(source);
  source.levels[0].buyCount = null; const stats = footprintStatistics(source);
  expect(stats.buy).toBe(original.levels[0].buyVolume); expect(stats.sell).toBe(original.levels[0].sellVolume);
  expect(footprintStatisticRows(stats, all).slice(-3).map(row => row.text)).toEqual(["—", "1.2k", "—"]);
  expect(source.levels[0].buyVolume).toBe(original.levels[0].buyVolume);
});
it("merges percentage-only sides at their first enabled reference item position", () => {
  const style = { ...all, statBuy: false, statBuyPct: true, statSell: true };
  expect(footprintStatisticRows(footprintStatistics(bar()), style).slice(0, 3).map(row => row.label)).toEqual(["Volume", "Sell", "Buy"]);
});
