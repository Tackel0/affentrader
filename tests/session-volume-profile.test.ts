import { describe, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, RendererLayerArgs } from "@luxalgo/vela";
import type { Tick, VolumeProfileRow } from "@/types/trading";
import { buildSessionVolumeProfiles, volumeValueArea, MAX_PROFILE_TRADES } from "@/lib/orderflow/volumeProfileModel";
import { defaultVolumeProfile, resolveVolumeProfile, volumeProfileInputs } from "@/lib/orderflow/volumeProfileSettings";
import { paintVolumeProfiles, type VolumeProfilePayload, type VolumeProfileChannel } from "@/lib/orderflow/volumeProfileRenderer";
import { sessionProfileDescriptor } from "@/lib/orderflow/volumeProfileIndicator";
import { studyArguments } from "@/lib/chart/statusLine";

const minute = 60000, day = 86400000, instant = (date: string) => Date.parse(`${date}Z`);
const tick = (id: string, time: number, price: number, quantity = 1, side: "buy" | "sell" = "buy", simulated = false): Tick =>
  ({ id, time, price, quantity, side, simulated, symbol: "BTCUSDT" });
const preferences = () => ({ ...defaultVolumeProfile(), rowSize: 1 });
const samples = [tick("a", 0, 100, 2), tick("b", minute, 101, 5, "sell"), tick("c", 2 * minute, 102, 3), tick("d", 3 * minute, 103)];
const rows = (volumes: number[]): VolumeProfileRow[] => volumes.map((total, index) => ({ price: 100 + index, buy: total, sell: 0, total }));
function canvas() {
  const calls: Array<{ kind: string; values: unknown[]; fill: string; stroke: string }> = [];
  const ctx = { fillStyle: "", strokeStyle: "", globalAlpha: 1, save() {}, restore() {}, beginPath() {},
    moveTo() {}, lineTo() {}, stroke() { calls.push({ kind: "line", values: [], fill: this.fillStyle, stroke: this.strokeStyle }); },
    fillRect(...values: number[]) { calls.push({ kind: "rect", values, fill: this.fillStyle, stroke: this.strokeStyle }); },
    fillText(...values: unknown[]) { calls.push({ kind: "text", values, fill: this.fillStyle, stroke: this.strokeStyle }); },
    measureText(text: string) { return { width: text.length * 6 }; } };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}
const args = (inverted = false) => ({ bounds: { top: 0, height: 300 }, scale: { min: 95, max: 110 }, theme: { textColor: "#d1d4dc" },
  coords: { width: 1000, timeToX: (time: number) => 20 + time / day * 900, priceToY: (price: number) => inverted ? (price - 95) * 20 : (110 - price) * 20 } }) as unknown as RendererLayerArgs;
function harness(live = true) {
  let trades: readonly Tick[] = samples;
  const pushes: Array<VolumeProfilePayload | null> = [], statuses: string[] = [];
  const context = { symbol: "BTCUSDT", live, emit() {}, pushData: (data: VolumeProfileChannel | null) => {
    pushes.push(data?.current ?? null); if (data) data.repaint = () => pushes.push(data.current ?? null);
  }, setStatus: (status: string) => statuses.push(status) } as unknown as NativeIndicatorContext;
  const descriptor = sessionProfileDescriptor(() => trades), instance = descriptor.create();
  instance.start(context, { rowSize: 1 });
  return { descriptor, instance, pushes, statuses, replace: (next: readonly Tick[]) => { trades = next; } };
}

describe("session volume profiles from retained executions", () => {
  it("projects canonical histogram/VAH edges and POC centers and labels tiny prices without rounding to zero", () => {
    const style = { ...preferences(), rowSize: .1, valueAreaPercent: 100 };
    const model = buildSessionVolumeProfiles([tick("a", 0, .2), tick("b", minute, .3, 2)], style, "BTCUSDT"), view = args(), { ctx } = canvas();
    const project = vi.fn((price: number) => price * 500); view.coords.priceToY = project;
    paintVolumeProfiles(ctx, view, { model, style });
    expect(project.mock.calls.map(call => call[0])).toContain(.35);
    expect(project.mock.calls.map(call => call[0])).toContain(.4);
    expect(project.mock.calls.map(call => call[0])).not.toContain(.30000000000000004);
    const tinyStyle = { ...style, rowSize: 1e-12 }, tiny = buildSessionVolumeProfiles([tick("tiny", 0, 3e-12)], tinyStyle, "BTCUSDT");
    const small = canvas(); view.coords.priceToY = () => 100; paintVolumeProfiles(small.ctx, view, { model: tiny, style: tinyStyle });
    expect(small.calls.some(call => call.kind === "text" && call.values[0] === "POC 3.5e-12")).toBe(true);
  });
  it("publishes a native precision failure without stale profile data and recovers after changing row size", () => {
    const h = harness(); h.instance.setInputs({ rowSize: 1e-20 });
    expect(h.pushes.at(-1)).toMatchObject({ message: expect.stringMatching(/precision/i) });
    expect(h.pushes.at(-1)?.model).toBeUndefined();
    h.instance.setInputs({ rowSize: 1 }); expect(h.pushes.at(-1)?.message).toBeUndefined();
    expect(h.pushes.at(-1)?.model?.sessions[0].valueArea.total).toBe(11); h.instance.stop();
  });
  it("keeps session-profile legend arguments compact without leaking display colors or false toggles", () => {
    expect(studyArguments({ rows: 24, sessionZone: "Europe/Berlin", valueAreaPercent: 68, showPoc: false, buyColor: "#2962ff" }, "session-profile")).toBe("24 rows 68% Europe/Berlin");
    expect(studyArguments({ rowSize: 10 }, "session-profile")).toBe("10 / row 70% UTC");
    expect(studyArguments({ length: 0, enabled: false, color: "#ffffff" })).toBe("0 false");
  });
  it("conserves actual buy/sell quantities over dense rows and independently anchored sessions", () => {
    const model = buildSessionVolumeProfiles([...samples, tick("e", day, 200, 8)], preferences(), "BTCUSDT");
    expect(model.sessions).toHaveLength(2); expect(model.sessions[0].start).toBe(0); expect(model.sessions[1].start).toBe(day);
    expect(model.sessions[0].rows).toEqual([{ price: 100, buy: 2, sell: 0, total: 2 }, { price: 101, buy: 0, sell: 5, total: 5 },
      { price: 102, buy: 3, sell: 0, total: 3 }, { price: 103, buy: 1, sell: 0, total: 1 }]);
    expect(model.sessions[0].valueArea.total).toBe(11); expect(model.sessions[0].tradeCount).toBe(4);
    expect(model.sessions[0].firstTrade).toBe(0); expect(model.sessions[0].lastTrade).toBe(3 * minute);
  });
  it("uses inclusive opening/exclusive ending timestamps and the opening date for overnight sessions", () => {
    const style = { ...preferences(), sessionStartMinutes: 18 * 60, sessionMinutes: 23 * 60 };
    const model = buildSessionVolumeProfiles([tick("before", 18 * 60 * minute - 1, 90), tick("open", 18 * 60 * minute, 100),
      tick("end", day + 17 * 60 * minute, 110), tick("night", day + 16 * 60 * minute, 102)], style, "BTCUSDT");
    expect(model.sessions).toHaveLength(1); expect(model.sessions[0].date).toBe("1970-01-01"); expect(model.sessions[0].tradeCount).toBe(2);
  });
  it("honors DST sessions and filters weekend openings without interpreting holidays", () => {
    const style = { ...preferences(), sessionZone: "America/New_York" };
    const model = buildSessionVolumeProfiles([tick("first", instant("2026-11-01T05:15:00"), 100), tick("second", instant("2026-11-01T06:15:00"), 101)], style, "BTCUSDT");
    expect(model.sessions[0].end - model.sessions[0].start).toBe(25 * 3600000); expect(model.sessions[0].tradeCount).toBe(2);
    expect(buildSessionVolumeProfiles([tick("weekend", instant("2026-11-01T05:15:00"), 100)], { ...style, weekdaysOnly: true }, "BTCUSDT").sessions).toEqual([]);
  });
  it("deduplicates executions, skips malformed trades and separates simulation from the newest real source", () => {
    const invalid = [tick("nan", 0, NaN), tick("negative", 0, 100, -2), tick("time", Infinity, 100), { ...tick("side", 0, 100), side: "unknown" } as unknown as Tick];
    const model = buildSessionVolumeProfiles([...samples, samples[0], ...invalid, tick("oldsim", -minute, 100, 900, "buy", true)], preferences(), "BTCUSDT");
    expect(model.retained).toBe(4); expect(model.discarded).toBe(6); expect(model.sessions[0].valueArea.total).toBe(11); expect(model.source).toBe("exchange");
    const simulated = buildSessionVolumeProfiles([...samples, tick("sim", 4 * minute, 100, 7, "sell", true)], preferences(), "BTCUSDT");
    expect(simulated.source).toBe("simulation"); expect(simulated.retained).toBe(1); expect(simulated.sessions[0].valueArea.total).toBe(7);
  });
  it("keeps zero-volume price gaps and fixes manual grids independently of viewport", () => {
    const model = buildSessionVolumeProfiles([tick("a", 0, 100), tick("b", minute, 103)], preferences(), "BTCUSDT");
    expect(model.sessions[0].rows.map(row => row.total)).toEqual([1, 0, 0, 1]);
    const encoded = JSON.stringify(model), first = canvas(), second = canvas(), view = args();
    paintVolumeProfiles(first.ctx, view, { model, style: preferences() }); view.scale.min = 99; view.scale.max = 104;
    paintVolumeProfiles(second.ctx, view, { model, style: preferences() }); expect(JSON.stringify(model)).toBe(encoded);
  });
  it("stops VA before overshooting its target and resolves adjacent ties by distance then upper price", () => {
    expect(volumeValueArea(rows([2, 5, 3, 1]), 70)).toEqual({ poc: 1, low: 1, high: 1, volume: 5, total: 11 });
    expect(volumeValueArea(rows([1, 2, 4, 2, 1]), 60)).toMatchObject({ poc: 2, low: 2, high: 3, volume: 6 });
    expect(volumeValueArea(rows([1, 2, 4, 2, 1]), 80)).toMatchObject({ poc: 2, low: 1, high: 3, volume: 8 });
    expect(volumeValueArea(rows([1, 2, 4, 2, 1]), 100)).toMatchObject({ low: 0, high: 4, volume: 10 });
    expect(volumeValueArea(rows([5, 1, 5]), 1)?.poc).toBe(0); expect(volumeValueArea([], 70)).toBeNull();
  });
  it("rejects capacity and indistinguishable precision instead of painting partial profiles", () => {
    expect(buildSessionVolumeProfiles([tick("a", 0, 1), tick("b", minute, 2000)], preferences(), "BTCUSDT").sessions[0].rows).toHaveLength(2000);
    expect(() => buildSessionVolumeProfiles([tick("a", 0, 1), tick("b", minute, 2001)], preferences(), "BTCUSDT")).toThrow(/2,000/);
    expect(() => buildSessionVolumeProfiles(samples, { ...preferences(), rowSize: 1e-20 }, "BTCUSDT")).toThrow(/precision/);
    expect(() => buildSessionVolumeProfiles(Array(MAX_PROFILE_TRADES + 1).fill(samples[0]), preferences(), "BTCUSDT")).toThrow(/100,000/);
    expect(() => buildSessionVolumeProfiles([tick("a", 0, 100, Number.MAX_VALUE), tick("b", minute, 100, Number.MAX_VALUE)], preferences(), "BTCUSDT")).toThrow(/precision/);
  });
  it("provides bounded native input/style metadata and preserves explicit false values and legacy defaults", () => {
    expect(resolveVolumeProfile({ rows: 24, showPoc: false, color: "#ffffff" })).toEqual({ ...defaultVolumeProfile(), rows: 24, showPoc: false });
    for (const input of [{ rows: NaN }, { rows: 1 }, { rowSize: -1 }, { sessionZone: "Bad/Zone" }, { sessionMinutes: 0 }, { valueAreaPercent: 101 }]) expect(() => resolveVolumeProfile(input)).toThrow();
    const schema = volumeProfileInputs(); expect(new Set(schema.map(input => input.key)).size).toBe(schema.length);
    expect(schema.map(input => input.key)).toEqual(expect.arrayContaining(["tradingHours", "customStart", "customEnd"]));
    expect(schema.find(input => input.key === "extendPoc")).toMatchObject({tab:"Style",defval:false});
    expect(schema.find(input => input.key === "sessionZone")?.options).toContain("Europe/Berlin");
  });
  it("paints proportional side volumes, colored value area and separate POC/VAH/VAL labels", () => {
    const style = { ...preferences(), valueAreaPercent: 100 }, model = buildSessionVolumeProfiles(samples, style, "BTCUSDT"), { ctx, calls } = canvas();
    paintVolumeProfiles(ctx, args(), { model, style });
    const bars = calls.filter(call => call.kind === "rect" && call.fill !== "#131722"); expect(bars).toHaveLength(4);
    expect(bars[0].fill).toBe(style.buyColor); expect(bars[1].fill).toBe(style.sellColor);
    expect(Number(bars[1].values[2]) / Number(bars[0].values[2])).toBeCloseTo(2.5);
    expect(calls.filter(call => call.kind === "line")).toHaveLength(3);
    for (const title of ["POC", "VAH", "VAL", "partial history"]) expect(calls.some(call => call.kind === "text" && String(call.values[0]).includes(title))).toBe(true);
  });
  it("supports Delta/Total, reverse anchoring and inverted price projection", () => {
    const style = preferences(), model = buildSessionVolumeProfiles(samples, style, "BTCUSDT"), standard = canvas(), reverse = canvas();
    paintVolumeProfiles(standard.ctx, args(), { model, style });
    paintVolumeProfiles(reverse.ctx, args(true), { model, style: { ...style, placement: "Session end", volumeMode: "Delta" } });
    expect(standard.calls.filter(call => call.kind === "rect").map(call => Number(call.values[3]))).toEqual(reverse.calls.filter(call => call.kind === "rect").map(call => Number(call.values[3])));
    expect(Number(reverse.calls.find(call => call.kind === "rect")!.values[0])).toBeGreaterThan(Number(standard.calls.find(call => call.kind === "rect")!.values[0]));
    const total = canvas(); paintVolumeProfiles(total.ctx, args(), { model, style: { ...style, volumeMode: "Total" } }); expect(total.calls.filter(call => call.kind === "rect" && call.fill !== "#131722")).toHaveLength(4);
  });
  it("honors independent visibility and labels actual simulation coverage", () => {
    const style = { ...preferences(), showHistogram: false, showPoc: false, showValueArea: false, showLabels: false };
    const model = buildSessionVolumeProfiles([tick("sim", 0, 100, 1, "buy", true)], style, "BTCUSDT"), { ctx, calls } = canvas();
    paintVolumeProfiles(ctx, args(), { model, style }); expect(calls.filter(call => call.fill !== "#131722").every(call => call.kind === "text")).toBe(true);
    expect(calls.some(call => String(call.values[0]).includes("SIMULATED"))).toBe(true);
  });
  it("anchors a developing right-side profile at the latest observed trade and completed profiles at their close", () => {
    const style = { ...preferences(), placement: "Session end" as const }, developing = canvas(), completed = canvas();
    paintVolumeProfiles(developing.ctx, args(), { model: buildSessionVolumeProfiles(samples, style, "BTCUSDT"), style });
    paintVolumeProfiles(completed.ctx, args(), { model: buildSessionVolumeProfiles([...samples, tick("next-session", day + minute, 104)], style, "BTCUSDT"), style });
    expect(Number(developing.calls.find(call => call.kind === "rect")!.values[0])).toBeLessThan(100);
    expect(Number(completed.calls.find(call => call.kind === "rect")!.values[0])).toBeGreaterThan(800);
  });
  it("reuses unchanged models, invalidates execution/setting revisions and recovers from a capacity error", () => {
    const h = harness(), first = h.pushes.at(-1)!; h.instance.onBars(); expect(h.pushes.at(-1)).toBe(first);
    h.replace([...samples, tick("new", 4 * minute, 104, 10)]); h.instance.onBars(); expect(h.pushes.at(-1)!.model!.sessions[0].valueArea.total).toBe(21);
    h.instance.setInputs({ rowSize: .000001 }); expect(h.pushes.at(-1)!.message).toMatch(/2,000/);
    h.instance.setInputs({ rowSize: 1, showPoc: false }); expect(h.pushes.at(-1)!.message).toBeUndefined(); expect(h.pushes.at(-1)!.style.showPoc).toBe(false);
  });
  it("separates coincident POC/VA labels without moving their price lines", () => {
    const style = preferences(), model = buildSessionVolumeProfiles([tick("single", 0, 100)], style, "BTCUSDT"), view = args();
    view.coords.priceToY = price => 150 - (price - 100) * .01;
    const { ctx, calls } = canvas(); paintVolumeProfiles(ctx, view, { model, style });
    const positions = calls.filter(call => call.kind === "text" && /^(POC|VAH|VAL) /.test(String(call.values[0]))).map(call => Number(call.values[2])).sort((a, b) => a - b);
    expect(positions).toHaveLength(3); expect(positions[1] - positions[0]).toBeGreaterThanOrEqual(12); expect(positions[2] - positions[1]).toBeGreaterThanOrEqual(12);
    expect(calls.filter(call => call.kind === "line")).toHaveLength(3);
  });
  it("clears suspended/removed layers and restarts without leaking an earlier market", () => {
    const h = harness(); h.instance.suspend(); expect(h.pushes.at(-1)).toBeNull(); const count = h.pushes.length;
    h.instance.onBars(); expect(h.pushes).toHaveLength(count); h.instance.resume(); expect(h.pushes.at(-1)!.model!.retained).toBe(4);
    h.instance.stop(); expect(h.pushes.at(-1)).toBeNull(); const stopped = h.pushes.length;
    h.instance.resume(); h.instance.onBars(); expect(h.pushes).toHaveLength(stopped);
  });
  it("refuses recorded-trade claims during Replay and distinguishes empty/filtered sessions", () => {
    const replay = harness(false); expect(replay.pushes.at(-1)!.model).toBeUndefined(); expect(replay.pushes.at(-1)!.message).toMatch(/Replay/);
    const live = harness(); live.replace([]); live.instance.onBars(); expect(live.pushes.at(-1)!.message).toMatch(/Collecting/);
    live.replace(samples); live.instance.setInputs({ sessionStartMinutes: 120, sessionMinutes: 10 }); expect(live.pushes.at(-1)!.message).toMatch(/inside these sessions/);
  });
  it("mounts an empty native output, batches trade bursts and cancels subscriptions/timers through hide/remove", () => {
    vi.useFakeTimers();
    try {
      let trades = samples, callback: (() => void) | undefined, unsubscribed = 0;
      const pushes: Array<VolumeProfilePayload | null> = [], emit = vi.fn();
      const descriptor = sessionProfileDescriptor(() => trades, (_symbol, changed) => { callback = changed; return () => { unsubscribed++; }; });
      const nativePush = vi.fn((data: VolumeProfileChannel | null) => {
        pushes.push(data?.current ?? null); if (data) data.repaint = () => pushes.push(data.current ?? null);
      });
      const instance = descriptor.create(), context = { symbol: "BTCUSDT", live: true, emit, pushData: nativePush, setStatus() {} } as unknown as NativeIndicatorContext;
      instance.start(context, { rowSize: 1 }); expect(emit).toHaveBeenCalledWith({});
      const first = pushes.length; trades = [...samples, tick("live", 4 * minute, 104, 9)];
      callback!(); callback!(); callback!(); vi.advanceTimersByTime(15); expect(pushes).toHaveLength(first);
      vi.advanceTimersByTime(1); expect(pushes).toHaveLength(first + 1); expect(pushes.at(-1)!.model!.retained).toBe(5);
      expect(nativePush).toHaveBeenCalledTimes(1);
      callback!(); const old = callback!; instance.suspend(); expect(unsubscribed).toBe(1); expect(pushes.at(-1)).toBeNull();
      vi.runAllTimers(); expect(pushes.at(-1)).toBeNull(); instance.resume(); const resumed = pushes.length;
      old(); vi.runAllTimers(); expect(pushes).toHaveLength(resumed);
      callback!(); instance.stop(); vi.runAllTimers(); expect(unsubscribed).toBe(2); expect(pushes.at(-1)).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("distinguishes an unavailable Yahoo trade feed from a currently empty execution stream", () => {
    const instance = sessionProfileDescriptor(() => []).create(); let channel: VolumeProfileChannel | null = null;
    const context = { symbol: "YF:AAPL", live: true, emit() {}, pushData: (value: VolumeProfileChannel | null) => { channel = value; }, setStatus() {} } as unknown as NativeIndicatorContext;
    instance.start(context, {}); expect((channel as VolumeProfileChannel | null)?.current?.message).toMatch(/no classified trade feed/); instance.stop();
  });
  it("keeps default SVP clean without node clutter, rounds floating-point labels cleanly, and anchors zoomed-in histograms visibly", () => {
    expect(defaultVolumeProfile().showNodes).toBe(false);
    const style = { ...defaultVolumeProfile(), rows: 12 };
    const zoomedSamples = [
      tick("z1", 16 * 3600000, 26761.135, 3, "buy"),
      tick("z2", 16 * 3600000 + minute, 26767.675, 8, "sell"),
      tick("z3", 16 * 3600000 + 2 * minute, 26781.844999999998, 4, "buy"),
    ];
    const model = buildSessionVolumeProfiles(zoomedSamples, style, "BTCUSDT");
    const view = {
      bounds: { top: 0, height: 300 },
      scale: { min: 26700, max: 26850 },
      theme: { textColor: "#d1d4dc", background: "#131722" },
      coords: {
        width: 390,
        timeToX: (time: number) => (time - 16 * 3600000) / minute * 40 + 40,
        priceToY: (price: number) => 300 - (price - 26700) * 2,
      },
    } as unknown as RendererLayerArgs;
    const { ctx, calls } = canvas();
    paintVolumeProfiles(ctx, view, { model, style });
    const rects = calls.filter(call => call.kind === "rect" && call.fill !== "#131722");
    expect(rects.length).toBeGreaterThan(0);
    expect(rects.every(call => Number(call.values[0]) >= 4 && Number(call.values[0]) + Number(call.values[2]) <= 390)).toBe(true);
    const labelTexts = calls.filter(call => call.kind === "text" && /^(POC|VAH|VAL|HVN|LVN) /.test(String(call.values[0]))).map(call => String(call.values[0]));
    expect(labelTexts.length).toBe(3);
    expect(labelTexts.every(text => !/999999|000000/.test(text))).toBe(true);
  });
});
