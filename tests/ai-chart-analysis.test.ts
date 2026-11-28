import { describe, expect, it } from "vitest";
import {
  analyzeChart,
  buildAiAnalysisOverlays,
  DEFAULT_AI_ANALYSIS_LAYERS,
} from "@/lib/analysis/aiChartAnalysis";
import type { OHLCV } from "@/types/trading";

function makeTrendingBars(direction: "up" | "down", count = 140): OHLCV[] {
  const bars: OHLCV[] = [];
  const baseTime = 1_730_000_000;
  let price = direction === "up" ? 100 : 220;
  for (let i = 0; i < count; i++) {
    // Realistic alternating waves + impulse legs so swings, BOS, OB, FVG, S/R and Fib Golden Pocket all form
    const wave = Math.sin(i / 4.2) * 4.2;
    const drift = direction === "up" ? 0.35 : -0.35;
    const open = price;
    // Inject a clean impulsive displacement around bar 115 for an unmitigated OB + FVG
    const impulse = i === 114 ? (direction === "up" ? -1.4 : 1.4) : i === 115 ? (direction === "up" ? 6.5 : -6.5) : 0;
    const close = Math.max(10, open + drift + wave * 0.45 + impulse);
    const high = Math.max(open, close) + 1.1;
    const low = Math.max(1, Math.min(open, close) - 1.1);
    bars.push({
      time: baseTime + i * 3600,
      open,
      high,
      low,
      close,
      volume: 1000 + (i % 12) * 250 + (i === 115 ? 4500 : 0),
    });
    price = close;
  }
  return bars;
}

describe("AI Chart Analysis engine & automated drawings", () => {
  it("detects bullish trend, structure, zones, volume POC, trade plan, and emits non-empty chart overlays", () => {
    const bars = makeTrendingBars("up", 140);
    const report = analyzeChart({
      symbol: "HL:xyz:NVDA",
      timeframe: "1h",
      bars,
    });

    expect(report.bias).toBe("bullish");
    expect(report.confidence).toBeGreaterThanOrEqual(55);
    expect(report.ema20).not.toBeNull();
    expect(report.ema50).not.toBeNull();
    expect(report.ema20!).toBeGreaterThan(report.ema50!);
    expect(report.volumePoc).not.toBeNull();
    expect(report.swings.length).toBeGreaterThanOrEqual(4);
    expect(report.bullets.length).toBeGreaterThanOrEqual(3);
    expect(report.tradePlan).not.toBeNull();
    expect(report.tradePlan!.direction).toBe("long");
    expect(report.tradePlan!.stopLoss).toBeLessThan(report.tradePlan!.entryMid);
    expect(report.tradePlan!.target1).toBeGreaterThan(report.tradePlan!.entryMid);
    expect(report.tradePlan!.riskReward1).toBeGreaterThanOrEqual(1.2);

    const overlays = buildAiAnalysisOverlays(report, DEFAULT_AI_ANALYSIS_LAYERS);
    expect(overlays.length).toBeGreaterThanOrEqual(6);
    expect(overlays.some((o) => o.kind === "hline" && o.id === "ai-plan-entry")).toBe(true);
    expect(overlays.some((o) => o.kind === "hline" && o.id === "ai-plan-sl")).toBe(true);
    expect(overlays.some((o) => o.kind === "hline" && o.id === "ai-plan-tp1")).toBe(true);
    expect(overlays.some((o) => o.kind === "box")).toBe(true);
  });

  it("detects bearish trend and generates a valid short trade scenario with SL > entry > TP1 > TP2", () => {
    const bars = makeTrendingBars("down", 140);
    const report = analyzeChart({
      symbol: "YF:TSLA",
      timeframe: "4h",
      bars,
    });

    expect(report.bias).toBe("bearish");
    expect(report.tradePlan).not.toBeNull();
    expect(report.tradePlan!.direction).toBe("short");
    expect(report.tradePlan!.stopLoss).toBeGreaterThan(report.tradePlan!.entryMid);
    expect(report.tradePlan!.target1).toBeLessThan(report.tradePlan!.entryMid);
    expect(report.tradePlan!.target2).toBeLessThan(report.tradePlan!.target1);
  });

  it("respects individual layer toggles cleanly when building overlays", () => {
    const bars = makeTrendingBars("up", 140);
    const report = analyzeChart({ symbol: "BTCUSDT", timeframe: "1h", bars });
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
      bars: makeTrendingBars("up", 8),
    });
    expect(report.bias).toBe("neutral");
    expect(report.tradePlan).toBeNull();
    expect(buildAiAnalysisOverlays(report)).toEqual([]);
  });
});
