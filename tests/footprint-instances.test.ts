import { expect, it } from "vitest";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { defaultFootprint, footprintSettings, footprintPlacements, footprintBarGeometry, resolveFootprintChart, resolveFootprintInstances, validFootprint, paintFootprintBar } from "@/lib/orderflow/footprint";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import { footprints } from "@/lib/orderflow/math";
import { createFootprintInspection, footprintInspectionCsv } from "@/lib/orderflow/footprintInspection";
import { publishFootprintSurface, readFootprintSurface, captureFootprintInspection, clearFootprintSurface } from "@/lib/orderflow/footprintReadout";
import type { Tick } from "@/types/trading";
const trade = (i: number, time = i * 1000): Tick => ({ id: String(i), symbol: "KRK:BTC/USD", time, price: 100 + i % 7 / 10, quantity: i + 1, side: i % 2 ? "buy" : "sell", simulated: false, tradeCount: 1 });
const trades = Array.from({ length: 20 }, (_, i) => trade(i));
const all = { ...defaultFootprint(), fp2Enabled: true, fp3Enabled: true, fp4Enabled: true, fp5Enabled: true };
const args = { coords: { pxPerBar: () => 1000, timeToX: (time: number) => 1000 + time / 60, width: 3000,
  priceToY: (price: number) => (103 - price) * 40 }, bounds: { top: 0, height: 400 }, scale: { min: 99, max: 103 }, theme: { background: "#131722", textColor: "#ffffff" } } as unknown as RendererLayerArgs;

it("keeps the old single instance and resolves five independently configured instances", () => {
  expect(resolveFootprintInstances({})).toHaveLength(1);
  const instances = resolveFootprintInstances({ ...all, rowSize: 1, fp2RowSize: .1, fp2BuyColor: "#123456", fp4AverageTradeSize: true });
  expect(instances).toHaveLength(5);
  expect(instances[0].style).toMatchObject({ rowSize: 1, volumeMode: "bid-ask" });
  expect(instances[1].style).toMatchObject({ rowSize: .1, buyColor: "#123456", volumeMode: "bid-ask-ladder", position: "left" });
  expect(instances[3].style.averageTradeSize).toBe(true);
  expect(instances[0].style.averageTradeSize).toBe(false);
});
it("permits one Within only, preserving the saved preference when another falls back Right", () => {
  const source = { ...all, position: "within", fp2Position: "within", fp3Position: "within" };
  expect(resolveFootprintInstances(source).map(i => i.style.position)).toEqual(["within", "right", "right", "right", "left"]);
  expect(source.fp2Position).toBe("within");
  expect(resolveFootprintInstances({ ...source, position: "left" })[1].style.position).toBe("within");
});
it("validates disabled settings strictly and preserves them through JSON capture", () => {
  const source = { ...all, fp2Enabled: false, fp2RowSize: .2, fp2VolumeMode: "total", fp2VolumeSplit: false, fp5UnfinishedWidth: 5, readoutInstance: "5" };
  expect(validFootprint(source)).toBe(true);
  const captured = resolveFootprintChart(JSON.parse(JSON.stringify(source)));
  expect(captured).toMatchObject(source); expect(validFootprint(captured)).toBe(true);
  expect(resolveFootprintInstances(captured)).toHaveLength(4);
  for (const invalid of [{ fp2RowSize: -1 }, { fp2Enabled: "true" }, { fp3Position: "bottom" }, { fp5VolumeMode: "bad" }, { fp6Enabled: true }, { fp4Oops: 1 }, { readoutInstance: "6" }])
    expect(validFootprint({ ...source, ...invalid })).toBe(false);
});
it("namespaces nested native colors and conditional gates and exposes five native tabs", () => {
  const settings = footprintSettings(); expect(settings.instances).toHaveLength(5);
  expect(settings.instances![0].enableKey).toBeUndefined();
  expect(settings.instances![1].enableKey).toBe("fp2Enabled");
  expect(settings.instances![1].rows.find(row => "key" in row && row.key === "fp2VolumeMode")).toMatchObject({ defval: "bid-ask-ladder" });
  expect(settings.instances![1].rows.find(row => "key" in row && row.key === "fp2VolumeSplit")).toMatchObject({ when: { key: "fp2VolumeMode", equals: "total" } });
  expect(settings.instances![1].rows.find(row => "key" in row && row.key === "fp2CandleVisible")).toMatchObject({ colors: [{ key: "fp2BuyColor" }, { key: "fp2SellColor" }] });
  expect(settings.instances![1].rows.find(row => "key" in row && row.key === "fp2BidColor")).toMatchObject({ kind: "color", when: { key: "fp2VolumeMode", anyOf: ["bid-ask", "bid-ask-ladder"] } });
});
it("packs every arrangement without intersecting neighbors or the other instances", () => {
  for (let n = 0; n < 243; n++) {
    const source: Record<string, unknown> = { ...all }; let value = n;
    for (let i = 0; i < 5; i++) { source[i ? `fp${i + 1}Position` : "position"] = ["left", "right", "within"][value % 3]; value = Math.floor(value / 3); }
    const instances = resolveFootprintInstances(source), positions = footprintPlacements(args, instances);
    const ranges = instances.map(instance => { const g = footprintBarGeometry(args, 0, positions.get(instance.id)); return [g.center - g.half, g.center + g.half]; }).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i][0]).toBeGreaterThanOrEqual(ranges[i - 1][1] - 1e-9);
    expect(ranges.at(-1)![1]).toBeLessThanOrEqual(ranges[0][0] + 1000 + 1e-9);
  }
});
it("shares one deduplicated tape and caches each grid while other views change", () => {
  const history = new FootprintHistory("1m"); history.add(trades); history.add(trades);
  const a = history.read({ step: .1, ratio: 3 }, "fp1");
  const b = history.read({ step: .3, ratio: 2, minimumVolume: 3 }, "fp2");
  expect(history.read({ step: .1, ratio: 3 }, "fp1")).toBe(a);
  expect(b).toEqual(footprints(trades, "1m", .3, 2, { minimumVolume: 3 }));
  history.read({ step: 1, ratio: 5 }, "fp2");
  expect(history.read({ step: .1, ratio: 3 }, "fp1")).toBe(a);
  const late = trade(99, 4000); history.add([late]);
  for (const [id, step] of [["fp1", .1], ["fp2", 1]] as const) expect(history.read({ step, ratio: 3 }, id)).toEqual(footprints([...trades, late], "1m", step));
  expect(history.coverage.trades).toBe(21);
});
it("evicts whole bars from all grids and re-enables a removed view from retained executions", () => {
  const history = new FootprintHistory("1m", { trades: 4, bars: 2, rows: 100 });
  history.add([trade(0), trade(1), trade(2, 60000), trade(3, 61000)]);
  history.read({ step: .1, ratio: 3 }, "fp1"); history.read({ step: 1, ratio: 3 }, "fp2");
  history.add([trade(4, 120000)]);
  for (const id of ["fp1", "fp2"]) expect(history.read({ step: .1, ratio: 3 }, id).map(bar => bar.time)).toEqual([60000, 120000]);
  history.retainViews(["fp1"]);
  expect(history.read({ step: 1, ratio: 3 }, "fp2")).toEqual(footprints([trade(2, 60000), trade(3, 61000), trade(4, 120000)], "1m", 1));
  expect(history.coverage).toMatchObject({ trades: 3, dropped: 2 });
});
it("bounds combined row storage and frees rows when an instance is disabled", () => {
  const history = new FootprintHistory("1m", { trades: 100, bars: 10, rows: 2 }); history.add([trade(1)]);
  history.read({ step: 1, ratio: 3 }, "fp1"); history.read({ step: 1, ratio: 3 }, "fp2"); history.retainViews(["fp1"]);
  expect(() => history.read({ step: 1, ratio: 3 }, "fp3")).not.toThrow();
  expect(() => history.read({ step: 1, ratio: 3 }, "fp4")).toThrow(/price rows/);
  expect(() => history.read({ step: 1, ratio: 3 }, "fp1")).toThrow(/price rows/);
});
it("paints five profiles on the same candle in their separate assigned regions", () => {
  const instances = resolveFootprintInstances(all), places = footprintPlacements(args, instances), raw = footprints(trades, "1m", 1)[0];
  for (const instance of instances) {
    const rects: number[][] = [], placement = places.get(instance.id)!;
    const ctx = { save() {}, restore() {}, fillRect: (...p: number[]) => rects.push(p), strokeRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} } as unknown as CanvasRenderingContext2D;
    paintFootprintBar(ctx, args, raw, undefined, 1, { ...instance.style, candleVisible: false }, placement);
    const center = 1000 + placement.offset;
    expect(rects.length).toBeGreaterThan(0);
    for (const [x, , width] of rects) { expect(x).toBeGreaterThanOrEqual(center - placement.width / 2 - 1e-9); expect(x + width).toBeLessThanOrEqual(center + placement.width / 2 + 1e-9); }
  }
});
it("keeps an off-screen candle's side profile when its assigned region is visible", () => {
  const raw = footprints(trades, "1m", 1)[0], view = { ...args, coords: { ...args.coords, timeToX: () => -200 } } as unknown as RendererLayerArgs;
  const rects: number[][] = [];
  const ctx = { save() {}, restore() {}, fillRect: (...p: number[]) => rects.push(p), strokeRect() {}, fillText() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} } as unknown as CanvasRenderingContext2D;
  paintFootprintBar(ctx, view, raw, undefined, 1, { ...defaultFootprint(), candleVisible: false }, { width: 100, offset: 300, within: false });
  expect(rects.length).toBeGreaterThan(0);
  expect(rects.every(([x]) => x >= 50 && x <= 150)).toBe(true);
});
it("resets all grids together when live executions replace simulation", () => {
  const history = new FootprintHistory("1m"); history.add([{ ...trade(1), simulated: true }]);
  for (let i = 0; i < 5; i++) history.read({ step: i + 1, ratio: 3 }, `fp${i + 1}`);
  const live = trade(90); history.add([live]);
  for (let i = 0; i < 5; i++) expect(history.read({ step: i + 1, ratio: 3 }, `fp${i + 1}`)).toEqual(footprints([live], "1m", i + 1));
  expect(history.coverage).toMatchObject({ trades: 1, simulated: false });
});
it("captures the inspected instance in CSV and rejects a target after switching instances", () => {
  const raw = footprints(trades, "1m", .1)[0], settings = { step: .1, ratio: 3, minimumVolume: 0, ignoreZeroOpposite: false, minimumStackRows: 3, instance: "fp2" };
  const token = Symbol(), context = { symbol: "KRK:BTC/USD", timeframe: "1m", epoch: 0, replay: false, sourceStamp: "source" };
  const surface = { ...context, bars: [raw], simulated: false, dropped: 0, analysis: settings };
  publishFootprintSurface("multi-test", token, surface);
  const readout = readFootprintSurface("multi-test", context, raw.time), target = readout.inspectionTarget!;
  expect(readout.rows).toContainEqual({ label: "Inspected footprint", value: "Footprint 2" });
  expect(captureFootprintInspection(target, "source")?.settings.instance).toBe("fp2");
  expect(footprintInspectionCsv(createFootprintInspection(raw, settings, { ...context, simulated: false, coverage: "test" }))).toContain('"footprint_instance"');
  publishFootprintSurface("multi-test", token, { ...surface, analysis: { ...settings, instance: "fp3" } });
  expect(captureFootprintInspection(target, "source")).toBeNull(); clearFootprintSurface("multi-test", token);
});
