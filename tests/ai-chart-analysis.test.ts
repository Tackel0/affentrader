import { describe, expect, it } from "vitest";
import {
  analyzeChart,
  buildAiAnalysisOverlays,
  DEFAULT_AI_ANALYSIS_LAYERS,
} from "@/lib/analysis/aiChartAnalysis";
import { backtestAiChartAnalysis } from "@/lib/analysis/aiBacktest";
import type { OHLCV } from "@/types/trading";

/**
 * Generates a realistic trending series ending with a clean consolidation + high-volume
 * structural range breakout on the final bar so `A+` breakout logic triggers cleanly.
 */
function makeBreakoutBars(direction: "up" | "down", count = 160): OHLCV[] {
  const bars: OHLCV[] = [];
  const baseTime = 1_730_000_000;
  let price = direction === "up" ? 100 : 280;
  const dir = direction === "up" ? 1 : -1;

  for (let i = 0; i < count; i++) {
    const isConsolidation = i >= count - 24 && i < count - 1;
    const isBreakout = i === count - 1;
    const open = price;
    let delta: number;
    let volume = 1200 + (i % 10) * 180;

    if (isBreakout) {
      // Fresh high-volume breakout above/below the prior 23-bar range
      delta = dir * 9.5;
      volume = 4800;
    } else if (isConsolidation) {
      // Tight sideways flag right below/above the breakout level
      delta = Math.sin(i * 1.4) * 0.9;
    } else {
      const wave = Math.sin(i / 4.2) * 3.4;
      const impulse = i === count - 45 ? -dir * 1.2 : i === count - 44 ? dir * 6.0 : 0;
      delta = dir * 0.65 + wave * 0.35 + impulse;
      if (i === count - 44) volume = 4200;
    }

    const close = Math.max(15, open + delta);
    const high = Math.max(open, close) + 1.0;
    const low = Math.max(1, Math.min(open, close) - 1.0);
    bars.push({
      time: baseTime + i * 86_400,
      open,
      high,
      low,
      close,
      volume,
    });
    price = close;
  }
  return bars;
}

function makeChoppyBars(count = 140): OHLCV[] {
  const bars: OHLCV[] = [];
  const baseTime = 1_730_000_000;
  for (let i = 0; i < count; i++) {
    const open = 100 + Math.sin(i * 1.7) * 1.6;
    const close = 100 + Math.sin((i + 1) * 1.7) * 1.6;
    bars.push({
      time: baseTime + i * 3600,
      open,
      high: Math.max(open, close) + 0.8,
      low: Math.min(open, close) - 0.8,
      close,
      volume: 1000,
    });
  }
  return bars;
}

describe("AI Chart Analysis v2 engine & automated drawings", () => {
  it("detects A+ bullish breakout, structure, zones, volume POC, trade plan, and emits chart overlays", () => {
    const bars = makeBreakoutBars("up", 160);
    const report = analyzeChart({
      symbol: "HL:xyz:NVDA",
      timeframe: "1D",
      bars,
    });

    expect(report.bias).toBe("bullish");
    expect(report.setupQuality).toBe("A+");
    expect(report.confidence).toBeGreaterThanOrEqual(74);
    expect(report.adx14).toBeGreaterThan(0);
    expect(report.relativeVolume).toBeGreaterThanOrEqual(1.1);
    expect(report.ema20).not.toBeNull();
    expect(report.ema50).not.toBeNull();
    expect(report.ema20!).toBeGreaterThan(report.ema50!);
    expect(report.volumePoc).not.toBeNull();
    expect(report.swings.length).toBeGreaterThanOrEqual(4);
    expect(report.bullets.length).toBeGreaterThanOrEqual(3);
    expect(report.tradePlan).not.toBeNull();
    expect(report.tradePlan!.direction).toBe("long");
    expect(report.tradePlan!.entryMode).toBe("breakout");
    expect(report.tradePlan!.stopLoss).toBeLessThan(report.tradePlan!.entryMid);
    expect(report.tradePlan!.target1).toBeGreaterThan(report.tradePlan!.entryMid);
    expect(report.tradePlan!.riskReward1).toBeGreaterThanOrEqual(1.5);
    expect(report.tradePlan!.trailAtrMultiple).toBeGreaterThan(0);

    const overlays = buildAiAnalysisOverlays(report, DEFAULT_AI_ANALYSIS_LAYERS);
    expect(overlays.length).toBeGreaterThanOrEqual(6);
    expect(overlays.some((o) => o.kind === "hline" && o.id === "ai-plan-entry")).toBe(true);
    expect(overlays.some((o) => o.kind === "hline" && o.id === "ai-plan-sl")).toBe(true);
    expect(overlays.some((o) => o.kind === "hline" && o.id === "ai-plan-tp1")).toBe(true);
    expect(overlays.some((o) => o.kind === "box")).toBe(true);
  });

  it("detects A+ bearish breakdown and generates a valid short trade plan with SL > entry > TP1 > TP2", () => {
    const bars = makeBreakoutBars("down", 160);
    const report = analyzeChart({
      symbol: "YF:TSLA",
      timeframe: "4h",
      bars,
    });

    expect(report.bias).toBe("bearish");
    expect(report.setupQuality).toBe("A+");
    expect(report.tradePlan).not.toBeNull();
    expect(report.tradePlan!.direction).toBe("short");
    expect(report.tradePlan!.stopLoss).toBeGreaterThan(report.tradePlan!.entryMid);
    expect(report.tradePlan!.target1).toBeLessThan(report.tradePlan!.entryMid);
    expect(report.tradePlan!.target2).toBeLessThan(report.tradePlan!.target1);
  });

  it("refuses blind entries in sideways chop by returning WAIT and tradePlan = null", () => {
    const bars = makeChoppyBars(140);
    const report = analyzeChart({
      symbol: "BTCUSDT",
      timeframe: "1h",
      bars,
    });

    expect(report.setupQuality).toBe("WAIT");
    expect(report.tradePlan).toBeNull();
    expect(report.bullets.some((b) => b.includes("Kein Blind-Einstieg"))).toBe(true);
  });

  it("respects individual layer toggles cleanly when building overlays", () => {
    const bars = makeBreakoutBars("up", 160);
    const report = analyzeChart({ symbol: "BTCUSDT", timeframe: "1D", bars });
    const none = buildAiAnalysisOverlays(report, {
      structure: false,
      zones: false,
      levels: false,
      fib: false,
      tradePlan: false,
    });
    expect(none).toEqual([]);

    const planOnly = buildAiAnalysisOverlays(report, {
      structure: false,
      zones: false,
      levels: false,
      fib: false,
      tradePlan: true,
    });
    expect(planOnly.map((o) => o.kind === "hline" && o.id)).toEqual([
      "ai-plan-entry",
      "ai-plan-sl",
      "ai-plan-tp1",
      "ai-plan-tp2",
    ]);
  });

  it("handles sparse charts (<20 bars) gracefully without throwing", () => {
    const report = analyzeChart({
      symbol: "YF:AAPL",
      timeframe: "1D",
      bars: makeBreakoutBars("up", 8),
    });
    expect(report.bias).toBe("neutral");
    expect(report.setupQuality).toBe("WAIT");
    expect(report.tradePlan).toBeNull();
    expect(buildAiAnalysisOverlays(report)).toEqual([]);
  });

  it("walk-forward backtester executes with strict zero-look-ahead and consistent summary stats", () => {
    // Append 35 continuation bars after the breakout so the trade fills and resolves cleanly
    const base = makeBreakoutBars("up", 160);
    const last = base[base.length - 1];
    let p = last.close;
    for (let i = 1; i <= 35; i++) {
      const open = p;
      const close = open + 1.8;
      base.push({
        time: last.time + i * 86_400,
        open,
        high: close + 0.9,
        low: open - 0.6,
        close,
        volume: 1600,
      });
      p = close;
    }

    const res = backtestAiChartAnalysis({
      symbol: "SPY",
      timeframe: "1D",
      bars: base,
      warmupBars: 70,
      maxHoldBars: 36,
      roundTripCostBps: 10,
    });

    expect(res.trades).toBeGreaterThanOrEqual(1);
    expect(res.wins + res.losses + res.breakevens).toBe(res.trades);
    expect(res.maxDrawdownR).toBeGreaterThanOrEqual(0);
    expect(res.profitFactor).toBeGreaterThanOrEqual(0);

    // Zero-look-ahead check: altering bars strictly AFTER an earlier evaluation endIndex must not change prior entries
    const mutated = base.map((b, idx) =>
      idx >= 165 ? { ...b, open: b.open * 0.5, high: b.high * 0.5, low: b.low * 0.5, close: b.close * 0.5 } : b,
    );
    const earlyA = backtestAiChartAnalysis({
      symbol: "SPY",
      timeframe: "1D",
      bars: base,
      warmupBars: 70,
      endIndex: 150,
      maxHoldBars: 10,
    });
    const earlyB = backtestAiChartAnalysis({
      symbol: "SPY",
      timeframe: "1D",
      bars: mutated,
      warmupBars: 70,
      endIndex: 150,
      maxHoldBars: 10,
    });
    expect(earlyA.allTrades).toEqual(earlyB.allTrades);
  });
});

