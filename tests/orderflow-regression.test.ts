import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar, FootprintLevel, OHLCV, Tick } from "@/types/trading";

const registeredIndicators = new Map<string, { type: string; create: () => ReturnType<any> }>();
const registeredLayers = new Map<string, { id: string; create: () => any }>();

vi.mock("@luxalgo/vela", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@luxalgo/vela")>();
  return {
    ...actual,
    registerNativeIndicator: (desc: { type: string; create: () => ReturnType<any> }) => {
      registeredIndicators.set(desc.type, desc);
    },
    registerRendererLayer: (desc: { id: string; create: () => any }) => {
      registeredLayers.set(desc.id, desc);
    },
  };
});

vi.mock("@/lib/chart/canvasLayer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chart/canvasLayer")>();
  return {
    ...actual,
    invalidateCanvasLayers: vi.fn(),
    canvasLayer: (paint: (ctx: CanvasRenderingContext2D, args: RendererLayerArgs, cell: unknown) => void) => ({
      paint,
    }),
  };
});

import { detectFootprintBarSignals, detectTrappedParticipants } from "@/lib/orderflow/footprintSignals";
import { detectDeltaDivergences } from "@/lib/orderflow/deltaDivergence";
import { estimateOhlcvDeltaBars } from "@/lib/orderflow/ohlcvOrderflowProxy";
import { footprintOverlayDescriptor, resolveFootprintOverlay, type FootprintOverlayChannel } from "@/lib/orderflow/footprintOverlay";
import { createFootprintOverlayCache, paintFootprintOverlay } from "@/lib/orderflow/footprintOverlayRenderer";
import { FootprintHistory } from "@/lib/orderflow/footprintHistory";
import { registerOrderflowSignalPlugins } from "@/lib/orderflow/signalLayers";
import { planFootprintText } from "@/lib/orderflow/footprintText";
import { defaultFootprint } from "@/lib/orderflow/footprint";
import { paintFootprintMagnifier } from "@/lib/orderflow/footprintMagnifier";
import {
  clearFootprintSurface,
  publishFootprintSurface,
  subscribeFootprintSurfaces,
} from "@/lib/orderflow/footprintReadout";
import {
  createFootprintInspection,
  footprintInspectionRowMetrics,
  footprintInspectionSummary,
} from "@/lib/orderflow/footprintInspection";
import { footprints } from "@/lib/orderflow/math";
import { resolveOrderflowTarget } from "@/lib/orderflow/equityOrderflow";

function makeCanvas(widthScale = 0.6) {
  const texts: string[] = [];
  const fills: Array<{ style: string; rect: number[] }> = [];
  const strokes: Array<{ style: string; rect: number[] }> = [];
  const ctx = {
    font: "11px Arial",
    textAlign: "left",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect(...rect: number[]) {
      fills.push({ style: ctx.fillStyle, rect });
    },
    strokeRect(...rect: number[]) {
      strokes.push({ style: ctx.strokeStyle, rect });
    },
    fillText(text: string) {
      texts.push(text);
    },
    measureText(text: string) {
      const px = parseFloat(ctx.font.replace(/^600\s+/, "")) || 11;
      return { width: text.length * px * widthScale };
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, fills, strokes };
}

describe("Orderflow & Footprint regression coverage", () => {
  afterEach(() => {
    vi.useRealTimers();
    registeredIndicators.clear();
    registeredLayers.clear();
  });

  it("computes fractional exhaustion strength accurately without truncating sub-unit volumes", () => {
    const fractionalBar: FootprintBar = {
      time: 60_000,
      volume: 2.4,
      delta: -0.05,
      poc: 101,
      levels: [
        { price: 100, upperPrice: 101, buyVolume: 0.2, sellVolume: 0.1, imbalance: null },
        { price: 101, upperPrice: 102, buyVolume: 0.1, sellVolume: 0.9, imbalance: null },
        { price: 102, upperPrice: 103, buyVolume: 0.9, sellVolume: 0.1, imbalance: null },
        { price: 103, upperPrice: 104, buyVolume: 0.05, sellVolume: 0.05, imbalance: null },
      ],
    };
    const signals = detectFootprintBarSignals(fractionalBar, {
      open: 101,
      high: 103.5,
      low: 100,
      close: 102,
    });
    const exhHigh = signals.find((s) => s.kind === "exhaustion-high");
    const exhLow = signals.find((s) => s.kind === "exhaustion-low");
    expect(exhHigh).toBeDefined();
    expect(exhLow).toBeDefined();
    expect(exhHigh!.strength).toBeGreaterThan(0);
    expect(exhHigh!.strength).toBeLessThanOrEqual(1);
    expect(exhLow!.strength).toBeGreaterThan(0);
    expect(exhLow!.strength).toBeLessThanOrEqual(1);
  });

  it("detects trapped buyers/sellers when candle closes away from opposing delta prints", () => {
    const trappedBuyBar: FootprintBar = {
      time: 60_000,
      volume: 600,
      delta: 120,
      poc: 104,
      levels: [
        { price: 100, upperPrice: 101, buyVolume: 10, sellVolume: 30, imbalance: null },
        { price: 101, upperPrice: 102, buyVolume: 15, sellVolume: 25, imbalance: null },
        { price: 102, upperPrice: 103, buyVolume: 120, sellVolume: 20, imbalance: "buy", buyImbalance: true },
        { price: 103, upperPrice: 104, buyVolume: 140, sellVolume: 15, imbalance: "buy", buyImbalance: true },
        { price: 104, upperPrice: 105, buyVolume: 160, sellVolume: 10, imbalance: "buy", buyImbalance: true },
      ],
    };
    const bearishReversal = detectTrappedParticipants(trappedBuyBar, {
      open: 102,
      high: 105,
      low: 100,
      close: 100.5,
    });
    expect(bearishReversal).toEqual({
      trappedBuyers: 275,
      trappedSellers: 0,
      trappedBuyLevels: 2,
      trappedSellLevels: 0,
      summary: "Trapped buyers 275 (2 lvls)",
    });

    const trappedSellBar: FootprintBar = {
      time: 120_000,
      volume: 600,
      delta: -120,
      poc: 100,
      levels: [
        { price: 100, upperPrice: 101, buyVolume: 10, sellVolume: 160, imbalance: "sell", sellImbalance: true },
        { price: 101, upperPrice: 102, buyVolume: 15, sellVolume: 140, imbalance: "sell", sellImbalance: true },
        { price: 102, upperPrice: 103, buyVolume: 20, sellVolume: 120, imbalance: "sell", sellImbalance: true },
        { price: 103, upperPrice: 104, buyVolume: 25, sellVolume: 15, imbalance: null },
        { price: 104, upperPrice: 105, buyVolume: 30, sellVolume: 10, imbalance: null },
      ],
    };
    const bullishReversal = detectTrappedParticipants(trappedSellBar, {
      open: 103,
      high: 105,
      low: 100,
      close: 104.5,
    });
    expect(bullishReversal).toEqual({
      trappedBuyers: 0,
      trappedSellers: 275,
      trappedBuyLevels: 0,
      trappedSellLevels: 2,
      summary: "Trapped sellers 275 (2 lvls)",
    });

    // Empty levels yield zeroed summary
    expect(detectTrappedParticipants({ ...trappedBuyBar, levels: [] })).toEqual({
      trappedBuyers: 0,
      trappedSellers: 0,
      trappedBuyLevels: 0,
      trappedSellLevels: 0,
      summary: null,
    });
  });

  it("preserves flat-plateau swing pivots on their rightmost bar and skips non-finite inputs cleanly", () => {
    // Flat two-bar high plateau at indices 3..4 (112, 112), then higher high at index 8 (116) with lower delta
    const highs = [100, 104, 108, 112, 112, 105, 107, 111, 116, 110, 104, 101, 99];
    const deltas = [50, 150, 300, 480, 500, 220, 140, 180, 260, 120, -40, -160, -250];
    const bars: OHLCV[] = highs.map((h, i) => ({
      time: (i + 1) * 60_000,
      open: h - 2,
      high: h,
      low: h - 3,
      close: h - 1,
      volume: 1_000,
    }));
    const deltaBars = deltas.map((d, i) => ({
      time: (i + 1) * 60_000,
      high: d + 10,
      low: d - 10,
      close: d,
    }));
    const divs = detectDeltaDivergences(bars, deltaBars, 2, 24);
    const plateauDiv = divs.find((d) => d.kind === "bearish");
    expect(plateauDiv).toBeDefined();
    expect(plateauDiv!.fromTime).toBe(5 * 60_000);
    expect(plateauDiv!.toTime).toBe(9 * 60_000);

    // Non-finite values are skipped rather than emitting NaN divergences
    const badBars = bars.map((b, i) => (i === 8 ? { ...b, high: Number.NaN } : b));
    expect(() => detectDeltaDivergences(badBars, deltaBars, 2, 24)).not.toThrow();
    expect(detectDeltaDivergences(bars.slice(0, 3), deltaBars.slice(0, 3), 2, 24)).toEqual([]);

    // Zero-range OHLCV bars fall back to previous close direction in proxy delta estimation
    const zeroRangeBars: OHLCV[] = [
      { time: 60_000, open: 100, high: 100, low: 100, close: 100, volume: 100 },
      { time: 120_000, open: 102, high: 102, low: 102, close: 102, volume: 50 },
      { time: 180_000, open: 99, high: 99, low: 99, close: 99, volume: 40 },
    ];
    const proxy = estimateOhlcvDeltaBars(zeroRangeBars);
    expect(proxy.map((b) => b.barDelta)).toEqual([50, 25, -20]);
    expect(proxy.map((b) => b.close)).toEqual([50, 75, 55]);
    expect(estimateOhlcvDeltaBars([])).toEqual([]);
  });

  it("matches venue-stripped live ticks cleanly in footprintOverlayDescriptor (BINANCE: vs KRK:/HL:/YF:)", async () => {
    vi.useFakeTimers();
    let receive: ((tick: Tick) => void) | undefined;
    const rawTicks: Tick[] = [
      { id: "seed-1", symbol: "BTCUSDT", time: 1_000, price: 50_000, quantity: 2, side: "buy", simulated: false },
      { id: "seed-hl", symbol: "HL:BTC", time: 1_000, price: 50_000, quantity: 99, side: "sell", simulated: false },
    ];
    const descriptor = footprintOverlayDescriptor(
      "bar",
      () => rawTicks,
      (_sym, cb) => {
        receive = cb;
        return () => {
          receive = undefined;
        };
      },
    );

    const pushed: Array<FootprintOverlayChannel | null> = [];
    const instance = descriptor.create();
    const repaint = vi.fn();
    instance.start(
      {
        id: "fp-binance",
        symbol: "BINANCE:BTCUSDT",
        timeframe: "1m",
        live: true,
        bars: () => [{ time: 0, open: 50_000, high: 50_010, low: 49_990, close: 50_005, volume: 10 }],
        emit() {},
        pushData(value: FootprintOverlayChannel | null) {
          pushed.push(value);
          if (value) value.repaint = repaint;
        },
        setStatus() {},
      } as unknown as NativeIndicatorContext,
      { rowSize: 10 },
    );

    expect(pushed.at(-1)?.history?.coverage.trades).toBe(1);

    receive?.({ id: "live-ignored", symbol: "HL:BTC", time: 2_000, price: 50_000, quantity: 10, side: "sell", simulated: false });
    receive?.({ id: "live-match", symbol: "BTCUSDT", time: 2_500, price: 50_005, quantity: 3, side: "buy", simulated: false });
    await vi.advanceTimersByTimeAsync(50);

    expect(pushed.at(-1)?.history?.coverage.trades).toBe(2);
    expect(repaint).toHaveBeenCalledTimes(1);
    instance.stop();
  });

  it("passes candle context in paintFootprintOverlay and draws candle overlay when candleVisible=true", () => {
    const seedTicks: Tick[] = [
      { id: "1", symbol: "HL:BTC", time: 1_000, price: 101, quantity: 5, side: "buy", simulated: false },
    ];
    const history = new FootprintHistory("1m");
    history.add(seedTicks);
    const resolved = resolveFootprintOverlay("bar", {
      rowSize: 1,
      candleVisible: true,
      valueAreaVisible: false,
      pocVisible: false,
    });
    const candleBar: OHLCV = { time: 0, open: 100, high: 105, low: 98, close: 104, volume: 20 };

    const withCandle = makeCanvas();
    const channel: FootprintOverlayChannel = {
      kind: "bar",
      id: "fp-candle",
      history,
      ...resolved,
      style: { ...resolved.style, candleVisible: true, valueAreaVisible: false, pocVisible: false },
      message: "Observed",
      identity: { symbol: "HL:BTC", timeframe: "1m", live: true, through: null, revision: 1 },
    };
    const layerArgs = {
      nowMs: 1_000,
      priceStyle: "candles",
      bars: [candleBar],
      cursor: null,
      coords: {
        width: 500,
        timeToX: () => 200,
        pxPerBar: () => 80,
        visibleLogicalRange: () => ({ from: 0, to: 0 }),
        priceToY: (p: number) => (110 - p) * 20,
      },
      bounds: { top: 0, height: 400 },
      scale: { min: 95, max: 110 },
      theme: { textColor: "#111", background: "#fff" },
    } as unknown as RendererLayerArgs;

    const result = paintFootprintOverlay(withCandle.ctx, layerArgs, channel, createFootprintOverlayCache());
    expect(result?.bars).toHaveLength(1);
    // Candle wick stroke & body fillRect should have been drawn because matching candleBar was supplied
    expect((withCandle.ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    expect(withCandle.fills.length).toBeGreaterThan(1);
  });

  it("invalidates signal cache on intrabar high/low updates, handles missing measureText, and clips Replay signals", () => {
    vi.useFakeTimers();
    registeredIndicators.clear();
    registeredLayers.clear();

    const bar1: OHLCV = { time: 60_000, open: 100, high: 105, low: 99, close: 101, volume: 100 };
    const bar2: OHLCV = { time: 120_000, open: 101, high: 103, low: 100, close: 102, volume: 100 };
    const trades: Tick[] = [
      { id: "t1", symbol: "HL:BTC", time: 60_500, price: 100, quantity: 10, side: "buy", simulated: false },
      { id: "t2", symbol: "HL:BTC", time: 61_000, price: 101, quantity: 10, side: "sell", simulated: false },
      { id: "t3", symbol: "HL:BTC", time: 61_500, price: 104, quantity: 200, side: "buy", simulated: false },
      { id: "t4", symbol: "HL:BTC", time: 62_000, price: 104, quantity: 220, side: "sell", simulated: false },
      { id: "t5", symbol: "HL:BTC", time: 120_500, price: 101, quantity: 250, side: "buy", simulated: false },
      { id: "t6", symbol: "HL:BTC", time: 121_000, price: 101, quantity: 240, side: "sell", simulated: false },
    ];

    registerOrderflowSignalPlugins({
      studyTrades: () => trades,
      subscribeTicks: () => () => {},
      replayTrades: (_sym, _tf, through) => ({
        trades: trades.filter((t) => t.time < (through ?? 120_000)),
        through: through ?? 120_000,
        label: "Recorded fixture",
      }),
    });

    const sigLayer = registeredLayers.get("af-orderflow-signals")!.create();
    const makeLayerArgs = (bars: OHLCV[]): RendererLayerArgs =>
      ({
        bars,
        data: { symbol: "HL:BTC", timeframe: "1m", trades, options: { showAbsorption: true, showExhaustion: true } },
        bounds: { top: 0, left: 0, width: 800, height: 400 },
        scale: {} as RendererLayerArgs["scale"],
        theme: {} as RendererLayerArgs["theme"],
        coords: {
          width: 800,
          height: 400,
          dpr: 1,
          visibleTimeRange: () => ({ from: 0, to: 200_000 }),
          timeToX: (t: number) => (t / 200_000) * 800,
          priceToY: (p: number) => 400 - (p - 95) * 20,
        },
      }) as unknown as RendererLayerArgs;

    // 1. Intrabar high/low wick change with constant close, length & trades still recomputes
    const frameA = makeCanvas();
    const sameCloseA: OHLCV = { time: 60_000, open: 100, high: 102, low: 99, close: 101, volume: 100 };
    sigLayer.paint(frameA.ctx, makeLayerArgs([sameCloseA]), { id: "c1", symbol: "HL:BTC", timeframe: "1m" });
    const textCountBeforeWick = frameA.texts.length;

    const frameB = makeCanvas();
    const wickExpandedB: OHLCV = { ...sameCloseA, high: 105 };
    sigLayer.paint(frameB.ctx, makeLayerArgs([wickExpandedB]), { id: "c1", symbol: "HL:BTC", timeframe: "1m" });
    expect(frameB.texts.length).toBeGreaterThanOrEqual(textCountBeforeWick);

    // 2. Minimal canvas without measureText renders cleanly via fallback width estimate
    const minimalCtx = {
      ...makeCanvas().ctx,
      measureText: undefined,
    } as unknown as CanvasRenderingContext2D;
    expect(() =>
      sigLayer.paint(minimalCtx, makeLayerArgs([bar1, bar2]), { id: "c-min", symbol: "HL:BTC", timeframe: "1m" }),
    ).not.toThrow();

    // 3. Replay gating: bar2 starts at replayThrough=120_000 so bar2 signals must not render in Replay
    const liveCanvas = makeCanvas();
    sigLayer.paint(liveCanvas.ctx, makeLayerArgs([bar1, bar2]), {
      id: "c2",
      symbol: "HL:BTC",
      timeframe: "1m",
      replay: false,
    });
    const replayCanvas = makeCanvas();
    sigLayer.paint(replayCanvas.ctx, makeLayerArgs([bar1, bar2]), {
      id: "c2",
      symbol: "HL:BTC",
      timeframe: "1m",
      replay: true,
      replayThrough: 120_000,
    });
    expect(replayCanvas.texts.length).toBeLessThanOrEqual(liveCanvas.texts.length);

    // 4. Sub-cent computeSignalStep: micro-priced assets (e.g. 0.00001200) bucket at sub-cent step instead of clamping to 0.01
    const subCentBar: OHLCV = {
      time: 60_000,
      open: 0.0000121,
      high: 0.0000125,
      low: 0.000012,
      close: 0.00001215,
      volume: 1_000_000,
    };
    const subCentTrades: Tick[] = [
      { id: "p1", symbol: "PEPEUSDT", time: 60_100, price: 0.000012, quantity: 10_000, side: "buy", simulated: false },
      { id: "p2", symbol: "PEPEUSDT", time: 60_200, price: 0.0000121, quantity: 15_000, side: "sell", simulated: false },
      { id: "p3", symbol: "PEPEUSDT", time: 60_300, price: 0.0000122, quantity: 20_000, side: "buy", simulated: false },
      { id: "p4", symbol: "PEPEUSDT", time: 60_400, price: 0.00001248, quantity: 400_000, side: "buy", simulated: false },
      { id: "p5", symbol: "PEPEUSDT", time: 60_500, price: 0.00001248, quantity: 420_000, side: "sell", simulated: false },
    ];
    const subCentCanvas = makeCanvas();
    sigLayer.paint(
      subCentCanvas.ctx,
      {
        ...makeLayerArgs([subCentBar]),
        bars: [subCentBar],
        data: {
          symbol: "PEPEUSDT",
          timeframe: "1m",
          trades: subCentTrades,
          options: { showAbsorption: true, showExhaustion: true },
        },
        coords: {
          width: 800,
          height: 400,
          dpr: 1,
          visibleTimeRange: () => ({ from: 0, to: 120_000 }),
          timeToX: () => 400,
          priceToY: (p: number) => 400 - ((p - 0.0000119) / 0.0000007) * 400,
        },
      } as unknown as RendererLayerArgs,
      { id: "c-subcent", symbol: "PEPEUSDT", timeframe: "1m" },
    );
    expect(subCentCanvas.texts.some((t) => t.includes("ABS"))).toBe(true);
  });

  it("scans every unfiltered row minimum height in planFootprintText for log-scale safety", () => {
    const c = makeCanvas();
    const rows: FootprintLevel[] = [
      { price: 100, upperPrice: 101, buyVolume: 10, sellVolume: 10, imbalance: null },
      { price: 200, upperPrice: 201, buyVolume: 10, sellVolume: 10, imbalance: null },
    ];
    // On log scale, higher price row is shorter (12px < 14px gate) -> returns null instead of using row 0's 30px
    expect(
      planFootprintText(
        c.ctx,
        defaultFootprint(),
        rows,
        { left: 60, right: 140, axis: 100 },
        (r) => (r.price === 100 ? 30 : 12),
        "Arial",
      ),
    ).toBeNull();

    // When all rows pass the 14px gate, minimum height (14px -> size 11) bounds Auto size rather than row 0 (30px -> size 12)
    expect(
      planFootprintText(
        c.ctx,
        defaultFootprint(),
        rows,
        { left: 60, right: 140, axis: 100 },
        (r) => (r.price === 100 ? 30 : 14),
        "Arial",
      ),
    ).toBe(11);
  });

  it("formats sub-minute timestamps as HH:MM:SS in paintFootprintMagnifier", () => {
    const bars: FootprintBar[] = [
      { time: 15_000, volume: 10, delta: 4, poc: 100, levels: [{ price: 100, upperPrice: 101, buyVolume: 7, sellVolume: 3, imbalance: null }] },
      { time: 30_000, volume: 12, delta: 6, poc: 100, levels: [{ price: 100, upperPrice: 101, buyVolume: 9, sellVolume: 3, imbalance: null }] },
    ];
    const view = {
      id: "fp-sub",
      label: "Footprint",
      bars,
      style: { ...defaultFootprint(), candleVisible: false, valueAreaVisible: false },
      step: 1,
      placement: { width: 40, offset: 0, within: true },
    };
    const c = makeCanvas();
    const args = {
      coords: {
        width: 1200,
        dpr: 1,
        pxPerBar: () => 100,
        timeToX: (time: number) => 600 + ((time - 15_000) / 15_000) * 100,
        priceToY: (price: number) => (110 - price) * 20,
      },
      scale: {},
      bounds: { top: 0, height: 400 },
      bars: bars.map((b) => ({ time: b.time })),
      theme: { background: "#ffffff", textColor: "#131722", fontFamily: "Arial" },
    } as unknown as RendererLayerArgs;

    paintFootprintMagnifier(c.ctx, args, {
      view,
      bar: bars[1],
      row: 0,
      lower: 100,
      upper: 101,
      rect: { x: 680, y: 180, width: 40, height: 20 },
    });
    expect(c.texts.some((t) => /\d{2}:\d{2}:30/.test(t))).toBe(true);
  });

  it("coalesces multiple footprint surface mutations into a single microtask subscriber wakeup", async () => {
    const token = Symbol("coalesce");
    const spy = vi.fn();
    const unsub = subscribeFootprintSurfaces(spy);
    const bar = footprints(
      [{ id: "t1", symbol: "HL:BTC", time: 0, price: 100, quantity: 5, side: "buy", simulated: false }],
      "1m",
      1,
    );
    publishFootprintSurface("primary", token, {
      symbol: "HL:BTC",
      timeframe: "1m",
      epoch: 1,
      bars: bar,
      simulated: false,
      dropped: 0,
    });
    publishFootprintSurface("primary", token, {
      symbol: "HL:BTC",
      timeframe: "1m",
      epoch: 2,
      bars: bar,
      simulated: false,
      dropped: 0,
    });
    expect(spy).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);

    clearFootprintSurface("primary", token);
    unsub();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("computes per-row contiguous diagonal ratios and summary diagnostics in footprintInspection", () => {
    const ticks: Tick[] = [
      { id: "a", symbol: "HL:BTC", time: 1_000, price: 100, quantity: 20, side: "sell", simulated: false },
      { id: "b", symbol: "HL:BTC", time: 1_100, price: 101, quantity: 100, side: "buy", simulated: false },
      { id: "c", symbol: "HL:BTC", time: 1_200, price: 102, quantity: 120, side: "buy", simulated: false },
      { id: "d", symbol: "HL:BTC", time: 1_300, price: 103, quantity: 140, side: "buy", simulated: false },
    ];
    const bar = footprints(ticks, "1m", 1)[0];
    const snap = createFootprintInspection(
      bar,
      { step: 1, ratio: 3, minimumVolume: 0, ignoreZeroOpposite: false, minimumStackRows: 3 },
      { symbol: "HL:BTC", timeframe: "1m", simulated: false, coverage: "Observed" },
      2_000,
    );
    const metrics = footprintInspectionRowMetrics(snap);
    expect(metrics.get(103)).toEqual({ buyRatio: Infinity, sellRatio: null });
    expect(metrics.get(100)).toEqual({ buyRatio: null, sellRatio: 0.2 });

    const summary = footprintInspectionSummary(snap, { open: 102, high: 104, low: 100, close: 100.2 });
    expect(summary.trapped).toMatchObject({ trappedBuyers: 140, trappedBuyLevels: 1 });
    expect(summary.buyImbalances).toBe(3);
    expect(summary.sellImbalances).toBe(0);
    expect(resolveOrderflowTarget("YF:NOTFOUND", []).notice).toContain("OHLCV");
  });
});
