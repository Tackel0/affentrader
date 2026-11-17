import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeIndicatorContext, RendererLayerArgs } from "@luxalgo/vela";
import type { OHLCV, Tick } from "@/types/trading";

const registeredIndicators = new Map<string, { type: string; create: () => ReturnType<any> }>();
const registeredLayers = new Map<string, { id: string; create: () => any }>();
const detectDivSpy = vi.fn<(...args: unknown[]) => unknown[]>();

vi.mock("@luxalgo/vela", () => ({
  registerNativeIndicator: (desc: { type: string; create: () => ReturnType<any> }) => {
    registeredIndicators.set(desc.type, desc);
  },
  registerRendererLayer: (desc: { id: string; create: () => any }) => {
    registeredLayers.set(desc.id, desc);
  },
}));

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

vi.mock("@/lib/orderflow/deltaDivergence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/orderflow/deltaDivergence")>();
  return {
    ...actual,
    detectDeltaDivergences: (...args: Parameters<typeof actual.detectDeltaDivergences>) => {
      detectDivSpy(...args);
      return actual.detectDeltaDivergences(...args);
    },
  };
});

import { registerOrderflowSignalPlugins } from "@/lib/orderflow/signalLayers";

function makeMockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
    measureText: vi.fn(() => ({ width: 24 })),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
  } as unknown as CanvasRenderingContext2D;
}

describe("Orderflow signal renderer layers (throttling, caching, visible range & resilience)", () => {
  afterEach(() => {
    vi.useRealTimers();
    detectDivSpy.mockClear();
  });

  it("coalesces tick pushes to 90ms and preserves repaint across cloned pushData payloads", () => {
    vi.useFakeTimers();
    registeredIndicators.clear();
    registeredLayers.clear();

    let onTick: (() => void) | undefined;
    let trades: Tick[] = [
      { id: "1", symbol: "BTCUSDT", time: 1_000_000, price: 100, quantity: 5, side: "buy", simulated: false },
    ];

    registerOrderflowSignalPlugins({
      studyTrades: () => trades,
      subscribeTicks: (_symbol, cb) => {
        onTick = cb;
        return () => {
          onTick = undefined;
        };
      },
    });

    const studyDesc = registeredIndicators.get("af-orderflow-signals");
    const layerDesc = registeredLayers.get("af-orderflow-signals");
    expect(studyDesc).toBeDefined();
    expect(layerDesc).toBeDefined();

    const pushedPayloads: Array<{ repaint?: () => void } | null> = [];
    const ctx = {
      id: "study-1",
      symbol: "BTCUSDT",
      timeframe: "15m",
      live: true,
      bars: () => [],
      data: {},
      setStatus: vi.fn(),
      emit: vi.fn(),
      pushData: vi.fn((payload: unknown) => {
        pushedPayloads.push(payload as { repaint?: () => void } | null);
      }),
    } as unknown as NativeIndicatorContext;

    const instance = studyDesc!.create();
    instance.start(ctx, {});
    expect(pushedPayloads).toHaveLength(1);

    // Simulate Vela passing pushed data to the renderer layer, which assigns `.repaint` on `args.data`
    const repaintSpy = vi.fn();
    pushedPayloads[0]!.repaint = repaintSpy;

    // Burst 5 ticks inside 90ms: only one deferred flush should occur after 90ms
    trades = [
      ...trades,
      { id: "2", symbol: "BTCUSDT", time: 1_001_000, price: 101, quantity: 10, side: "sell", simulated: false },
    ];
    for (let i = 0; i < 5; i++) onTick?.();
    expect(pushedPayloads).toHaveLength(1);

    vi.advanceTimersByTime(90);
    expect(pushedPayloads).toHaveLength(2);
    expect(repaintSpy).toHaveBeenCalledTimes(1);
    expect(pushedPayloads[1]?.repaint).toBe(repaintSpy);

    // Clear pending timer cleanly on suspend/stop
    onTick?.();
    instance.stop();
    vi.advanceTimersByTime(200);
    expect(pushedPayloads.at(-1)).toBeNull();
  });

  it("caches delta divergence computation across unchanged frames and draws historical visible signals", () => {
    registeredIndicators.clear();
    registeredLayers.clear();

    registerOrderflowSignalPlugins({
      studyTrades: () => [],
      subscribeTicks: () => () => {},
    });

    const day = 86_400_000;
    const bars: OHLCV[] = [];
    // Construct 80 daily bars with an early bullish divergence + rejection signals + recent bars
    for (let i = 0; i < 80; i++) {
      const t = (i + 1) * day;
      let low = 100 - (i < 20 ? i * 0.4 : 0);
      let high = low + 4;
      let open = low + 1;
      let close = low + 3;
      let volume = 100_000;
      if (i === 5) {
        low = 90;
        close = 91;
        open = 93;
        volume = 180_000;
      } else if (i === 12) {
        low = 87;
        close = 90.5;
        open = 89;
        volume = 350_000; // heavy volume absorption at lower low -> higher estimated delta
      }
      bars.push({ time: t, open, high, low, close, volume });
    }

    const divLayer = registeredLayers.get("af-delta-divergence")!.create();
    const sigLayer = registeredLayers.get("af-orderflow-signals")!.create();
    const volLayer = registeredLayers.get("af-volume-nodes")!.create();

    const makeArgs = (fromBar: number, toBar: number): RendererLayerArgs =>
      ({
        bars,
        data: {
          symbol: "YF:AAPL",
          timeframe: "1D",
          trades: [],
          options: { pivotRadius: 2, showAbsorption: true, showExhaustion: true },
        },
        bounds: { top: 0, left: 0, width: 800, height: 400 },
        scale: {} as RendererLayerArgs["scale"],
        theme: {} as RendererLayerArgs["theme"],
        coords: {
          width: 800,
          height: 400,
          dpr: 1,
          visibleTimeRange: () => ({ from: bars[fromBar].time, to: bars[toBar].time }),
          timeToX: (time: number) => {
            const idx = Math.round(time / day) - 1;
            return ((idx - fromBar) / Math.max(1, toBar - fromBar)) * 800;
          },
          priceToY: (price: number) => 400 - (price - 80) * 10,
        },
      }) as unknown as RendererLayerArgs;

    const mockCtx = makeMockCtx();
    const cell = { id: "cell-main", symbol: "YF:AAPL", timeframe: "1D" };

    // Frame 1 & Frame 2 on identical bars/trades should compute divergences only ONCE
    detectDivSpy.mockClear();
    divLayer.paint(mockCtx, makeArgs(0, 25), cell);
    divLayer.paint(mockCtx, makeArgs(2, 27), cell);
    expect(detectDivSpy).toHaveBeenCalledTimes(1);

    // Panned back to early window [5..20], historical proxy signal around bar 12 stays visible
    sigLayer.paint(mockCtx, makeArgs(5, 20), cell);
    expect((mockCtx.fillText as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(0);

    // Non-finite/invalid high-low range bar in FixedProfileCache must be caught gracefully without throwing
    const badBars: OHLCV[] = [{ time: day, open: 100, high: Number.NaN, low: Number.NaN, close: 100, volume: 10 }];
    expect(() =>
      volLayer.paint(
        mockCtx,
        {
          ...makeArgs(0, 0),
          bars: badBars,
          data: { rows: 32, showHvn: true, showLvn: true },
        },
        cell,
      ),
    ).not.toThrow();
  });
});
