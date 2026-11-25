// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import {
  buildNoiseDataset,
  buildPatternMatchesCsv,
  evaluateNextDayForecast,
  evaluateNoiseScenario,
  evaluatePatternStudy,
  formatPatternSummaryText,
  getLivePatternSnapshot,
  matchesLivePatternSnapshot,
  suggestLiveLeadupPattern,
  suggestLivePattern,
  type NoiseApiPayload,
  type NoiseDayBar,
} from "@/lib/terminal/noiseMeter";
import {
  formatSessionDate,
  isTodayRegularClosed,
  nextTradingWeekday,
  normalizeNoiseDailyBars,
  resolveLiveQuote,
} from "@/lib/terminal/noiseSession";
import type { YahooChart } from "@/lib/market/yahoo";
import { parseTerminalCommand } from "@/lib/terminal/commands";
import { NoiseMeterPanel, NumericPctInput } from "@/components/NoiseMeterPanel";
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
    const qqqWithBounce = [
      ...qqqLikeBars,
      { session: "2026-11-23", open: 655.98, high: 657.53, low: 641.95, close: 651.03, volume: 75_000_000 }, // +7.00% green close, red candle body
    ];
    const datasetAfterBounce = buildNoiseDataset(qqqWithBounce);
    expect(datasetAfterBounce.currentStreak).toEqual({ direction: "green", count: 1 });
    expect(datasetAfterBounce.currentCandleStreak).toEqual({ direction: "red", count: 7 });
    expect(datasetAfterBounce.recentDays.at(-1)?.greenDay).toBe(true);
    expect(datasetAfterBounce.recentDays.at(-1)?.greenCandle).toBe(false);
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

    // Multi-day lookback (Tag -3 <= -1%, Tag -2 <= -1%, Tag -1 <= -5%, Tag 0 >= +5%) + cumulative Vor-7T <= -10%
    const multiDay = evaluatePatternStudy(dataset, {
      ticker: "QQQ",
      dayMinus3Rule: { op: "lte", thresholdPct: -1 },
      dayMinus2Rule: { op: "lte", thresholdPct: -1 },
      prevDayRule: { op: "lte", thresholdPct: -5 },
      day0Rule: { op: "gte", thresholdPct: 5 },
      priorWindowRule: { days: 7, op: "lte", thresholdPct: -10 },
    });
    expect(multiDay.sampleSize).toBe(2);
    expect(multiDay.ruleDescription).toContain("Vor-7T ≤ −10,0 %");
    expect(multiDay.ruleDescription).toContain("Tag −3 ≤ −1,0 %");
    expect(multiDay.ruleDescription).toContain("Tag −2 ≤ −1,0 %");
    expect(multiDay.matches[0].dayMinus3Pct).not.toBeNull();
    expect(multiDay.matches[0].priorWindowPct!).toBeLessThanOrEqual(-10);

    // Live auto-suggestion: yesterday -5.67% + today +7.0% -> <= -5.0% -> >= +5.0%
    const suggested = suggestLivePattern(dataset, 7.0);
    expect(suggested.usedLiveToday).toBe(true);
    expect(suggested.prevDayRule).toEqual({ op: "lte", thresholdPct: -5 });
    expect(suggested.day0Rule).toEqual({ op: "gte", thresholdPct: 5 });
  });

  it("partitions Bärenmarkt and Bullenmarkt strictly by inBearCycle without leaking below-200-SMA bull pullbacks", () => {
    const dates = makeWeekdayDates(340, "2021-01-04");
    const bars: NoiseDayBar[] = [];
    let prev = 100;
    let idx = 0;

    const pushPct = (pctMove: number) => {
      const open = Number((prev * (1 + (pctMove * 0.2) / 100)).toFixed(4));
      const close = Number((prev * (1 + pctMove / 100)).toFixed(4));
      const high = Number((Math.max(open, close) * 1.002).toFixed(4));
      const low = Number((Math.min(open, close) * 0.998).toFixed(4));
      bars.push({ session: dates[idx++], open, high, low, close, volume: 40_000_000 });
      prev = close;
    };

    // 1. Flat-ish bull plateau for 210 days around ~110 so SMA200 is seeded (~108)
    for (let i = 0; i < 210; i++) pushPct(i % 2 === 0 ? 0.12 : -0.08);

    // 2. Mild bull pullback (-8% from peak -> NOT a >=20% bear cycle, but dips BELOW 200-SMA!)
    for (let i = 0; i < 6; i++) pushPct(-1.2);
    pushPct(-5.5);
    pushPct(5.5); // Match 1: Bull market (inBearCycle === false) while below 200-SMA!
    for (let i = 0; i < 15; i++) pushPct(0.9); // Recover back above 200-SMA to new highs

    // 3. Bull-market shock well above 200-SMA
    pushPct(-5.2);
    pushPct(5.4); // Match 2: Bull market (inBearCycle === false, aboveSma200 === true)
    for (let i = 0; i < 12; i++) pushPct(0.5);

    // 4. Genuine >=20% bear cycle with a shock match and +30% recovery
    for (let i = 0; i < 12; i++) pushPct(-1.6);
    pushPct(-5.5);
    pushPct(5.5); // Match 3: Genuine bear market (inBearCycle === true)
    for (let i = 0; i < 10; i++) pushPct(-1.5);
    while (idx < dates.length) pushPct(0.75);

    const ds = buildNoiseDataset(bars);
    const rule = {
      ticker: "SPY",
      prevDayRule: { op: "lte" as const, thresholdPct: -5 },
      day0Rule: { op: "gte" as const, thresholdPct: 5 },
    };

    const allStudy = evaluatePatternStudy(ds, { ...rule, regimeFilter: "all" });
    const bearStudy = evaluatePatternStudy(ds, { ...rule, regimeFilter: "bear" });
    const bullStudy = evaluatePatternStudy(ds, { ...rule, regimeFilter: "bull" });

    expect(allStudy.sampleSize).toBe(3);
    // Verify one of the bull matches really was below 200-SMA (the exact case that previously leaked into "bear")
    expect(allStudy.matches.some((m) => !m.inBearCycle && m.belowSma200 === true)).toBe(true);

    // Bear filter MUST ONLY include genuine inBearCycle === true matches (100% bear rate)
    expect(bearStudy.sampleSize).toBe(1);
    expect(bearStudy.bearCycleRate).toBe(100);
    expect(bearStudy.matches.every((m) => m.inBearCycle)).toBe(true);
    expect(bearStudy.headline).toContain("im Bärenmarkt");

    // Bull filter MUST include ALL inBearCycle === false matches (including below-200-SMA pullbacks)
    expect(bullStudy.sampleSize).toBe(2);
    expect(bullStudy.bearCycleRate).toBe(0);
    expect(bullStudy.matches.every((m) => !m.inBearCycle)).toBe(true);
    expect(bullStudy.headline).toContain("im Bullenmarkt");

    // Exact partition invariant
    expect(bearStudy.sampleSize + bullStudy.sampleSize).toBe(allStudy.sampleSize);
  });

  it("does not count the trough day's own intraday lower wick as a future drop to bottom", () => {
    const dates = makeWeekdayDates(120, "2022-01-03");
    const bars: NoiseDayBar[] = [];
    let idx = 0;

    // Peak at 200
    for (let i = 0; i < 10; i++) {
      const c = 180 + i * 2;
      bars.push({ session: dates[idx++], open: c - 0.5, high: c + 2, low: c - 1, close: c, volume: 50_000_000 });
    }
    // Decline into bear market (> 20% drop from 200 peak -> below 160)
    let prev = bars.at(-1)!.close; // 198, peak high = 200
    for (let i = 0; i < 10; i++) {
      const c = Number((prev * 0.975).toFixed(4));
      bars.push({ session: dates[idx++], open: prev, high: prev * 1.002, low: c * 0.998, close: c, volume: 55_000_000 });
      prev = c;
    }
    // Earlier bear-cycle shock BEFORE the trough (should measure real future drop to trough low = 110)
    const preTroughDrop = Number((prev * 0.94).toFixed(4));
    bars.push({ session: dates[idx++], open: prev, high: prev, low: preTroughDrop, close: preTroughDrop, volume: 65_000_000 });
    const preTroughBounce = Number((preTroughDrop * 1.055).toFixed(4));
    const earlierMatchSession = dates[idx];
    bars.push({
      session: dates[idx++],
      open: preTroughDrop * 1.01,
      high: preTroughBounce * 1.005,
      low: preTroughDrop * 1.005,
      close: preTroughBounce,
      volume: 65_000_000,
    });
    prev = preTroughBounce;

    // 4 more down days heading to trough
    for (let i = 0; i < 4; i++) {
      const c = Number((prev * 0.97).toFixed(4));
      bars.push({ session: dates[idx++], open: prev, high: prev, low: c, close: c, volume: 60_000_000 });
      prev = c;
    }
    // Day before trough: -5.5%
    const preBottomClose = Number((prev * 0.945).toFixed(4));
    bars.push({ session: dates[idx++], open: prev, high: prev, low: preBottomClose, close: preBottomClose, volume: 80_000_000 });

    // EXACT TROUGH DAY: plunges intraday to massive lower wick (110, -14%+ below close),
    // then reverses to close +5.8% above prevClose! Never trades lower afterwards.
    const troughClose = Number((preBottomClose * 1.058).toFixed(4));
    const troughWickLow = Number((troughClose * 0.85).toFixed(4)); // -15% intraday wick below close!
    const troughSession = dates[idx];
    bars.push({
      session: dates[idx++],
      open: preBottomClose * 0.96,
      high: troughClose * 1.005,
      low: troughWickLow,
      close: troughClose,
      volume: 120_000_000,
    });
    prev = troughClose;

    // Clean +35% bull recovery -> confirms bear cycle finished at troughSession
    while (idx < dates.length) {
      const c = Number((prev * 1.008).toFixed(4));
      bars.push({ session: dates[idx++], open: prev * 1.001, high: c * 1.003, low: prev * 1.001, close: c, volume: 45_000_000 });
      prev = c;
    }

    const ds = buildNoiseDataset(bars);
    const study = evaluatePatternStudy(ds, {
      ticker: "QQQ",
      prevDayRule: { op: "lte", thresholdPct: -5 },
      day0Rule: { op: "gte", thresholdPct: 5 },
    });

    expect(study.sampleSize).toBe(2);
    const troughMatch = study.matches.find((m) => m.session === troughSession)!;
    const earlierMatch = study.matches.find((m) => m.session === earlierMatchSession)!;

    expect(troughMatch).toBeDefined();
    expect(troughMatch.inBearCycle).toBe(true);
    // Trough day's OWN lower wick MUST NOT be counted as a future drop after close!
    expect(troughMatch.dropToBottomPct).toBe(0);
    expect(troughMatch.daysToBottom).toBe(0);

    // Earlier match strictly before trough MUST measure the real future drop to troughWickLow
    expect(earlierMatch).toBeDefined();
    expect(earlierMatch.inBearCycle).toBe(true);
    expect(earlierMatch.dropToBottomPct!).toBeLessThan(-10);
    expect(earlierMatch.daysToBottom!).toBeGreaterThan(0);
  });

  it("leaves dropToBottomPct and daysToBottom null (laufend) for matches in an ongoing bear market", () => {
    const dates = makeWeekdayDates(90, "2026-01-02");
    const bars: NoiseDayBar[] = [];
    let idx = 0;
    let prev = 200;

    // Peak around 220
    for (let i = 0; i < 15; i++) {
      const c = Number((prev * 1.006).toFixed(4));
      bars.push({ session: dates[idx++], open: prev, high: c * 1.002, low: prev * 0.998, close: c, volume: 40_000_000 });
      prev = c;
    }
    // Drop > 22% into an ongoing bear market
    for (let i = 0; i < 18; i++) {
      const c = Number((prev * 0.985).toFixed(4));
      bars.push({ session: dates[idx++], open: prev, high: prev * 1.001, low: c * 0.998, close: c, volume: 55_000_000 });
      prev = c;
    }
    // Pattern match [-5.5% -> +5.5%] inside the ONGOING bear market
    const shockDown = Number((prev * 0.945).toFixed(4));
    bars.push({ session: dates[idx++], open: prev, high: prev, low: shockDown, close: shockDown, volume: 70_000_000 });
    const shockUp = Number((shockDown * 1.055).toFixed(4));
    bars.push({ session: dates[idx++], open: shockDown * 1.01, high: shockUp * 1.003, low: shockDown * 1.005, close: shockUp, volume: 75_000_000 });
    prev = shockUp;

    // 20+ more bars oscillating BELOW +20% recovery (so remainingBars >= 5, yet bear market is STILL ONGOING!)
    while (idx < dates.length) {
      const move = idx % 2 === 0 ? 0.993 : 1.006;
      const c = Number((prev * move).toFixed(4));
      bars.push({ session: dates[idx++], open: prev, high: Math.max(prev, c) * 1.002, low: Math.min(prev, c) * 0.998, close: c, volume: 50_000_000 });
      prev = c;
    }

    const ds = buildNoiseDataset(bars);
    expect(ds.currentInBearCycle).toBe(true);

    const study = evaluatePatternStudy(ds, {
      ticker: "QQQ",
      prevDayRule: { op: "lte", thresholdPct: -5 },
      day0Rule: { op: "gte", thresholdPct: 5 },
    });

    expect(study.sampleSize).toBe(1);
    expect(study.bearCycleCount).toBe(1);
    expect(study.bottomEvaluatedCount).toBe(0);
    expect(study.matches[0].inBearCycle).toBe(true);
    expect(study.matches[0].bearOngoing).toBe(true);
    expect(study.matches[0].dropToBottomPct).toBeNull();
    expect(study.matches[0].daysToBottom).toBeNull();
    expect(study.bullets.some((b) => b.includes("laufenden Bärenmarkt"))).toBe(true);
  });

  it("deduplicates overlapping cluster hits via minGapDays, computes exact regimeCounts, and exports summary & CSV", () => {
    const dates = makeWeekdayDates(70, "2024-01-02");
    const bars: NoiseDayBar[] = [];
    let prev = 100;
    let idx = 0;

    const pushPct = (pctMove: number) => {
      const open = Number((prev * (1 + (pctMove * 0.2) / 100)).toFixed(4));
      const close = Number((prev * (1 + pctMove / 100)).toFixed(4));
      const high = Number((Math.max(open, close) * 1.002).toFixed(4));
      const low = Number((Math.min(open, close) * 0.998).toFixed(4));
      bars.push({ session: dates[idx++], open, high, low, close, volume: 30_000_000 });
      prev = close;
    };

    for (let i = 0; i < 10; i++) pushPct(0.3);
    // Cluster 1: 3 matches within 6 trading days (-3.5% drops)
    pushPct(-3.5);
    pushPct(0.4);
    pushPct(-3.8);
    pushPct(0.2);
    pushPct(-4.1);
    // Quiet gap of 15 trading days
    for (let i = 0; i < 15; i++) pushPct(0.2);
    // Cluster 2: 2 matches within 3 trading days
    pushPct(-3.6);
    pushPct(0.3);
    pushPct(-3.9);
    // End with a sharp 5-day selloff (~ -11%) + +4.5% bounce for live leadup snapshot test
    while (idx < dates.length - 6) pushPct(0.15);
    for (let i = 0; i < 5; i++) pushPct(-2.3);
    pushPct(4.5);

    const ds = buildNoiseDataset(bars);
    const raw = evaluatePatternStudy(ds, {
      ticker: "SPY",
      prevDayRule: { op: "any", thresholdPct: -3 },
      day0Rule: { op: "lte", thresholdPct: -3 },
      minGapDays: 0,
    });
    const deduped = evaluatePatternStudy(ds, {
      ticker: "SPY",
      prevDayRule: { op: "any", thresholdPct: -3 },
      day0Rule: { op: "lte", thresholdPct: -3 },
      minGapDays: 10,
    });

    expect(raw.sampleSize).toBe(5);
    expect(deduped.rawSampleSize).toBe(5);
    expect(deduped.sampleSize).toBe(2); // Exactly 1 per independent cluster!
    expect(deduped.regimeCounts.all).toBe(2);
    expect(deduped.regimeCounts.bear + deduped.regimeCounts.bull).toBe(deduped.regimeCounts.all);

    // Live snapshot & leadup auto-suggest on the final 5-day selloff + +4.5% bounce
    const snap = getLivePatternSnapshot(ds, null);
    expect(snap.usingLiveToday).toBe(false);
    expect(snap.day0Pct).toBeCloseTo(4.5, 1);
    expect(snap.priorWindow[5]!).toBeLessThan(-10);

    const leadup = suggestLiveLeadupPattern(ds, null);
    expect(leadup.priorWindowRule.op).toBe("lte");
    expect(leadup.priorWindowRule.thresholdPct).toBeLessThanOrEqual(-8);
    expect(leadup.day0Rule).toEqual({ op: "gte", thresholdPct: 4 });

    // Current tape matches the auto-suggested leadup rule
    expect(
      matchesLivePatternSnapshot(snap, {
        prevDayRule: { op: "any", thresholdPct: 0 },
        day0Rule: leadup.day0Rule,
        priorWindowRule: leadup.priorWindowRule,
        regimeFilter: "all",
      }),
    ).toBe(true);

    // Summary formatter & CSV exporter
    const text = formatPatternSummaryText("SPY", deduped);
    expect(text).toContain("SPY Muster-Scanner");
    expect(text).toContain("Folge-Performance:");

    const csv = buildPatternMatchesCsv(deduped, "days", 5, 2);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("Datum,Tag-1_%,Tag0_%,Regime,T+1_%");
    expect(lines).toHaveLength(1 + deduped.matches.length);
  });
});

describe("NoiseMeter Regular-Close-Promotion & live quote resolution", () => {
  const tz = "America/New_York";
  // Monday 2026-11-23 EST (UTC-5):
  // Premarket 04:00-09:30 ET (09:00-14:30 UTC), Regular 09:30-16:00 ET (14:30-21:00 UTC), After-hours 16:00-20:00 ET (21:00-01:00 UTC)
  const monPreStart = Date.UTC(2026, 10, 23, 9, 0);
  const monRegStart = Date.UTC(2026, 10, 23, 14, 30);
  const monRegEnd = Date.UTC(2026, 10, 23, 21, 0);
  const monPostEnd = Date.UTC(2026, 10, 24, 1, 0);
  const friBarTime = Date.UTC(2026, 10, 20, 14, 30);
  const monBarTime = Date.UTC(2026, 10, 23, 14, 30);

  const dailyBars = [
    { time: friBarTime, open: 590, high: 595, low: 588, close: 592, volume: 50_000_000 },
    { time: monBarTime, open: 598, high: 604, low: 596, close: 602, volume: 60_000_000 },
  ];

  const makeChart = (
    bars: YahooChart["bars"],
    sessions?: YahooChart["meta"]["sessions"],
  ): YahooChart => ({
    meta: {
      symbol: "SPY",
      name: "SPY",
      exchange: "NYSE ARCA",
      currency: "USD",
      type: "etf",
      timezone: tz,
      price: 602,
      previousClose: 592,
      dayHigh: 604,
      dayLow: 596,
      volume: 60_000_000,
      time: monRegEnd,
      gmtOffset: -18000,
      sessions,
    },
    bars,
    adjClose: bars.map((b) => b.close),
    events: { dividends: [], splits: [] },
  });

  const sessionsWithExtended = {
    regular: [[monRegStart, monRegEnd] as const],
    extended: [[monPreStart, monPostEnd] as const],
  };

  it("keeps today's bar as in-progress during regular hours and promotes it immediately after regular close", () => {
    const todaySession = formatSessionDate(monRegStart, tz);
    expect(todaySession).toBe("2026-11-23");

    // 1. Intraday regular session (11:30 ET = 16:30 UTC): MUST NOT promote todayBar
    const duringRegularNow = Date.UTC(2026, 10, 23, 16, 30);
    const closedDuring = isTodayRegularClosed(todaySession, tz, sessionsWithExtended, duringRegularNow - 300_000, duringRegularNow);
    expect(closedDuring).toBe(false);

    const normDuring = normalizeNoiseDailyBars(dailyBars, tz, duringRegularNow, { promoteToday: closedDuring });
    expect(normDuring.promotedToday).toBe(false);
    expect(normDuring.completed.map((b) => b.session)).toEqual(["2026-11-20"]);
    expect(normDuring.todayBar?.session).toBe("2026-11-23");

    const quoteDuring = resolveLiveQuote(
      makeChart(dailyBars, sessionsWithExtended),
      makeChart([{ time: duringRegularNow - 300_000, open: 600, high: 602, low: 599, close: 601, volume: 1_000_000 }], sessionsWithExtended),
      normDuring.completed,
      normDuring.todayBar,
      duringRegularNow,
      tz,
    );
    expect(quoteDuring.priceSource).toBe("regular");
    expect(quoteDuring.prevClose).toBe(592);
    expect(quoteDuring.liveGapPct).toBeCloseTo(((598 - 592) / 592) * 100, 1);
    expect(quoteDuring.liveTodayReturnPct).toBeCloseTo(((602 - 592) / 592) * 100, 1);
    expect(nextTradingWeekday(duringRegularNow, tz, closedDuring)).toBe(1); // Monday

    // 2. After regular close in after-hours (17:15 ET = 22:15 UTC): MUST promote todayBar into completed!
    const afterCloseNow = Date.UTC(2026, 10, 23, 22, 15);
    const ahBarTime = Date.UTC(2026, 10, 23, 22, 10);
    const closedAfter = isTodayRegularClosed(todaySession, tz, sessionsWithExtended, ahBarTime, afterCloseNow);
    expect(closedAfter).toBe(true);

    const normAfter = normalizeNoiseDailyBars(dailyBars, tz, afterCloseNow, { promoteToday: closedAfter });
    expect(normAfter.promotedToday).toBe(true);
    expect(normAfter.completed.map((b) => b.session)).toEqual(["2026-11-20", "2026-11-23"]);
    expect(normAfter.todayBar).toBeNull();

    const quoteAfter = resolveLiveQuote(
      makeChart(dailyBars, sessionsWithExtended),
      makeChart([{ time: ahBarTime, open: 603, high: 605, low: 602.5, close: 605, volume: 200_000 }], sessionsWithExtended),
      normAfter.completed,
      normAfter.todayBar,
      afterCloseNow,
      tz,
    );
    expect(quoteAfter.priceSource).toBe("afterhours");
    expect(quoteAfter.prevClose).toBe(602); // Anchored to promoted Monday close!
    expect(quoteAfter.lastPrice).toBe(605);
    expect(quoteAfter.liveGapPct).toBeCloseTo(((605 - 602) / 602) * 100, 1);
    expect(nextTradingWeekday(afterCloseNow, tz, closedAfter)).toBe(2); // Advances Mon -> Tue

    // 3. Post-regular-close index without extended hours (e.g. ^GSPC at 18:00 ET, last 5m bar at 15:55 ET):
    // MUST promote todayBar AND ignore stale 15:55 ET intraday bar -> clean last-close (0% gap)
    const indexSessions = { regular: [[monRegStart, monRegEnd] as const], extended: [] };
    const staleIntradayBar = { time: monRegEnd - 300_000, open: 601, high: 601.5, low: 600.5, close: 601, volume: 500_000 };
    const indexCloseNow = Date.UTC(2026, 10, 23, 23, 0);
    const closedIndex = isTodayRegularClosed(todaySession, tz, indexSessions, staleIntradayBar.time, indexCloseNow);
    expect(closedIndex).toBe(true);
    const normIndex = normalizeNoiseDailyBars(dailyBars, tz, indexCloseNow, { promoteToday: closedIndex });
    const quoteIndex = resolveLiveQuote(
      makeChart(dailyBars, indexSessions),
      makeChart([staleIntradayBar], indexSessions),
      normIndex.completed,
      normIndex.todayBar,
      indexCloseNow,
      tz,
    );
    expect(quoteIndex.priceSource).toBe("last-close");
    expect(quoteIndex.prevClose).toBe(602);
    expect(quoteIndex.liveGapPct).toBe(0);

    // Friday after regular close advances nextTradingWeekday to Monday (1)
    const friAfterClose = Date.UTC(2026, 10, 20, 22, 0);
    expect(nextTradingWeekday(friAfterClose, tz, true)).toBe(1);
  });
});

describe("NumericPctInput component", () => {
  afterEach(() => cleanup());

  it("handles clearing, minus sign, German comma decimals, clamping, blur revert, and keyboard stepping without snapping to 0", () => {
    const changes: number[] = [];
    function Wrapper({ initial = -5 }: { initial?: number }) {
      const [val, setVal] = React.useState(initial);
      return (
        <div>
          <NumericPctInput
            value={val}
            min={-40}
            max={40}
            step={0.5}
            ariaLabel="Test Prozent"
            onChange={(next) => {
              changes.push(next);
              setVal(next);
            }}
          />
          <button type="button" onClick={() => setVal(-10)}>
            Set -10
          </button>
          <span data-testid="val">{val}</span>
        </div>
      );
    }

    const { getByRole, getByTestId } = render(<Wrapper />);
    const input = getByRole("textbox", { name: "Test Prozent" }) as HTMLInputElement;
    expect(input.value).toBe("-5");

    // 1. Clearing to "" MUST NOT snap value to 0
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    expect(getByTestId("val").textContent).toBe("-5");
    expect(changes).toEqual([]);

    // 2. Typing "-" MUST NOT snap value to 0
    fireEvent.change(input, { target: { value: "-" } });
    expect(input.value).toBe("-");
    expect(getByTestId("val").textContent).toBe("-5");
    expect(changes).toEqual([]);

    // 3. Typing German comma decimal "-7,5" updates live to -7.5 while preserving draft
    fireEvent.change(input, { target: { value: "-7,5" } });
    expect(input.value).toBe("-7,5");
    expect(getByTestId("val").textContent).toBe("-7.5");

    // 4. Typing Unicode minus "−3,25" parses cleanly
    fireEvent.change(input, { target: { value: "−3,25" } });
    expect(getByTestId("val").textContent).toBe("-3.25");

    // 5. Trailing dot "-4." keeps draft while updating value to -4
    fireEvent.change(input, { target: { value: "-4." } });
    expect(input.value).toBe("-4.");
    expect(getByTestId("val").textContent).toBe("-4");

    // 6. Clearing and blurring reverts to last valid value (-4), never 0
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("-4");
    expect(getByTestId("val").textContent).toBe("-4");

    // 7. Out-of-range clamps on change & normalizes on blur
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "999" } });
    expect(getByTestId("val").textContent).toBe("40");
    fireEvent.blur(input);
    expect(input.value).toBe("40");

    // 8. ArrowDown / ArrowUp step cleanly
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(getByTestId("val").textContent).toBe("39.5");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(getByTestId("val").textContent).toBe("40");

    // 9. External prop update syncs draft
    fireEvent.click(getByRole("button", { name: "Set -10" }));
    expect(input.value).toBe("-10");
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

  it("renders executive overview, expected next-day volatility, Close default basis, and multi-day Muster-Scanner with zero refetches", async () => {
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
    expect(container.querySelectorAll(".noise-recent-day")).toHaveLength(10);
    expect(container.querySelectorAll(".noise-t1-factor")).toHaveLength(4);

    // Close (vs Vortag) MUST be the default basis (never candle body color)
    const panel = within(container);
    expect(panel.getByRole("button", { name: "Max" }).getAttribute("aria-pressed")).toBe("true");
    expect(panel.getByRole("button", { name: /Close \(vs Vortag\)/i }).getAttribute("aria-pressed")).toBe("true");
    expect(panel.getByRole("button", { name: /Kerzen \(C vs O\)/i }).getAttribute("aria-pressed")).toBe("false");

    // Select 7T + Rot in default Close mode and test +5,0% relief rally today
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

    // Switch primary tab to Muster-Scanner and test simplified 2-mode UI (Vorlauf → Heute | Einzeltage)
    fireEvent.click(panel.getByRole("tab", { name: /Muster-Scanner/i }));
    expect(container.textContent).toContain("Historischer Muster-Scanner");
    // Default mode is clean 2-day Einzeltage (no cluttered Tag -3 / Tag -2 / Vorlauf cards)
    expect(panel.getByRole("button", { name: "Einzeltage" }).getAttribute("aria-pressed")).toBe("true");
    expect(panel.getByRole("button", { name: "Vorlauf → Heute" }).getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain("Tag −1 (Vortag)");
    expect(container.textContent).not.toContain("Vorlauf (kumulativ vor Heute)");
    expect(container.textContent).not.toContain("Tag −3");
    // Live context bar shows current ticker values
    expect(container.querySelector(".noise-pattern-live-bar")).not.toBeNull();
    // Regime filter buttons show live match counts
    expect(panel.getByRole("button", { name: /Alle \(\d+\)/ })).not.toBeNull();
    expect(panel.getByRole("button", { name: /Bärenmarkt \(\d+\)/ })).not.toBeNull();
    expect(panel.getByRole("button", { name: /Bullenmarkt \(\d+\)/ })).not.toBeNull();

    // Expand Einzeltage lookback to 5 Tage
    fireEvent.click(panel.getByRole("button", { name: "5 Tage" }));
    expect(container.textContent).toContain("Tag −4");
    expect(container.textContent).toContain("Tag −3");

    // Switch to Vorlauf → Heute mode: hides Einzeltage & Rückblick, shows Vorlauf presets & builder
    fireEvent.click(panel.getByRole("button", { name: "Vorlauf → Heute" }));
    expect(panel.getByRole("button", { name: "Vorlauf → Heute" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("Vorlauf (kumulativ vor Heute)");
    expect(container.textContent).toContain("Heute (Tag 0)");
    expect(container.textContent).not.toContain("Tag −4");
    expect(container.textContent).not.toContain("Tag −1 (Vortag)");
    expect(panel.getByRole("button", { name: "Live-Vorlauf" })).not.toBeNull();

    // Select Vor-7T preset, then edit via NumericPctInput (German comma + inline +/- stepper)
    fireEvent.click(panel.getByRole("button", { name: "Vor-7T ≤ −10 % → +5 %" }));
    expect(container.textContent).toContain("Vor-7T ≤ −10,0 % → Tag 0 ≥ +5,0 %");

    const leadupInput = panel.getByRole("textbox", { name: "Vorlauf Schwelle Prozent" }) as HTMLInputElement;
    fireEvent.focus(leadupInput);
    fireEvent.change(leadupInput, { target: { value: "-" } });
    expect(leadupInput.value).toBe("-");
    fireEvent.change(leadupInput, { target: { value: "-8,5" } });
    expect(container.textContent).toContain("Vor-7T ≤ −8,5 %");

    // Inline + stepper increments Vorlauf threshold by step (1) -> -7,5 %
    fireEvent.click(panel.getByRole("button", { name: "Vorlauf Schwelle Prozent erhöhen" }));
    expect(container.textContent).toContain("Vor-7T ≤ −7,5 %");

    // Spiegeln button flips direction (≤ -7,5% -> ≥ +7,5% and ≥ +5% -> ≤ -5%)
    fireEvent.click(panel.getByRole("button", { name: "Spiegeln" }));
    expect(container.textContent).toContain("Vor-7T ≥ +7,5 % → Tag 0 ≤ −5,0 %");

    // 0-Treffer empty-state provides 1-click sign-symmetric threshold relaxation
    expect(container.textContent).toContain("0 Treffer für diese Kombination");
    fireEvent.click(panel.getByRole("button", { name: "Schwellen lockern (−25 %)" }));
    expect(container.textContent).toContain("Vor-7T ≥ +5,0 % → Tag 0 ≤ −3,5 %");

    // Copy summary button writes report to clipboard and shows "Kopiert" feedback
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    fireEvent.click(panel.getByRole("button", { name: "Kopieren" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(writeText.mock.calls[0][0]).toContain("SPY Muster-Scanner");

    // Switch back to Einzeltage, select −5 % → +5 %, and toggle cluster filter + sorting + copy
    fireEvent.click(panel.getByRole("button", { name: "Einzeltage" }));
    expect(panel.getByRole("button", { name: "Einzeltage" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(panel.getByRole("button", { name: "−5 % → +5 %" }));
    expect(container.textContent).toContain("Tag −1 ≤ −5,0 % → Tag 0 ≥ +5,0 %");
    expect(container.textContent).not.toContain("Vorlauf (kumulativ vor Heute)");

    // Cluster deduplication toggle works
    const dedupBtn = panel.getByRole("button", { name: "Entclustert (≥ 10T)" });
    fireEvent.click(dedupBtn);
    expect(dedupBtn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(panel.getByRole("button", { name: "Alle Tage" }));

    // Relax down to matches so table sorting & CSV button can be exercised
    fireEvent.click(panel.getByRole("button", { name: "Tag ≥ +5 %" }));
    const tag0Input = panel.getByRole("textbox", { name: "Tag 0 Schwelle Prozent" }) as HTMLInputElement;
    fireEvent.change(tag0Input, { target: { value: "1" } });
    expect(container.querySelector(".noise-win-bar")).not.toBeNull();
    expect(panel.getByRole("button", { name: "CSV" })).not.toBeNull();
    fireEvent.click(panel.getByRole("button", { name: "Tag 0" }));
    fireEvent.click(panel.getByRole("button", { name: "Drop bis Tief" }));

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

  it("renders 'laufend' (never green 0,0 %) when all pattern matches are inside an ongoing bear market", async () => {
    const dates = makeWeekdayDates(75, "2026-01-02");
    const ongoingBars: NoiseDayBar[] = [];
    let idx = 0;
    let prev = 200;
    for (let i = 0; i < 12; i++) {
      const c = Number((prev * 1.006).toFixed(4));
      ongoingBars.push({ session: dates[idx++], open: prev, high: c * 1.002, low: prev * 0.998, close: c, volume: 40_000_000 });
      prev = c;
    }
    for (let i = 0; i < 18; i++) {
      const c = Number((prev * 0.985).toFixed(4));
      ongoingBars.push({ session: dates[idx++], open: prev, high: prev * 1.001, low: c * 0.998, close: c, volume: 55_000_000 });
      prev = c;
    }
    const down = Number((prev * 0.945).toFixed(4));
    ongoingBars.push({ session: dates[idx++], open: prev, high: prev, low: down, close: down, volume: 70_000_000 });
    const up = Number((down * 1.055).toFixed(4));
    ongoingBars.push({ session: dates[idx++], open: down * 1.01, high: up * 1.003, low: down * 1.005, close: up, volume: 75_000_000 });
    prev = up;
    while (idx < dates.length) {
      const c = Number((prev * (idx % 2 === 0 ? 0.994 : 1.005)).toFixed(4));
      ongoingBars.push({ session: dates[idx++], open: prev, high: Math.max(prev, c) * 1.002, low: Math.min(prev, c) * 0.998, close: c, volume: 50_000_000 });
      prev = c;
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ...samplePayload,
          ticker: "QQQ",
          asOf: ongoingBars.at(-1)!.session,
          totalDays: ongoingBars.length,
          bars: ongoingBars,
        }),
      }) as Response),
    );

    const { container } = render(<NoiseMeterPanel initialTicker="QQQ" />);
    await waitFor(() => {
      expect(container.querySelector(".noise-hero")).not.toBeNull();
    });

    const panel = within(container);
    fireEvent.click(panel.getByRole("tab", { name: /Muster-Scanner/i }));
    fireEvent.click(panel.getByRole("button", { name: "−5 % → +5 %" }));

    expect(container.textContent).toContain("Tiefer gefallen danach");
    expect(container.textContent).toContain("Noch kein bestätigtes Zyklustief");
    expect(container.textContent).toContain("0/1 Zyklen abgeschlossen");
    expect(container.textContent).toContain("laufend");
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
