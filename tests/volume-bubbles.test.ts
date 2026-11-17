import { afterEach, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, RendererLayerArgs } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { defaultBubbles, resolveBubbles, bubbleInputs, bubbleStep, volumeBubbles } from "@/lib/orderflow/volumeBubbles";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import { bubblesDescriptor, type BubblesChannel } from "@/lib/orderflow/volumeBubblesIndicator";
import { bubbleAtPoint, paintVolumeBubbles } from "@/lib/orderflow/volumeBubblesRenderer";
import { INDICATORS } from "@/lib/indicators/catalog";

const tick = (id: string, time: number, price: number, quantity: number, side: Tick["side"] = "buy"): Tick =>
  ({ id, symbol: "KRK:BTC/USD", time, price, quantity, side, simulated: false });
const trades = [tick("a", 1000, 100, 8), tick("b", 2000, 100, 2, "sell"), tick("c", 3000, 101, 3),
  tick("d", 4000, 101, 3, "sell"), tick("e", 61000, 100, 1)];
function history(source = trades) { const h = new FootprintHistory("1m"); h.add(source); return h; }
const rows = () => history().read({ step: 1, ratio: 3 });
const style = () => ({ ...defaultBubbles(), hideBelow: 0 });
const candle = (time: number) => ({ time, open: 100, high: 102, low: 99, close: 101, volume: 100000 });
const args = (invert = false) => ({ bars: [candle(0), candle(60000)], coords: { width: 500, visibleTimeRange: () => ({ from: 0, to: 60000 }),
  timeToX: (time: number) => 80 + time / 1000, priceToY: (price: number) => invert ? (price - 95) * 10 : (110 - price) * 10 },
  scale: { min: 95, max: 110 }, bounds: { top: 0, height: 300 }, theme: { textColor: "#eeeeee", background: "#111111" }, cursor: null }) as unknown as RendererLayerArgs;

afterEach(() => vi.useRealTimers());
it("aggregates classified prices, deduplicates IDs and ignores unrelated candle volumes", () => {
  const h = history([...trades, trades[0]]), bars = h.read({ step: 1, ratio: 3 });
  const result = volumeBubbles(bars, 0, 60000, style());
  expect(result.map(b => [b.time, b.lower, b.upper, b.buy, b.sell, b.volume, b.deltaPercent])).toEqual([
    [0, 100, 101, 8, 2, 10, 60], [0, 101, 102, 3, 3, 6, 0], [60000, 100, 101, 1, 0, 1, 100],
  ]);
  expect(volumeBubbles([], 0, 60000, style())).toEqual([]);
});
it("applies every filter against the visible maximum before deterministic top-N selection", () => {
  const bars = rows();
  expect(volumeBubbles(bars, 0, 60000, { ...style(), hideBelow: 50 }).map(b => b.volume)).toEqual([10, 6]);
  expect(volumeBubbles(bars, 0, 60000, { ...style(), volumeMin: 2, volumeMax: 7 }).map(b => b.volume)).toEqual([6]);
  expect(volumeBubbles(bars, 0, 60000, { ...style(), minDelta: 50 }).map(b => b.volume)).toEqual([10, 1]);
  expect(volumeBubbles(bars, 0, 60000, { ...style(), maxVisible: 1 }).map(b => b.volume)).toEqual([10]);
  expect(volumeBubbles(bars, 60000, 60000, defaultBubbles()).map(b => b.volume)).toEqual([1]);
  expect(volumeBubbles(bars, 0, 60000, style(), 101.1, 103).map(b => b.volume)).toEqual([6]);
});
it("sizes by square-root volume with bounded opacity and visible-maximum highlight rings", () => {
  const result = volumeBubbles(rows(), 0, 60000, style());
  expect(result[0]).toMatchObject({ radius: 25, alpha: .7, highlight: true });
  expect(result[2].radius).toBeCloseTo(5 + 20 * Math.sqrt(.1));
  expect(result[2].alpha).toBeCloseTo(.07);
  expect(result[2].highlight).toBe(false);
  expect(volumeBubbles(rows(), 0, 60000, { ...style(), gradient: false, highlightLargest: false })
    .every(b => b.alpha === .7 && !b.highlight)).toBe(true);
});
it("validates ranges and exposes all persisted settings through the native schema", () => {
  const defaults = defaultBubbles();
  expect(bubbleInputs().map(input => input.key).sort()).toEqual(Object.keys(defaults).sort());
  expect(resolveBubbles({ ...defaults })).toEqual(defaults);
  for (const bad of [{ volumeMax: -1 }, { minRadius: 30, maxRadius: 5 }, { volumeMin: 5, volumeMax: 2 },
    { maxVisible: 501 }, { ticksPerRow: 1.5 }, { tickSize: -1 }, { hideBelow: NaN }, { mode: "bad" }, { rows: "bad" }, { gradient: "yes" }, { buyColor: "bad" }])
    expect(() => resolveBubbles(bad)).toThrow();
  expect(INDICATORS.find(item => item.id === "volume-bubbles")?.nativeId).toBe("af-volume-bubbles");
});
it("uses canonical manual rows for tiny prices and supports inverted scale projection", () => {
  const setting = { ...style(), rows: "Manual" as const, tickSize: 1e-10, ticksPerRow: 8 };
  const step = bubbleStep(args(), setting);
  expect(step).toBe(8e-10);
  expect(bubbleStep(args(), { ...setting, tickSize: .1, ticksPerRow: 3 })).toBe(.3);
  const h = history([tick("tiny", 1000, 2.4e-9, 4)]);
  expect(h.read({ step, ratio: 3 })[0].levels[0]).toMatchObject({ price: 2.4e-9, upperPrice: 3.2e-9 });
});
function canvas() {
  const fills: string[] = [], arcs: number[][] = [], texts: string[] = [];
  const ctx = { fillStyle: "", strokeStyle: "", globalAlpha: 1, lineWidth: 1, textAlign: "", textBaseline: "", font: "",
    beginPath() {}, moveTo() {}, closePath() {}, stroke() {}, fill() { fills.push(this.fillStyle); },
    arc(...values: number[]) { arcs.push(values); }, fillRect() {}, strokeRect() {},
    fillText(value: string) { texts.push(value); }, measureText(value: string) { return { width: value.length * 6 }; } };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, arcs, texts };
}
it.each([false, true])("paints side-weighted pie sectors and the hovered row readout, inverted=%s", invert => {
  const channel = { history: history(trades.slice(0, 2)), style: { ...style(), mode: "Delta" as const, rows: "Manual" as const, tickSize: 1, ticksPerRow: 1 }, message: "partial" };
  const a = args(invert), c = canvas();
  const painted = paintVolumeBubbles(c.ctx, a, channel);
  expect(c.fills).toEqual([channel.style.buyColor, channel.style.sellColor]);
  expect(c.arcs[0][4] - c.arcs[0][3]).toBeCloseTo(Math.PI * 2 * .8);
  expect(bubbleAtPoint(painted, painted[0].x, painted[0].y)?.volume).toBe(10);
  expect(bubbleAtPoint(painted, 499, 299)).toBeUndefined();
  a.cursor = { x: painted[0].x, y: painted[0].y };
  paintVolumeBubbles(c.ctx, a, channel);
  expect(c.texts).toContain("Buy 8 · Sell 2");
  expect(c.texts).toContain("Volume 10 · Δ 60.0%");
});
it("uses neutral Total color and suppresses labels/tooltips when disabled", () => {
  const c = canvas();
  paintVolumeBubbles(c.ctx, args(), { history: history(trades.slice(0, 2)), style: { ...style(), rows: "Manual", tickSize: 1, ticksPerRow: 1,
    colorBySide: false, tooltip: false, labels: false }, message: "partial" });
  expect(c.fills).toEqual([style().neutralColor]); expect(c.texts).toEqual([]);
});

function harness(live = true) {
  let current = [...trades], changed: ((tick: Tick) => void) | undefined, revision = 0, through = 60000;
  let archiveChanged: (() => void) | undefined;
  const off = vi.fn(), offArchive = vi.fn();
  let data: BubblesChannel | null = null;
  const instance = bubblesDescriptor(() => current, (_symbol, callback) => { changed = callback; return off; }, {
    revision: () => revision, subscribe: (_symbol, callback) => { archiveChanged = callback; return offArchive; },
    replay: () => ({ trades: current.filter(tick => tick.time < through), through, label: "REPLAY partial" }),
  }).create();
  const context = { symbol: "KRK:BTC/USD", timeframe: "1m", live, bars: () => [candle(0), candle(60000)], emit() {},
    pushData(value: BubblesChannel | null) { data = value; }, setStatus() {} } as unknown as NativeIndicatorContext;
  instance.start(context, {});
  return { instance, context, data: () => data, off, offArchive, changed: (t: Tick) => changed!(t),
    replace(trades: Tick[]) { current = trades; revision++; archiveChanged?.(); }, seek(value: number) { through = value; instance.onBars(); } };
}
it("collects live updates in a bounded batch and fences pending callbacks after suspend/stop", async () => {
  vi.useFakeTimers();
  const h = harness(), channel = h.data()!, repaint = vi.fn(); channel.repaint = repaint;
  h.changed(tick("live", 62000, 100, 2)); h.changed(tick("other", 63000, 100, 100));
  await vi.advanceTimersByTimeAsync(50);
  expect(repaint).toHaveBeenCalledTimes(1);
  expect(channel.history!.coverage.trades).toBe(7);
  const retained = channel.history;
  h.instance.setInputs({ mode: "Delta", buyColor: "#112233" });
  expect(channel.history).toBe(retained);
  expect(channel.history!.coverage.trades).toBe(7);
  h.changed({ ...tick("wrong-market", 63000, 100, 100), symbol: "BTCUSDT" });
  expect(channel.history!.coverage.trades).toBe(7);
  h.changed(tick("late", 64000, 100, 1)); h.instance.suspend();
  await vi.advanceTimersByTimeAsync(100);
  expect(h.data()).toBeNull(); expect(h.off).toHaveBeenCalledTimes(1);
  h.changed(tick("stale", 65000, 100, 1));
  h.instance.resume(); expect(h.data()!.history!.coverage.trades).toBe(5);
  h.instance.stop(); expect(h.data()).toBeNull(); expect(h.offArchive).toHaveBeenCalledTimes(2);
});
it("rebuilds recorded prefixes on backward Replay seeks and never subscribes to live ticks", () => {
  const h = harness(false);
  expect(h.data()!.history!.coverage.trades).toBe(4);
  h.seek(120000); expect(h.data()!.history!.coverage.trades).toBe(5);
  h.seek(60000); expect(h.data()!.history!.coverage.trades).toBe(4);
  expect(h.data()!.message).toContain("REPLAY"); expect(h.off).not.toHaveBeenCalled(); h.instance.stop();
});
it("clears archived quantities on revision changes, invalid settings, and missing replay sources", () => {
  const h = harness();
  h.replace([]); expect(h.data()!.history!.coverage.trades).toBe(0);
  h.instance.setInputs({ maxVisible: 501 }); expect(h.data()!.history).toBeUndefined(); expect(h.data()!.message).toMatch(/unavailable/);
  h.instance.setInputs({ maxVisible: 10 }); expect(h.data()!.history!.coverage.trades).toBe(0); h.instance.stop();
  let data: BubblesChannel | null = null;
  const instance = bubblesDescriptor(() => trades, () => () => {}).create();
  instance.start({ ...h.context, live: false, pushData: value => { data = value as BubblesChannel; } } as NativeIndicatorContext, {});
  expect((data as unknown as BubblesChannel).message).toMatch(/Replay needs/);
  expect((data as unknown as BubblesChannel).history).toBeUndefined(); instance.stop();
});
