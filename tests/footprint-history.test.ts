import { describe, expect, it } from "vitest";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import { footprints } from "@/lib/orderflow/math";
import type { Tick } from "@/types/trading";
const tick = (i: number, changes: Partial<Tick> = {}): Tick => ({ id: `trade-${i}`, symbol: "HL:BTC", price: 100 + i % 11 / 10,
  quantity: 1 + i % 3 / 10, side: i % 2 ? "buy" : "sell", simulated: false, time: i * 1000, ...changes });
const settings = { step: .1, ratio: 3, minimumVolume: 0, ignoreZeroOpposite: false };
describe("collected footprint history", () => {
  it("retains already observed bars beyond the rolling 5,000-execution tape", () => {
    const history = new FootprintHistory("1m"), trades = Array.from({ length: 6500 }, (_, i) => tick(i));
    history.add(trades.slice(0, 5000).reverse()); history.read(settings);
    for (const trade of trades.slice(5000)) history.add([trade]);
    const collected = history.read(settings), rolling = footprints(trades.slice(-5000), "1m", .1);
    expect(collected).toEqual(footprints(trades, "1m", .1)); expect(collected[0].time).toBe(0); expect(rolling[0].time).toBeGreaterThan(0);
    expect(history.coverage.trades).toBe(6500);
  });
  it("matches batch canonical rows after late trades, settings changes and zoom-driven regridding", () => {
    const history = new FootprintHistory("1m"), trades = Array.from({ length: 500 }, (_, i) => tick(i)); history.add(trades);
    const first = history.read(settings), prior = structuredClone(first);
    const late = tick(999, { time: 2000, price: 100.3, quantity: 200 }); history.add([late]); trades.push(late);
    expect(history.read(settings)).toEqual(footprints(trades, "1m", .1)); expect(first).toEqual(prior);
    for (const step of [.3, 1, .01]) expect(history.read({ ...settings, step })).toEqual(footprints(trades, "1m", step));
    expect(history.read({ ...settings, ratio: 2, minimumVolume: 4, ignoreZeroOpposite: true }))
      .toEqual(footprints(trades, "1m", .1, 2, { minimumVolume: 4, ignoreZeroOpposite: true }));
  });
  it("deduplicates reseeding and protects its source snapshot from caller mutation", () => {
    const history = new FootprintHistory("1m"), source = tick(1); history.add([source]); history.add([source]); const first = history.read(settings);
    source.quantity = 200; source.price = 200; expect(history.read(settings)).toBe(first);
    expect(history.read({ ...settings, step: 1 })[0].volume).toBe(1.1);
  });
  it("evicts complete oldest buckets, rejects expired reseeds and reports the dropped trades", () => {
    const history = new FootprintHistory("1m", { trades: 4, bars: 2, rows: 100 });
    history.add([tick(0), tick(1), tick(60), tick(61)]); history.read(settings); history.add([tick(120)]);
    expect(history.read(settings).map(bar => bar.time)).toEqual([60000, 120000]); expect(history.coverage).toMatchObject({ trades: 3, dropped: 2 });
    history.add([tick(0), tick(2)]); expect(history.coverage.trades).toBe(3);
  });
  it("separates simulation and exchange data and rejects stale source transitions", () => {
    const history = new FootprintHistory("1m"); history.add([tick(1)]); history.read(settings);
    const simulated = tick(80, { simulated: true }); history.add([simulated]); history.add([tick(2)]);
    expect(history.read(settings)[0].volume).toBe(simulated.quantity); expect(history.coverage).toMatchObject({ simulated: true, trades: 1, rejected: 1 });
  });
  it("fails closed at single-bar, row and numeric capacity rather than showing truncated totals", () => {
    const history = new FootprintHistory("1m", { trades: 2, bars: 2, rows: 20 }); history.add([tick(0), tick(1)]); history.read(settings);
    expect(() => history.add([tick(2)])).toThrow(/One footprint bar/); expect(() => history.read(settings)).toThrow(/One footprint bar/);
    const rows = new FootprintHistory("1m", { trades: 10, bars: 10, rows: 1 }); rows.add([tick(1), tick(2)]);
    expect(() => rows.read(settings)).toThrow(/price rows/); expect(() => rows.read(settings)).toThrow(/price rows/);
    const numeric = new FootprintHistory("1m"); expect(() => numeric.add([tick(1, { quantity: 1e308 }), tick(2, { quantity: 1e308, price: 100.1, side: "buy" })])).toThrow(/precision/);
    expect(() => numeric.read(settings)).toThrow(/precision/);
  });
  it("reuses clean bars when a different bucket changes and keeps invalid trades out", () => {
    const history = new FootprintHistory("1m"); history.add([tick(0), tick(60)]); const first = history.read(settings); expect(history.read(settings)).toBe(first);
    history.add([tick(61), tick(8, { quantity: -1 }), tick(9, { side: "invalid" as "buy" })]); const next = history.read(settings);
    expect(next[0]).toBe(first[0]); expect(next[1]).not.toBe(first[1]); expect(history.coverage.rejected).toBe(2);
  });
});
