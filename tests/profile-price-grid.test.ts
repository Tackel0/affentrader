import { describe, expect, it } from "vitest";
import { buildSessionVolumeProfiles } from "@/lib/orderflow/volumeProfileModel";
import { defaultVolumeProfile } from "@/lib/orderflow/volumeProfileSettings";
import { buildTpoRows } from "@/lib/orderflow/tpoMath";
import { buildTpoSessions } from "@/lib/orderflow/tpoModel";
import { defaultTpo } from "@/lib/orderflow/tpoSettings";
import { tpoProfile } from "@/lib/orderflow/math";
import type { Tick } from "@/types/trading";

const trade = (price: number, quantity: number, time: number): Tick => ({ id: String(time), price, quantity, time, side: "buy", symbol: "TEST", simulated: false });
const bar = (low: number, high = low) => ({ time: 0, low, high });
describe("session profile price-grid boundaries", () => {
  it("keeps executions just below a decimal boundary in the preceding SVP row", () => {
    const result = buildSessionVolumeProfiles([trade(.29999999999999993, 2, 1), trade(.3, 3, 2)], { ...defaultVolumeProfile(), rowSize: .1 }, "BTCUSDT").sessions[0];
    expect(result.rows.map(row => [row.price, row.total])).toEqual([[.2, 2], [.3, 3]]);
    expect(result.valueArea.total).toBe(5);
  });
  it("retains distinguishable large-price SVP ticks previously lost to fourteen-significant-digit rounding", () => {
    const result = buildSessionVolumeProfiles([trade(1e8, 2, 1), trade(100000000.0000001, 3, 2)], { ...defaultVolumeProfile(), rowSize: 1e-7 }, "BTCUSDT").sessions[0];
    expect(result.rows.map(row => row.price)).toEqual([1e8, 100000000.0000001]);
  });
  it("retains sub-ten-decimal executions on either side of a tiny SVP boundary", () => {
    const result = buildSessionVolumeProfiles([trade(2.9999999999999997e-12, 2, 1), trade(3e-12, 3, 2)], { ...defaultVolumeProfile(), rowSize: 1e-12 }, "BTCUSDT").sessions[0];
    expect(result.rows.map(row => [row.price, row.total])).toEqual([[2e-12, 2], [3e-12, 3]]);
  });
  it("does not snap a below-boundary point auction into the next TPO price row", () => {
    expect(buildTpoRows([bar(.29999999999999993)], .1, 60000, 0).map(row => row.price)).toEqual([.2]);
  });
  it("includes both actual rows of an OHLC range straddling a decimal boundary", () => {
    expect(buildTpoRows([bar(.29999999999999993, .3)], .1, 60000, 0).map(row => [row.price, row.count])).toEqual([[.2, 1], [.3, 1]]);
  });
  it("floors negative TPO bounds without snapping the below-boundary value upward", () => {
    expect(buildTpoRows([bar(-.30000000000000004, -.3)], .1, 60000, 0).map(row => row.price)).toEqual([-.4, -.3]);
  });
  it("retains distinct large-price TPO rows instead of imposing a fourteen-digit price cap", () => {
    expect(buildTpoRows([bar(1e8, 100000000.0000001)], 1e-7, 60000, 0).map(row => row.price)).toEqual([1e8, 100000000.0000001]);
  });
  it("carries canonical upper edges and exact decimal centers through both models", () => {
    const result = buildSessionVolumeProfiles([trade(.2, 1, 1), trade(.3, 2, 2)], { ...defaultVolumeProfile(), rowSize: .1 }, "BTCUSDT").sessions[0];
    expect(result.rowGrid).toEqual([{ index: 2, lower: .2, upper: .3, center: .25 }, { index: 3, lower: .3, upper: .4, center: .35 }]);
    const tpo = buildTpoRows([bar(.2, .3)], .1, 60000, 0);
    expect(tpo.map(row => row.grid)).toEqual(result.rowGrid);
    expect(JSON.parse(JSON.stringify(result)).rowGrid).toEqual(result.rowGrid);
  });
  it("keeps automatic row-size products canonical for both session profile families", () => {
    const result = buildSessionVolumeProfiles([trade(99995.2, 1, 1), trade(100000, 2, 2)], { ...defaultVolumeProfile(), rows: 20 }, "BTCUSDT").sessions[0];
    expect(result.step).toBe(.3);
    const tpo = buildTpoSessions([bar(99995.2, 100000)], { ...defaultTpo(), targetRows: 20 }, "5m")[0];
    expect(tpo.step).toBe(.3);
  });
  it("preserves the public TPO row schema while retaining internal projection metadata", () => {
    expect(tpoProfile([bar(.2)], .1)).toEqual([{ price: .2, periods: ["A"], count: 1 }]);
  });
});
