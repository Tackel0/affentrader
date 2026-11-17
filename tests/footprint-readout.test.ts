import { afterEach, expect, it } from "vitest";
import { clearFootprintSurface, publishFootprintSurface, readFootprintSurface } from "@/lib/orderflow/footprintReadout";
import { footprints } from "@/lib/orderflow/math";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const token = Symbol("collection"), context = { symbol: "HL:BTC", timeframe: "1m", epoch: 3, replay: false };
const bars = footprints([{ id: "buy", symbol: "HL:BTC", price: .3, quantity: 3, side: "buy", time: 0, simulated: false },
  { id: "sell", symbol: "HL:BTC", price: .2, quantity: 1, side: "sell", time: 1, simulated: false }], "1m", .1);
function publish(cell = "primary", owner = token) { publishFootprintSurface(cell, owner, { ...context, bars, simulated: false, dropped: 0 }); }
afterEach(() => { clearFootprintSurface("primary", token); clearFootprintSurface("cell-2", token); });
it("reports selected-bar classified quantities, signed delta and the canonical half-open POC row", () => {
  publish(); const result = readFootprintSurface("primary", context, 0);
  expect(Object.fromEntries(result.rows.map(row => [row.label, row.value]))).toEqual({ "Ask volume (buys)": "3", "Bid volume (sells)": "1", "Collected volume": "4", "Delta (Ask − Bid)": "2", "Delta %": "50%", "Buy %": "75%", "Sell %": "25%", "Underlying trade count": "—", "POC row [lower, upper)": "[0.3, 0.4)", "Price rows": "2", "Ask trade count": "—", "Bid trade count": "—", "Trade count basis": "Explicit underlying print counts only; an unknown execution count makes its side total unavailable" });
  expect(result.message).toContain("Partial"); expect(result.message).toContain("can differ");
});
it("shows missing executions as unavailable rather than assigning zero to another candle", () => {
  publish(); expect(readFootprintSurface("primary", context, 60000)).toMatchObject({ status: "empty", rows: [] });
  expect(readFootprintSurface("primary", context, undefined)).toMatchObject({ status: "unavailable", rows: [] });
});
it("fences cells, markets, intervals, source generations, Replay and stale layer destruction", () => {
  publish("cell-2"); expect(readFootprintSurface("primary", context, 0).status).toBe("unavailable"); publish();
  for (const change of [{ symbol: "HL:ETH" }, { timeframe: "5m" }, { epoch: 4 }]) expect(readFootprintSurface("primary", { ...context, ...change }, 0).rows).toEqual([]);
  expect(readFootprintSurface("primary", { ...context, replay: true }, 0)).toMatchObject({ status: "replay", rows: [] });
  clearFootprintSurface("primary", Symbol("obsolete")); expect(readFootprintSurface("primary", context, 0).status).toBe("ready");
  clearFootprintSurface("primary", token); expect(readFootprintSurface("primary", context, 0).status).toBe("unavailable");
});
it("keeps small quantities nonzero and labels simulation and evicted coverage", () => {
  const tiny = footprints([{ id: "tiny", symbol: "HL:BTC", time: 0, price: 1e-8, quantity: 1e-9, side: "sell", simulated: true }], "1m", 1e-9);
  publishFootprintSurface("primary", token, { ...context, bars: tiny, simulated: true, dropped: 2 });
  const result = readFootprintSurface("primary", context, 0); expect(result.message).toMatch(/SIMULATED.*evicted/);
  expect(result.rows.find(row => row.label === "Bid volume (sells)")?.value).toBe("0.000000001");
  expect(result.rows.find(row => row.label === "Delta %")?.value).toBe("-100%");
});
it("does not round distinct POC boundaries into an apparently zero-width row", () => {
  publishFootprintSurface("primary", token, { ...context, simulated: false, dropped: 0,
    bars: [{ time: 0, volume: 1, delta: 1, poc: 100000.000001, levels: [{ price: 100000.000001, upperPrice: 100000.0000011, buyVolume: 1, sellVolume: 0, imbalance: null }] }] });
  expect(readFootprintSurface("primary", context, 0).rows.find(row => row.label.startsWith("POC"))?.value).toBe("[100000.000001, 100000.0000011)");
});
it("reads the exact native selected timestamp independently of zoned display strings in all five bundles", () => {
  const dist = path.dirname(createRequire(import.meta.url).resolve("@luxalgo/vela"));
  const methods = readdirSync(dist).filter(name => /\.(js|cjs)$/.test(name) && !name.endsWith(".min.js"))
    .flatMap(name => [...readFileSync(path.join(dist, name), "utf8").matchAll(/getDataWindowReadout\(\) \{([\s\S]*?)\n\s*\}\n\s*dataWindowPricePane/g)].map(match => match[1]));
  expect(methods).toHaveLength(5);
  const selected = [{ time: 1792888200000 }, { time: 1792891800000 }];
  for (const body of methods) {
    const read = new Function("formatStampParts", body), native = { bars: selected, hoverLogical: 0, scene: { timezone: "Europe/Berlin" },
      dataWindowPricePane: () => null, dataWindowOHLC: () => ({}), dataWindowGroups: () => [] };
    const format = () => ({ date: "2026-10-25", time: "02:30" });
    expect(read.call(native, format).barTime).toBe(selected[0].time);
    expect(read.call(native, format).seriesRange).toMatchObject({ first: selected[0].time, last: selected[1].time, count: 2 });
    native.hoverLogical = 1;
    expect(read.call(native, format).barTime).toBe(selected[1].time); native.hoverLogical = 999;
    expect(read.call(native, format).barTime).toBe(selected[1].time);
    native.bars = selected.slice(0, 1); expect(read.call(native, format).seriesRange).toMatchObject({ first: selected[0].time, last: selected[0].time, count: 1 });
  }
});
