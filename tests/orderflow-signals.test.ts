import { describe, expect, it } from "vitest";
import type { FootprintBar, OHLCV } from "@/types/trading";
import { findVolumeNodes } from "@/lib/orderflow/volumeNodes";
import { detectFootprintBarSignals } from "@/lib/orderflow/footprintSignals";
import { detectDeltaDivergences } from "@/lib/orderflow/deltaDivergence";
import { buildMissingOrderflowIndicators, resolveOrderflowTarget } from "@/lib/orderflow/equityOrderflow";
import { detectOhlcvProxySignals, estimateOhlcvDeltaBars } from "@/lib/orderflow/ohlcvOrderflowProxy";
import { computeQuantSignals } from "@/lib/quant/signals";
import { STRUCTURE_SCRIPT } from "@/lib/indicators/scripts";

describe("Orderflow signals: HVN/LVN, Absorption, Exhaustion, Delta-Divergence, CHoCH & Equities Proxy", () => {
  it("extracts High-Volume Nodes (HVN) and Low-Volume Nodes (LVN) from volume profile rows", () => {
    const profile = [
      { price: 100, volume: 200 },
      { price: 101, volume: 350 },
      { price: 102, volume: 980 }, // HVN peak
      { price: 103, volume: 420 },
      { price: 104, volume: 90 },  // LVN valley
      { price: 105, volume: 390 },
      { price: 106, volume: 890 }, // HVN peak
      { price: 107, volume: 300 },
      { price: 108, volume: 210 },
    ];
    const nodes = findVolumeNodes(profile);
    expect(nodes.some((n) => n.kind === "HVN" && (n.price === 102 || n.price === 106))).toBe(true);
    expect(nodes.some((n) => n.kind === "LVN" && n.price === 104)).toBe(true);
    expect(findVolumeNodes(profile.slice(0, 4))).toEqual([]);
  });

  it("detects absorption at highs/lows and exhaustion prints in FootprintBar levels", () => {
    const absBar: FootprintBar = {
      time: 60_000,
      volume: 1000,
      delta: -20,
      poc: 103,
      levels: [
        { price: 100, upperPrice: 101, buyVolume: 30, sellVolume: 40, imbalance: null },
        { price: 101, upperPrice: 102, buyVolume: 50, sellVolume: 60, imbalance: null },
        { price: 102, upperPrice: 103, buyVolume: 80, sellVolume: 70, imbalance: null },
        { price: 103, upperPrice: 104, buyVolume: 320, sellVolume: 350, imbalance: null }, // High both-sides absorbed volume
      ],
    };
    const absSignals = detectFootprintBarSignals(absBar, { open: 102, high: 104, low: 100, close: 101.5 });
    expect(absSignals.some((s) => s.kind === "absorption-high")).toBe(true);

    const exhBar: FootprintBar = {
      time: 120_000,
      volume: 600,
      delta: -120,
      poc: 101,
      levels: [
        { price: 100, upperPrice: 101, buyVolume: 5, sellVolume: 10, imbalance: null }, // tapered bottom sell (exhaustion-low)
        { price: 101, upperPrice: 102, buyVolume: 60, sellVolume: 280, imbalance: null },
        { price: 102, upperPrice: 103, buyVolume: 190, sellVolume: 40, imbalance: null },
        { price: 103, upperPrice: 104, buyVolume: 15, sellVolume: 20, imbalance: null }, // tapered top buy (exhaustion-high)
      ],
    };
    const exhSignals = detectFootprintBarSignals(exhBar, { open: 101, high: 104, low: 100, close: 102 });
    expect(exhSignals.some((s) => s.kind === "exhaustion-high")).toBe(true);
    expect(exhSignals.some((s) => s.kind === "exhaustion-low")).toBe(true);
  });

  it("detects bullish and bearish Delta/CVD divergences between price swings and delta series", () => {
    // 13 bars with two clear pivot lows (idx 3 price=100 delta=-500, idx 8 price=94 delta=-120 => bullish div)
    const prices = [108, 106, 104, 100, 104, 105, 103, 98, 94, 99, 103, 107, 109];
    const deltas = [0, -150, -300, -500, -250, -180, -200, -150, -120, 40, 180, 320, 450];
    const bars: OHLCV[] = prices.map((c, idx) => ({
      time: (idx + 1) * 60_000,
      open: c + 0.5,
      high: c + 1.5,
      low: c - 1.5,
      close: c,
      volume: 1000,
    }));
    const deltaBars = deltas.map((d, idx) => ({
      time: (idx + 1) * 60_000,
      high: d + 10,
      low: d - 10,
      close: d,
    }));
    const divs = detectDeltaDivergences(bars, deltaBars, 2, 24);
    expect(divs.some((d) => d.kind === "bullish")).toBe(true);
  });

  it("resolves YF:<TICKER> stocks to matching Hyperliquid HIP-3 equity perps for live orderflow or falls back cleanly to candles", () => {
    const hlAssets = [
      { coin: "xyz:TSLA", symbol: "HL:xyz:TSLA", name: "TSLA", dex: "xyz", volume: 12_500_000 },
      { coin: "flx:NVDA", symbol: "HL:flx:NVDA", name: "NVDA", dex: "flx", volume: 25_000_000 },
    ];
    const tsla = resolveOrderflowTarget("YF:TSLA", hlAssets);
    expect(tsla).toMatchObject({
      symbol: "HL:xyz:TSLA",
      chartType: "footprint",
      mappedFrom: "YF:TSLA",
      liveOrderflow: true,
    });

    const sap = resolveOrderflowTarget("YF:SAP.DE", hlAssets);
    expect(sap).toMatchObject({
      symbol: "YF:SAP.DE",
      chartType: "candles",
      liveOrderflow: false,
    });
    expect(sap.notice).toContain("SAP.DE");
  });

  it("includes CHoCH structure labels and computes trading-signals + simple-statistics quant snapshot", () => {
    expect(STRUCTURE_SCRIPT).toContain("CHoCH");

    const bars: OHLCV[] = Array.from({ length: 40 }, (_, i) => {
      const base = 100 + i * 0.6 + Math.sin(i * 0.4) * 1.5;
      return {
        time: (i + 1) * 86_400_000,
        open: base - 0.3,
        high: base + 1.2,
        low: base - 1.1,
        close: base + 0.4,
        volume: 100_000 + i * 1000,
      };
    });
    const q = computeQuantSignals(bars);
    expect(q.rsi14).not.toBeNull();
    expect(q.atr14).not.toBeNull();
    expect(q.annualizedVolPct).toBeGreaterThan(0);
    expect(q.priceSlopePerBarPct).toBeGreaterThan(0);
    expect(q.mfi14).not.toBeNull();
    expect(q.willR14).not.toBeNull();
    expect(q.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(q.var95Pct).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(q.candlestickPatterns)).toBe(true);

    // Oscillating bars with negative sessions yield a valid Sortino ratio
    const volatileBars: OHLCV[] = Array.from({ length: 40 }, (_, i) => {
      const base = 100 + i * 0.25 + Math.sin(i * 0.7) * 4;
      return {
        time: (i + 1) * 86_400_000,
        open: base - 0.5,
        high: base + 1.5,
        low: base - 1.4,
        close: base,
        volume: 120_000 + (i % 5) * 10_000,
      };
    });
    const qVol = computeQuantSignals(volatileBars);
    expect(qVol.sortinoRatio).not.toBeNull();
    expect(qVol.maxDrawdownPct).toBeGreaterThan(0);
  });

  it("estimates cumulative CLV delta and detects OHLCV proxy absorption/exhaustion for candle-only equities", () => {
    const baseBars: OHLCV[] = Array.from({ length: 10 }, (_, idx) => ({
      time: (idx + 1) * 86_400_000,
      open: 100 + idx * 0.2,
      high: 101 + idx * 0.2,
      low: 99.5 + idx * 0.2,
      close: 100.8 + idx * 0.2,
      volume: 100_000,
    }));

    const deltaBars = estimateOhlcvDeltaBars(baseBars);
    expect(deltaBars).toHaveLength(10);
    expect(deltaBars[0].barDelta).toBeGreaterThan(0);
    expect(deltaBars.at(-1)!.close).toBeGreaterThan(deltaBars[0].close);

    // High-volume upper-wick rejection => ABS* ↑ proxy absorption,
    // followed by high-volume push and low-volume blowoff => EXH* ↑
    const proxyBars: OHLCV[] = [
      ...baseBars,
      {
        time: 11 * 86_400_000,
        open: 102,
        high: 108,
        low: 101.8,
        close: 102.2,
        volume: 280_000,
      },
      {
        time: 12 * 86_400_000,
        open: 102.4,
        high: 108.1,
        low: 102.2,
        close: 107.6,
        volume: 220_000,
      },
      {
        time: 13 * 86_400_000,
        open: 107.7,
        high: 109.2,
        low: 105.0,
        close: 105.4,
        volume: 60_000,
      },
    ];

    const signals = detectOhlcvProxySignals(proxyBars);
    expect(signals.some((s) => s.kind === "absorption-high" && s.label === "ABS* ↑")).toBe(true);
    expect(signals.some((s) => s.kind === "exhaustion-high" && s.label === "EXH* ↑")).toBe(true);
  });

  it("attaches orderflow studies and supports IEX routing or proxy fallback cleanly", () => {
    const iex = resolveOrderflowTarget("YF:AAPL", [], { iexEnabled: true });
    expect(iex.symbol).toBe("IEX:AAPL");
    expect(iex.chartType).toBe("footprint");
    expect(iex.liveOrderflow).toBe(true);
    expect(iex.studies).toEqual(["volume-nodes", "orderflow-signals", "delta-divergence"]);

    const candleFallback = resolveOrderflowTarget("YF:SAP.DE", [], { iexEnabled: true });
    expect(candleFallback.chartType).toBe("candles");
    expect(candleFallback.studies).toContain("vpvr");

    const added = buildMissingOrderflowIndicators([], candleFallback.studies);
    expect(added.map((a) => a.definitionId)).toEqual([
      "volume-nodes",
      "orderflow-signals",
      "delta-divergence",
      "vpvr",
    ]);
    // Avoids duplicating already-active studies
    const deduped = buildMissingOrderflowIndicators(added.slice(0, 2), candleFallback.studies);
    expect(deduped.map((a) => a.definitionId)).toEqual(["delta-divergence", "vpvr"]);
  });
});
