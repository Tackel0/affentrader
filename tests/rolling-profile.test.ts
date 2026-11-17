import { afterEach, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, RendererLayerArgs } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { defaultRollingProfile, resolveRollingProfile, rollingProfileBars, rollingProfileInputs, RollingProfileCache } from "@/lib/orderflow/rollingProfile";
import { rollingProfileDescriptor } from "@/lib/orderflow/rollingProfileIndicator";
import { paintVolumeProfiles, type VolumeProfileChannel } from "@/lib/orderflow/volumeProfileRenderer";
import { clearSessionProfileSurface, publishSessionProfileSurface, readSessionProfileSurfaces } from "@/lib/orderflow/sessionProfileReadout";

const base = Date.UTC(2026, 10, 4, 12), minute = 60000, symbol = "BTCUSDT";
const tick = (id: string, offset: number, price = 100, quantity = 1, side: Tick["side"] = "buy"): Tick => ({ id, symbol, time: base + offset, price, quantity, side, simulated: false });
const bars = (...offsets: number[]) => offsets.map(offset => ({ time: base + offset, open: 100, high: 150, low: 50, close: 99, volume: 999 }));
afterEach(() => vi.useRealTimers());

it("uses 100/24/30/70 defaults and exposes only applicable rolling controls", () => {
  expect(defaultRollingProfile()).toMatchObject({ bars: 100, rows: 24, widthPercent: 30, valueAreaPercent: 70, placement: "Session end" });
  const inputs = rollingProfileInputs();
  expect(inputs.find(i => i.key === "rows")?.defval).toBe(24);
  expect(inputs.some(i => /session|developing|extend|rowSize|placement/i.test(i.key))).toBe(false);
  for (const values of [{ bars: 0 }, { bars: 1.5 }, { bars: 50001 }, { rows: 501 }, { widthPercent: NaN }, { valueAreaPercent: 0 }, { showPoc: "yes" }, { buyColor: "red" }]) expect(() => resolveRollingProfile(values)).toThrow();
});
it("slides the newest N loaded bars and reveals only completed Replay candles", () => {
  expect(rollingProfileBars(bars(0, minute, 2 * minute), "1m", 2).map(b => b.time)).toEqual([base + minute, base + 2 * minute]);
  expect(rollingProfileBars(bars(0, minute, 2 * minute), "1m", 2, base + 2 * minute).map(b => b.time)).toEqual([base, base + minute]);
  expect(rollingProfileBars(bars(0), "1m", 100, base)).toEqual([]);
  for (const args of [[bars(0), "100T", 1], [[...bars(0, minute)].reverse(), "1m", 2], [bars(0), "1m", 0]] as const)
    expect(() => rollingProfileBars(args[0], args[1], args[2])).toThrow();
});
it("preserves quantities independently of candle direction, volume and print counts", () => {
  const model = new RollingProfileCache(), source = [tick("buy", 1, 100, .1), tick("sell", minute + 1, 110, .2, "sell"), tick("edge", 2 * minute, 120, 1000)];
  const r = model.read(bars(0, minute), source, "1m", resolveRollingProfile({ rows: 2 }), symbol);
  expect(r.model.retained).toBe(2); expect(r.model.sessions[0].rows).toEqual([{ price: 100, buy: .1, sell: 0, total: .1 }, { price: 105, buy: 0, sell: .2, total: .2 }]);
  expect(r.model.sessions[0].valueArea.total).toBeCloseTo(.3); expect(r.model.sessions[0].valueArea.poc).toBe(1);
  expect(r).toMatchObject({ bars: 2, requested: 100, from: base, to: base + 2 * minute });
});
it("does not assign archived executions to missing chart candles inside the selected span", () => {
  const model = new RollingProfileCache();
  const r = model.read(bars(0, 2 * minute), [tick("a", 1), tick("missing", minute + 1, 110, 999), tick("c", 2 * minute + 1)], "1m", defaultRollingProfile(), symbol);
  expect(r.model.retained).toBe(2); expect(r.model.sessions[0].valueArea.total).toBe(2);
});
it("recomputes same-endpoint corrections and isolates empty/new markets", () => {
  const model = new RollingProfileCache(), style = defaultRollingProfile();
  expect(model.read(bars(0), [tick("a", 1, 100, 3)], "1m", style, symbol).model.sessions[0].valueArea.total).toBe(3);
  expect(model.read(bars(0), [tick("b", 1, 110, 7)], "1m", style, symbol).model.sessions[0].valueArea.total).toBe(7);
  expect(model.read(bars(0), [], "1m", style, symbol).model.sessions).toEqual([]);
  expect(() => model.read(bars(0), [{ ...tick("wrong", 1), symbol: "ETHUSDT" }], "1m", style, symbol)).toThrow(/combine markets/);
});

function harness(live = true, archive?: Parameters<typeof rollingProfileDescriptor>[3], initialBars = bars(0, minute)) {
  let input = [tick("seed", 1, 100, 3)], loaded = initialBars, receive: ((t: Tick) => void) | undefined, channel: VolumeProfileChannel | null = null;
  const read = vi.fn(() => input), subscribe = vi.fn((_s: string, next: (t: Tick) => void) => { receive = next; return vi.fn(); });
  const native = rollingProfileDescriptor(read, subscribe, () => 0, archive).create();
  const context = { id: "rolling-test", symbol, timeframe: "1m", live, bars: () => loaded, emit() {}, pushData: (c: VolumeProfileChannel | null) => { channel = c; }, setStatus() {} } as unknown as NativeIndicatorContext;
  native.start(context, {});
  return { native, channel: () => channel!, read, subscribe, receive: () => receive!, replace: (value: Tick[]) => { input = value; }, load: (value: typeof loaded) => { loaded = value; } };
}
it("retains trades beyond the display tape and recalculates Bars on edits and live closes", () => {
  vi.useFakeTimers(); const h = harness(); h.channel().repaint = vi.fn();
  const next = tick("new", minute + 1, 110, 5, "sell"); h.replace([next]); h.receive()(next); h.receive()(next); vi.runAllTimers();
  expect(h.channel().current!.model!.retained).toBe(2);
  h.native.setInputs({ bars: 1 }); expect(h.channel().current!.model!.sessions[0].valueArea.total).toBe(5);
  h.native.setInputs({ bars: 2 }); expect(h.channel().current!.model!.sessions[0].valueArea.total).toBe(8);
  h.load(bars(0, minute, 2 * minute)); h.native.setInputs({ bars: 1 }); expect(h.channel().current!.model!.sessions).toEqual([]); h.native.stop();
});
it("clears invalid settings and fences callbacks from suspended instances", () => {
  vi.useFakeTimers(); const h = harness(), old = h.receive();
  h.native.setInputs({ rows: -1 }); expect(h.channel().current!.model).toBeUndefined(); expect(h.channel().current!.message).toContain("unavailable");
  h.native.suspend(); old(tick("stale", 1, 100, 999)); vi.runAllTimers(); expect(h.channel()).toBeNull();
  h.replace([tick("resume", minute + 1, 110, 4)]); h.native.resume(); h.native.setInputs({}); old(tick("obsolete", 1, 100, 999)); vi.runAllTimers();
  expect(h.channel().current!.model!.sessions[0].valueArea.total).toBe(4); h.native.stop();
});
it("isolates two same-symbol instances with different window settings", () => {
  const a = harness(), b = harness(); a.native.setInputs({ bars: 1 });
  expect(a.channel().current!.model!.retained).toBe(0); expect(b.channel().current!.model!.retained).toBe(1);
  a.native.stop(); expect(b.channel().current!.model!.retained).toBe(1); b.native.stop();
});
it("rebuilds archived windows through backward seeks without live reads/subscriptions", () => {
  const source = [tick("past", 1, 100, 3), tick("future", minute + 1, 110, 999)]; let through = base + minute, available = true;
  const h = harness(false, { replay: () => available ? { through, trades: source.filter(t => t.time < through), label: "recorded prefix" } : undefined });
  expect(h.channel().current!.model!.sessions[0].valueArea.total).toBe(3);
  through = base + 2 * minute; h.native.onBars(); expect(h.channel().current!.model!.sessions[0].valueArea.total).toBe(1002);
  through = base + minute; h.native.onBars(); expect(h.channel().current!.model!.sessions[0].valueArea.total).toBe(3);
  available = false; h.native.onBars(); expect(h.channel().current!.model).toBeUndefined(); expect(h.channel().current!.message).toContain("Replay needs");
  expect(h.read).not.toHaveBeenCalled(); expect(h.subscribe).not.toHaveBeenCalled(); h.native.stop();
});
it("shows a current-window readout and refuses to invent historical rolling snapshots", () => {
  const h = harness(), token = Symbol("rolling"); publishSessionProfileSurface("rolling-cell", token, { context: h.channel().context!, payload: h.channel().current! });
  try {
    const context = { symbol, timeframe: "1m", epoch: 0, replay: false };
    const ready = readSessionProfileSurfaces("rolling-cell", context, base, ["rolling-test"])[0];
    expect(ready.title).toContain("Rolling Volume Profile"); expect(ready.rows.find(r => r.label === "Window collected volume")?.value).toBe("3");
    expect(ready.message).toContain("not historical rolling-window signals");
    const outside = readSessionProfileSurfaces("rolling-cell", context, base - minute, ["rolling-test"])[0]; expect(outside.status).toBe("empty");
    expect(readSessionProfileSurfaces("rolling-cell", { ...context, epoch: 1 }, base, ["rolling-test"])).toEqual([]);
  } finally { clearSessionProfileSurface("rolling-cell", token); h.native.stop(); }
});
it("uses the requested rolling width at the last bar instead of capping it at 220px or the last observed execution", () => {
  const loaded = Array.from({ length: 10 }, (_, i) => bars(i * minute)[0]), h = harness(true, undefined, loaded);
  const rectangles: number[][] = [], ctx = { save() {}, restore() {}, fillRect: (...v: number[]) => rectangles.push(v), beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {}, measureText: () => ({ width: 10 }) } as unknown as CanvasRenderingContext2D;
  const args = { coords: { width: 1100, timeToX: (t: number) => (t - base) / minute * 100, priceToY: (p: number) => 300 - p }, bounds: { top: 0, height: 400 }, scale: {}, theme: { background: "white", textColor: "black" } } as unknown as RendererLayerArgs;
  paintVolumeProfiles(ctx, args, h.channel().current!, () => true);
  expect(Math.max(...rectangles.map(v => v[2]))).toBeCloseTo(298.2); expect(rectangles.some(v => Math.abs(v[0] + v[2] - 997) < 1e-6)).toBe(true); h.native.stop();
});
