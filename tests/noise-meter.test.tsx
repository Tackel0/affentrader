// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import {
  buildNoiseDataset,
  evaluateNoiseScenario,
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

  it("renders KPIs and recomputes live on 7-red-candle, Close-basis toggle, and tab interactions without refetching", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const { container } = render(<NoiseMeterPanel initialTicker="SPY" />);

    await waitFor(() => {
      expect(container.querySelector(".noise-hero")).not.toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("SPDR S&P 500 ETF Trust");
    expect(container.textContent).toContain("Gap-Close-Chance (Intraday)");
    expect(container.querySelectorAll(".noise-recent-day").length).toBeGreaterThan(0);

    // Select 7T + Rot in default Kerzen (C vs O) mode
    const panel = within(container);
    fireEvent.click(panel.getByRole("button", { name: "Rot" }));
    fireEvent.click(panel.getByRole("button", { name: "7T" }));

    expect(container.textContent).toContain("Nach ≥ 7 roten Kerzen");
    expect(container.textContent).toContain("75,0 %");
    expect(fetchMock).toHaveBeenCalledTimes(1); // Pure client-side recompute

    // Switch basis to Close (vs Vortag) and select 7T + Rot
    fireEvent.click(panel.getByRole("button", { name: /Close \(vs Vortag\)/i }));
    fireEvent.click(panel.getByRole("button", { name: "Rot" }));
    fireEvent.click(panel.getByRole("button", { name: "7T" }));
    expect(container.textContent).toContain("Nach ≥ 7 roten Tagen");

    // Switch detail tabs: Streak-Tabelle & Wochentage, then Historische Analogien
    fireEvent.click(panel.getByRole("tab", { name: /Streak-Tabelle/i }));
    expect(container.textContent).toContain("Nach roten Tagen in Folge");
    expect(container.querySelectorAll(".noise-weekday-card")).toHaveLength(5);

    fireEvent.click(panel.getByRole("tab", { name: /Historische Analogien/i }));
    expect(container.textContent).toContain("Vorserie");
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
