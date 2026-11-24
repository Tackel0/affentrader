// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import {
  buildNoiseDataset,
  evaluateNextDayForecast,
  evaluateNoiseScenario,
  evaluatePatternStudy,
  suggestLivePattern,
  type NoiseApiPayload,
  type NoiseDayBar,
} from "@/lib/terminal/noiseMeter";
import { parseTerminalCommand } from "@/lib/terminal/commands";
import { NoiseMeterPanel } from "@/components/NoiseMeterPanel";
import { ResearchTerminal } from "@/components/ResearchTerminal";
import { useChartStore } from "@/stores/useChartStore";

function makeWeekdayDates(count: number, startIso = "2024-01-02"): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startIso}T00:00:00Z`);
  while (out.length < count) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      out.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Builds a synthetic daily series where every +1.2% gap either fades or continues depending on `mode`. */
function buildGapRegimeBars(mode: "fade" | "continue", count = 80): NoiseDayBar[] {
  const dates = makeWeekdayDates(count);
  const bars: NoiseDayBar[] = [];
  let prevClose = 100;

  for (let i = 0; i < count; i++) {
    const isGapUpDay = i > 0 && i % 3 === 0;
    const gapPct = isGapUpDay ? 1.2 : i % 2 === 0 ? 0.1 : -0.1;
    const open = Number((prevClose * (1 + gapPct / 100)).toFixed(4));
    let high: number;
    let low: number;
    let close: number;

    if (isGapUpDay) {
      if (mode === "fade") {
        // Opens +1.2%, fades below previous close (-0.4% vs prevClose)
        close = Number((prevClose * 0.996).toFixed(4));
        high = Number((open * 1.001).toFixed(4));
        low = Number((close * 0.998).toFixed(4));
      } else {
        // Opens +1.2%, never touches prevClose, trends higher to +2.4% vs prevClose
        close = Number((prevClose * 1.024).toFixed(4));
        high = Number((close * 1.002).toFixed(4));
        low = Number((open * 0.999).toFixed(4));
      }
    } else {
      close = Number((open * (i % 2 === 0 ? 1.002 : 0.998)).toFixed(4));
      high = Number((Math.max(open, close) * 1.003).toFixed(4));
      low = Number((Math.min(open, close) * 0.997).toFixed(4));
    }

    bars.push({
      session: dates[i],
      open,
      high,
      low,
      close,
      volume: 10_000_000,
    });
    prevClose = close;
  }

  return bars;
}

/** Builds a deterministic dataset containing multiple exact 7-red-day streaks with known outcomes. */
function buildSevenRedStreakBars(): NoiseDayBar[] {
  // 3 occurrences of 7 red days in a row:
  // Occ 1: day 8 bounces GREEN (+1.8%) with an UP-GAP (+0.8%) that holds
  // Occ 2: day 8 bounces GREEN (+1.4%) with a DOWN-GAP (-0.6%) that reverses & fills
  // Occ 3: day 8 closes RED (-0.5%) after an UP-GAP (+0.7%) that fully fades
  const dates = makeWeekdayDates(70);
  const bars: NoiseDayBar[] = [];
  let prev = 400;

  const pushBar = (idx: number, gapPct: number, closePct: number, fillGap: boolean) => {
    const open = Number((prev * (1 + gapPct / 100)).toFixed(4));
    const close = Number((prev * (1 + closePct / 100)).toFixed(4));
    const high = Number(
      (Math.max(open, close, fillGap && gapPct < 0 ? prev * 1.002 : open) * 1.002).toFixed(4),
    );
    const low = Number(
      (Math.min(open, close, fillGap && gapPct > 0 ? prev * 0.998 : open) * 0.998).toFixed(4),
    );
    bars.push({ session: dates[idx], open, high, low, close, volume: 40_000_000 });
    prev = close;
  };

  let idx = 0;
  // Warmup green day
  pushBar(idx++, 0.1, 0.5, false);

  const scenarios: Array<{ gap: number; close: number; fill: boolean }> = [
    { gap: 0.8, close: 1.8, fill: false }, // bounce green on up-gap
    { gap: -0.6, close: 1.4, fill: true }, // bounce green on down-gap
    { gap: 0.7, close: -0.5, fill: true }, // red close on faded up-gap
  ];

  for (const sc of scenarios) {
    // 7 consecutive red days
    for (let r = 0; r < 7; r++) {
      pushBar(idx++, -0.1, -0.7, false);
    }
    // Day 8 after 7 red days
    pushBar(idx++, sc.gap, sc.close, sc.fill);
    // 6 neutral/green cooldown days so 5d forward returns exist and streak resets
    for (let c = 0; c < 6; c++) {
      pushBar(idx++, 0.1, c % 2 === 0 ? 0.5 : 0.3, false);
    }
  }

  while (idx < dates.length) {
    pushBar(idx++, 0.05, idx % 2 === 0 ? 0.35 : -0.25, false);
  }

  return bars;
}

describe("NoiseMeter empirical engine", () => {
  it("distinguishes high-noise fading premarket pumps from high-signal breakaway gaps", () => {
    const fadeDataset = buildNoiseDataset(buildGapRegimeBars("fade"));
    const continueDataset = buildNoiseDataset(buildGapRegimeBars("continue"));

    const fadeEval = evaluateNoiseScenario(fadeDataset, {
      gapPct: 1.2,
      streakDays: 2,
      streakDirection: "green",
    });
    const contEval = evaluateNoiseScenario(continueDataset, {
      gapPct: 1.2,
      streakDays: 2,
      streakDirection: "green",
    });

    expect(fadeEval.gapStats.sampleSize).toBeGreaterThanOrEqual(20);
    expect(fadeEval.gapStats.gapFillProb).toBe(100);
    expect(fadeEval.gapStats.fullFadeProb).toBe(100);
    expect(fadeEval.gapStats.continuationProb).toBe(0);
    expect(fadeEval.score).toBeGreaterThanOrEqual(65);
    expect(fadeEval.tone).toBe("noise");

    expect(contEval.gapStats.sampleSize).toBeGreaterThanOrEqual(20);
    expect(contEval.gapStats.gapFillProb).toBe(0);
    expect(contEval.gapStats.fullFadeProb).toBe(0);
    expect(contEval.gapStats.continuationProb).toBe(100);
    expect(contEval.score).toBeLessThanOrEqual(38);
    expect(contEval.tone).toBe("signal");
    expect(fadeEval.score).toBeGreaterThan(contEval.score + 40);
  });

  it("computes exact probabilities after 7 consecutive red days and streak x gap combinations", () => {
    const dataset = buildNoiseDataset(buildSevenRedStreakBars());
    const result = evaluateNoiseScenario(dataset, {
      gapPct: 0.8,
      streakDays: 7,
      streakDirection: "red",
      weekday: 1,
    });

    // Exactly 3 instances of =7 red days (2 green, 1 red -> 66.7% / 33.3%), plus day 9 after the 8-red-day scenario -> 4 instances of >=7 red days (3 green, 1 red -> 75.0% / 25.0%)
    expect(result.streakExact.sampleSize).toBe(3);
    expect(result.streakExact.greenCloseProb).toBeCloseTo(66.7, 1);
    expect(result.streakExact.redCloseProb).toBeCloseTo(33.3, 1);
    expect(result.streakExact.fwd5dAvgPct).not.toBeNull();
    expect(result.streakPrimary.mode).toBe("atLeast");
    expect(result.streakPrimary.sampleSize).toBe(4);
    expect(result.streakPrimary.greenCloseProb).toBeCloseTo(75.0, 1);

    // Streak x Gap combo with fallback for small n (< 10) still populates upGap & downGap
    expect(result.combo.upGap.sampleSize).toBeGreaterThan(0);
    expect(result.combo.downGap.sampleSize).toBeGreaterThan(0);

    // Weekdays Mo..Fr are all present and analogues are newest-first
    expect(result.weekdays).toHaveLength(5);
    expect(result.weekdays.map((w) => w.label)).toEqual(["Mo", "Di", "Mi", "Do", "Fr"]);
    if (result.analogues.length >= 2) {
      expect(result.analogues[0].session > result.analogues[1].session).toBe(true);
    }
  });

  it("separates candlestick-color streaks (Close < Open) from close-to-close streaks (QQQ gap-up red candle case)", () => {
    // Reproduces QQQ Nov 12–20: 6 consecutive red candles (Close < Open), where Nov 18 gapped up and closed
    // slightly above Nov 17's close (+0.39%), so close-to-close streak is 2 while candle streak is 6.
    const qqqLikeBars: NoiseDayBar[] = [
      { session: "2026-11-12", open: 680.32, high: 690.0, low: 679.0, close: 688.17, volume: 40_000_000 }, // green candle
      { session: "2026-11-13", open: 688.54, high: 689.0, low: 678.0, close: 679.89, volume: 42_000_000 }, // red candle 1
      { session: "2026-11-16", open: 671.04, high: 672.0, low: 660.0, close: 661.75, volume: 45_000_000 }, // red candle 2
      { session: "2026-11-17", open: 663.05, high: 664.0, low: 655.0, close: 656.95, volume: 44_000_000 }, // red candle 3
      { session: "2026-11-18", open: 661.03, high: 662.0, low: 658.0, close: 659.51, volume: 41_000_000 }, // red candle 4 (C2C +0.39%!)
      { session: "2026-11-19", open: 671.09, high: 672.0, low: 644.0, close: 645.04, volume: 55_000_000 }, // red candle 5
      { session: "2026-11-20", open: 638.84, high: 640.0, low: 606.0, close: 608.45, volume: 70_000_000 }, // red candle 6
    ];

    const dataset = buildNoiseDataset(qqqLikeBars);
    expect(dataset.currentCandleStreak).toEqual({ direction: "red", count: 6 });
    expect(dataset.currentStreak).toEqual({ direction: "red", count: 2 });
    expect(dataset.recentDays).toHaveLength(6);
    expect(dataset.recentDays.every((d) => !d.greenCandle)).toBe(true);
    expect(dataset.recentDays.find((d) => d.session === "2026-11-18")?.greenDay).toBe(true);
  });

  it("computes empirical T+1 green/red probability for 7 red days + massive relief rally with causal RSI/ATR/EMA/SMA factors", () => {
    const buildReliefRegime = (nextDayOutcome: "green" | "red"): NoiseDayBar[] => {
      const dates = makeWeekdayDates(260, "2023-01-03");
      const bars: NoiseDayBar[] = [];
      let prev = 500;
      let idx = 0;

      const push = (pctMove: number) => {
        const open = Number((prev * (1 + (pctMove * 0.2) / 100)).toFixed(4));
        const close = Number((prev * (1 + pctMove / 100)).toFixed(4));
        const high = Number((Math.max(open, close) * 1.003).toFixed(4));
        const low = Number((Math.min(open, close) * 0.997).toFixed(4));
        bars.push({ session: dates[idx++], open, high, low, close, volume: 25_000_000 });
        prev = close;
      };

      // Warmup 120 mixed days so RSI/EMA20/SMA200 are well-seeded
      for (let i = 0; i < 120; i++) {
        push(i % 2 === 0 ? 0.45 : -0.35);
      }

      // 8 clean occurrences of [7 red days] -> [massive +4.5% relief rally] -> [known T+1 outcome]
      for (let cycle = 0; cycle < 8; cycle++) {
        for (let r = 0; r < 7; r++) push(-0.85);
        push(4.5); // Day 0: massive relief rally
        push(nextDayOutcome === "green" ? 1.6 : -1.8); // Day T+1
        for (let c = 0; c < 6; c++) push(c % 2 === 0 ? 0.3 : -0.2);
      }

      // End on 7 red days so dataset.currentRsi14 is depressed before today's simulated +4.5% move
      for (let r = 0; r < 7 && idx < dates.length; r++) push(-0.9);
      return bars;
    };

    const bullFollowDataset = buildNoiseDataset(buildReliefRegime("green"));
    const bearFadeDataset = buildNoiseDataset(buildReliefRegime("red"));

    expect(bullFollowDataset.currentSma200).not.toBeNull();
    expect(bullFollowDataset.currentRsi14).toBeLessThan(45);
    expect(bullFollowDataset.observations.at(-1)?.nextDayGreen).toBeNull();

    const bullForecast = evaluateNextDayForecast(bullFollowDataset, {
      priorStreakDays: 7,
      priorStreakDirection: "red",
      streakBasis: "close",
      todayMovePct: 4.5,
      useExtraFactors: true,
    });
    const bearForecast = evaluateNextDayForecast(bearFadeDataset, {
      priorStreakDays: 7,
      priorStreakDirection: "red",
      streakBasis: "close",
      todayMovePct: 4.5,
      useExtraFactors: true,
    });

    expect(bullForecast.scenarioLabel).toBe("Massive Relief-Rally nach Abverkauf");
    expect(bullForecast.greenProb + bullForecast.redProb).toBeCloseTo(100, 1);
    expect(bearForecast.greenProb + bearForecast.redProb).toBeCloseTo(100, 1);
    expect(bullForecast.projected.rsi14).toBeGreaterThan(bullFollowDataset.currentRsi14);
    expect(bullForecast.factors).toHaveLength(4);
    expect(bullForecast.twins.length).toBeGreaterThan(0);

    // Empirical regime separation: follow-through dataset must strongly favor green T+1 vs fade dataset
    expect(bullForecast.greenProb).toBeGreaterThan(65);
    expect(bearForecast.redProb).toBeGreaterThan(60);
    expect(bullForecast.greenProb).toBeGreaterThan(bearForecast.greenProb + 25);
    expect(bullForecast.avgNextDayPct).toBeGreaterThan(bearForecast.avgNextDayPct);

    // Extra factors toggle works cleanly without NaN
    const coreOnly = evaluateNextDayForecast(bullFollowDataset, {
      priorStreakDays: 7,
      priorStreakDirection: "red",
      streakBasis: "close",
      todayMovePct: 4.5,
      useExtraFactors: false,
    });
    expect(coreOnly.useExtraFactors).toBe(false);
    expect(coreOnly.greenProb + coreOnly.redProb).toBeCloseTo(100, 1);

    // Expected next-day volatility sanity checks
    const vol = bullForecast.expectedVolatility;
    expect(vol.expectedAbsMovePct).toBeGreaterThan(0);
    expect(vol.expectedRangePct).toBeGreaterThan(0);
    expect(vol.expectedTrueRangePct).toBeGreaterThanOrEqual(vol.expectedAbsMovePct);
    expect(vol.expectedTrueRangePct).toBeGreaterThanOrEqual(vol.expectedRangePct);
    expect(vol.expectedRangeP80Pct).toBeGreaterThanOrEqual(vol.expectedRangePct);
    expect(vol.expectedPriceLow).toBeLessThan(vol.projectedPrice);
    expect(vol.expectedPriceHigh).toBeGreaterThan(vol.projectedPrice);
    expect(vol.probMoveOver1Pct).toBeGreaterThanOrEqual(vol.probMoveOver2Pct);
    expect(vol.probMoveOver2Pct).toBeGreaterThanOrEqual(vol.probMoveOver3Pct);
    expect(vol.volRatioVsAtr).toBeGreaterThan(0);
  });

  it("scales expected next-day volatility accurately between calm and high-volatility regimes", () => {
    const buildVolBars = (amplitudePct: number): NoiseDayBar[] => {
      const dates = makeWeekdayDates(120, "2024-01-02");
      const bars: NoiseDayBar[] = [];
      let prev = 300;
      for (let i = 0; i < dates.length; i++) {
        const dir = i % 2 === 0 ? 1 : -1;
        const pctMove = dir * amplitudePct;
        const open = Number((prev * (1 + (pctMove * 0.25) / 100)).toFixed(4));
        const close = Number((prev * (1 + pctMove / 100)).toFixed(4));
        const span = Math.max(0.2, amplitudePct * 0.45);
        const high = Number((Math.max(open, close) * (1 + span / 100)).toFixed(4));
        const low = Number((Math.min(open, close) * (1 - span / 100)).toFixed(4));
        bars.push({ session: dates[i], open, high, low, close, volume: 20_000_000 });
        prev = close;
      }
      return bars;
    };

    const calmDs = buildNoiseDataset(buildVolBars(0.45));
    const wildDs = buildNoiseDataset(buildVolBars(3.2));

    const calmFc = evaluateNextDayForecast(calmDs, {
      priorStreakDays: 2,
      priorStreakDirection: "red",
      streakBasis: "close",
      todayMovePct: 0.5,
    });
    const wildFc = evaluateNextDayForecast(wildDs, {
      priorStreakDays: 2,
      priorStreakDirection: "red",
      streakBasis: "close",
      todayMovePct: 3.5,
    });

    expect(wildFc.expectedVolatility.expectedAbsMovePct).toBeGreaterThan(
      calmFc.expectedVolatility.expectedAbsMovePct * 3,
    );
    expect(wildFc.expectedVolatility.expectedRangePct).toBeGreaterThan(
      calmFc.expectedVolatility.expectedRangePct * 3,
    );
    expect(wildFc.expectedVolatility.probMoveOver2Pct).toBeGreaterThan(
      calmFc.expectedVolatility.probMoveOver2Pct + 40,
    );
  });

  it("evaluates OddStats-style -5% -> +5% shock patterns with 100% bear-market incidence and further drop to bottom", () => {
    const dates = makeWeekdayDates(340, "2020-01-02");
    const bars: NoiseDayBar[] = [];
    let prev = 200;
    let idx = 0;

    const pushPct = (pctMove: number) => {
      const open = Number((prev * (1 + (pctMove * 0.25) / 100)).toFixed(4));
      const close = Number((prev * (1 + pctMove / 100)).toFixed(4));
      const high = Number((Math.max(open, close) * 1.003).toFixed(4));
      const low = Number((Math.min(open, close) * 0.997).toFixed(4));
      bars.push({ session: dates[idx++], open, high, low, close, volume: 60_000_000 });
      prev = close;
    };

    // Bull run up to peak (~260)
    for (let i = 0; i < 60; i++) pushPct(0.45);
    // Bear Market 1: drop ~15%, then [-5.5% -> +5.5%] shock, then drop another ~15% to cycle bottom, then +30% bull recovery
    for (let i = 0; i < 10; i++) pushPct(-1.6);
    pushPct(-5.5);
    pushPct(5.5); // Match 1 inside Bear Market 1
    for (let i = 0; i < 10; i++) pushPct(-1.8); // drops >16% further to bear bottom
    for (let i = 0; i < 40; i++) pushPct(0.8); // recovers >35% -> exits Bear Market 1 cleanly

    // Bear Market 2: drop ~12%, then [-6.0% -> +5.2%] shock, then drop ~12% further to bottom, then +28% bull recovery
    for (let i = 0; i < 10; i++) pushPct(-1.5);
    pushPct(-6.0);
    pushPct(5.2); // Match 2 inside Bear Market 2
    for (let i = 0; i < 8; i++) pushPct(-1.7); // drops ~12.8% further to bear bottom
    for (let i = 0; i < 50; i++) pushPct(0.7); // recovers >35% -> exits Bear Market 2 cleanly

    // End with a quiet day + yesterday -5.67% for suggestLivePattern test
    while (idx < dates.length - 1) pushPct(0.15);
    pushPct(-5.67);

    const dataset = buildNoiseDataset(bars);
    const study = evaluatePatternStudy(dataset, {
      ticker: "QQQ",
      prevDayRule: { op: "lte", thresholdPct: -5 },
      day0Rule: { op: "gte", thresholdPct: 5 },
    });

    expect(study.sampleSize).toBe(2);
    expect(study.bearCycleCount).toBe(2);
    expect(study.bearCycleRate).toBe(100);
    expect(study.bottomEvaluatedCount).toBe(2);
    expect(study.droppedFurtherRate).toBe(100);
    expect(study.minFurtherDropPct).not.toBeNull();
    expect(study.minFurtherDropPct!).toBeLessThanOrEqual(-10);
    expect(study.worstFurtherDropPct!).toBeLessThan(study.minFurtherDropPct!);
    expect(study.nextDayVol.sampleSize).toBe(2);
    expect(study.nextDayVol.avgAbsMovePct).toBeGreaterThan(0);
    expect(study.nextDayVol.avgRangePct).toBeGreaterThan(0);
    expect(study.horizons).toHaveLength(6);
    expect(study.headline).toContain("QQQ");
    expect(study.headline).toContain("genau 2-mal");
    expect(study.bullets.some((b) => b.includes("100,0 % (2/2) traten im Bärenmarkt"))).toBe(true);
    expect(study.bullets.some((b) => b.includes("fielen danach noch mindestens"))).toBe(true);

    const bullOnly = evaluatePatternStudy(dataset, {
      ticker: "QQQ",
      prevDayRule: { op: "lte", thresholdPct: -5 },
      day0Rule: { op: "gte", thresholdPct: 5 },
      regimeFilter: "bull",
    });
    expect(bullOnly.sampleSize).toBe(0);

    // Live auto-suggestion: yesterday -5.67% + today +7.0% -> <= -5.0% -> >= +5.0%
    const suggested = suggestLivePattern(dataset, 7.0);
    expect(suggested.usedLiveToday).toBe(true);
    expect(suggested.prevDayRule).toEqual({ op: "lte", thresholdPct: -5 });
    expect(suggested.day0Rule).toEqual({ op: "gte", thresholdPct: 5 });
  });
});

describe("NoiseMeter terminal commands", () => {
  it("parses single-token and ticker-scoped NoiseMeter commands", () => {
    expect(parseTerminalCommand("NOISE")).toEqual({ kind: "view", view: "noise", ticker: "AAPL" });
    expect(parseTerminalCommand("NOISEMETER", "SPY")).toEqual({ kind: "view", view: "noise", ticker: "SPY" });
    expect(parseTerminalCommand("GAP", "QQQ")).toEqual({ kind: "view", view: "noise", ticker: "QQQ" });
    expect(parseTerminalCommand("GAPS", "SPY")).toEqual({ kind: "view", view: "noise", ticker: "SPY" });
    expect(parseTerminalCommand("STREAK", "SPY")).toEqual({ kind: "view", view: "noise", ticker: "SPY" });
    expect(parseTerminalCommand("STREAKS", "SPY")).toEqual({ kind: "view", view: "noise", ticker: "SPY" });

    expect(parseTerminalCommand("SPY NOISE")).toEqual({ kind: "view", view: "noise", ticker: "SPY" });
    expect(parseTerminalCommand("NOISE NVDA")).toEqual({ kind: "view", view: "noise", ticker: "NVDA" });
    expect(parseTerminalCommand("QQQ GAP")).toEqual({ kind: "view", view: "noise", ticker: "QQQ" });
    expect(parseTerminalCommand("^GSPC STREAK")).toEqual({ kind: "view", view: "noise", ticker: "^GSPC" });
  });
});

describe("NoiseMeterPanel & ResearchTerminal UI", () => {
  const sampleBars = buildSevenRedStreakBars();
  const samplePayload: NoiseApiPayload = {
    ticker: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    exchange: "NYSE ARCA",
    currency: "USD",
    timezone: "America/New_York",
    asOf: sampleBars[sampleBars.length - 1].session,
    years: 10,
    totalDays: sampleBars.length,
    live: {
      prevClose: sampleBars[sampleBars.length - 1].close,
      lastPrice: Number((sampleBars[sampleBars.length - 1].close * 1.008).toFixed(2)),
      liveGapPct: 0.8,
      priceSource: "premarket",
      currentStreak: { direction: "red", count: 2 },
      currentCandleStreak: { direction: "red", count: 6 },
      currentAtr14Pct: 1.15,
      nextWeekday: 1,
    },
    bars: sampleBars,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    useChartStore.setState({ symbol: "YF:SPY", timeframe: "1D" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/terminal-noise")) {
          const parsed = new URL(url, "http://localhost");
          const ticker = parsed.searchParams.get("ticker") || "SPY";
          return {
            ok: true,
            status: 200,
            json: async () => ({ ...samplePayload, ticker }),
          } as Response;
        }
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders executive overview, expected next-day volatility, and 3 primary tabs with zero refetches", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const { container } = render(<NoiseMeterPanel initialTicker="SPY" />);

    await waitFor(() => {
      expect(container.querySelector(".noise-hero")).not.toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("SPDR S&P 500 ETF Trust");
    expect(container.querySelectorAll(".noise-exec-tile")).toHaveLength(3);

    // Default active primary view: Morgen & Vola (T+1 + Expected Volatility)
    expect(container.textContent).toContain("Morgen-Wahrscheinlichkeit (T+1)");
    expect(container.textContent).toContain("Erwartete Volatilität morgen (T+1)");
    expect(container.querySelector(".noise-vol-box")).not.toBeNull();
    expect(container.querySelectorAll(".noise-recent-day").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".noise-t1-factor")).toHaveLength(4);

    // Select 7T + Rot in default Kerzen (C vs O) mode and test +5,0% relief rally today
    const panel = within(container);
    expect(panel.getByRole("button", { name: "Max" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(panel.getByRole("button", { name: "Rot" }));
    fireEvent.click(panel.getByRole("button", { name: "7T" }));
    fireEvent.click(panel.getByRole("button", { name: "+5,0%" }));
    expect(container.textContent).toContain("Massive Relief-Rally nach Abverkauf");

    // Toggle Extra-Faktoren (RSI, ATR, Trend) off & back on
    const factorToggle = panel.getByRole("button", { name: /Extra-Faktoren/i });
    expect(factorToggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(factorToggle);
    expect(factorToggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(factorToggle);
    expect(factorToggle.getAttribute("aria-pressed")).toBe("true");

    // Switch basis to Close (vs Vortag) and select 7T + Rot
    fireEvent.click(panel.getByRole("button", { name: /Close \(vs Vortag\)/i }));
    fireEvent.click(panel.getByRole("button", { name: "Rot" }));
    fireEvent.click(panel.getByRole("button", { name: "7T" }));

    // Switch primary tab to Muster-Scanner and test -5% -> +5% preset
    fireEvent.click(panel.getByRole("tab", { name: /Muster-Scanner/i }));
    expect(container.textContent).toContain("Historischer Muster-Scanner");
    fireEvent.click(panel.getByRole("button", { name: "−5 % → +5 %" }));
    expect(container.textContent).toContain("Tag −1 ≤ −5,0 % → Tag 0 ≥ +5,0 %");

    // Switch primary tab to Premarket & Gaps and verify KPIs + sub-tabs
    fireEvent.click(panel.getByRole("tab", { name: /Premarket & Gaps/i }));
    expect(container.textContent).toContain("Gap-Close-Chance (Intraday)");
    expect(container.textContent).toContain("Nach ≥ 7 roten Tagen");
    expect(container.textContent).toContain("75,0 %");

    // Switch detail tabs: Streak-Tabelle & Wochentage, then Historische Analogien
    fireEvent.click(panel.getByRole("tab", { name: /Streak-Tabelle/i }));
    expect(container.textContent).toContain("Nach roten Tagen in Folge");
    expect(container.querySelectorAll(".noise-weekday-card")).toHaveLength(5);

    fireEvent.click(panel.getByRole("tab", { name: /Historische Analogien/i }));
    expect(container.textContent).toContain("Vorserie");

    // Pure client-side recompute across all tabs and controls
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens NoiseMeter from ResearchTerminal command bar via SPY NOISE", async () => {
    const { container } = render(<ResearchTerminal externalWindow={false} initialView="help" />);
    const input = within(container).getByRole("textbox", { name: /Ticker oder Terminal-Befehl/i });
    fireEvent.change(input, { target: { value: "SPY NOISE" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(container.querySelector('[aria-label="NoiseMeter Statistik"]')).not.toBeNull();
    });
    await waitFor(() => {
      expect(container.querySelector(".noise-gauge")).not.toBeNull();
    });
  });
});
