import { describe, expect, it } from "vitest";
import { technicalRating, verdictOf } from "@/lib/ta/rating";
import type { OHLCV } from "@/types/trading";

function series(length: number, price: (i: number) => number): OHLCV[] {
  return Array.from({ length }, (_, i) => {
    const close = price(i);
    const open = price(i - 1);
    return { time: i * 60_000, open, high: Math.max(open, close) * 1.002, low: Math.min(open, close) * 0.998, close, volume: 100 + (i % 7) };
  });
}

describe("technical rating", () => {
  it("maps scores onto five verdicts", () => {
    expect(verdictOf(0.7)).toBe("strong buy");
    expect(verdictOf(0.3)).toBe("buy");
    expect(verdictOf(0)).toBe("neutral");
    expect(verdictOf(-0.3)).toBe("sell");
    expect(verdictOf(-0.9)).toBe("strong sell");
    expect(verdictOf(0.5)).toBe("strong buy");
    expect(verdictOf(0.1)).toBe("buy");
    expect(verdictOf(-0.1)).toBe("sell");
  });
  it("needs enough history", () => {
    expect(technicalRating(series(30, (i) => 100 + i))).toBeNull();
  });
  it("rates a steady uptrend as buy on the moving averages", () => {
    const rating = technicalRating(series(260, (i) => 100 + i * 0.8 + Math.sin(i / 3)))!;
    expect(rating.maScore).toBeGreaterThan(0.8);
    expect(rating.movingAverages.every((e) => e.vote === "buy")).toBe(true);
    expect(["buy", "strong buy"]).toContain(rating.verdict);
    expect(rating.movingAverages.length).toBeGreaterThanOrEqual(14);
  });
  it("rates a steady downtrend as sell", () => {
    const rating = technicalRating(series(260, (i) => 400 - i * 0.8 + Math.sin(i / 3)))!;
    expect(rating.maScore).toBeLessThan(-0.8);
    expect(["sell", "strong sell"]).toContain(rating.verdict);
  });
  it("counts every vote and keeps scores within bounds", () => {
    const rating = technicalRating(series(120, (i) => 100 + Math.sin(i / 5) * 8))!;
    const total = rating.oscillators.length + rating.movingAverages.length;
    expect(rating.counts.buy + rating.counts.sell + rating.counts.neutral).toBe(total);
    for (const score of [rating.score, rating.oscillatorScore, rating.maScore]) {
      expect(score).toBeGreaterThanOrEqual(-1);
      expect(score).toBeLessThanOrEqual(1);
    }
    expect(rating.oscillators.length).toBeGreaterThanOrEqual(9);
    // Moving averages longer than the history are skipped, not guessed.
    expect(rating.movingAverages.some((e) => e.name === "SMA (200)")).toBe(false);
  });
  it("buys an oversold RSI that is turning up", () => {
    const fall = series(100, (i) => 200 - i * 1.5);
    const bounce = fall.concat(series(3, (i) => 200 - 99 * 1.5 + (i + 1) * 0.5).map((b, i) => ({ ...b, time: (100 + i) * 60_000 })));
    const rsiVote = technicalRating(bounce)!.oscillators.find((e) => e.name.startsWith("RSI"))!;
    expect(rsiVote.value).toBeLessThan(30);
    expect(rsiVote.vote).toBe("buy");
  });
});
