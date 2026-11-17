import type { OHLCV } from "@/types/trading";
import {
  adx,
  cci,
  ema,
  hma,
  ichimoku,
  macd,
  rsi,
  sma,
  source,
  stochastic,
  vwma,
  williamsR,
  type Series,
} from "./index";

export type Vote = "buy" | "sell" | "neutral";

export interface RatingEntry {
  name: string;
  /** The indicator's latest value, shown beside its vote. */
  value: number;
  vote: Vote;
}

export type Verdict = "strong sell" | "sell" | "neutral" | "buy" | "strong buy";

export interface Rating {
  oscillators: RatingEntry[];
  movingAverages: RatingEntry[];
  /** Mean of every vote, from −1 (all sell) to +1 (all buy). */
  score: number;
  oscillatorScore: number;
  maScore: number;
  verdict: Verdict;
  counts: { buy: number; sell: number; neutral: number };
}

const last = (series: Series, back = 0) => series[series.length - 1 - back];
const ok = (...values: number[]) => values.every(Number.isFinite);

function scoreOf(entries: RatingEntry[]): number {
  if (!entries.length) return 0;
  return entries.reduce((n, e) => n + (e.vote === "buy" ? 1 : e.vote === "sell" ? -1 : 0), 0) / entries.length;
}

/** Map a −1…+1 score onto the five labels used by the technicals gauge. */
export function verdictOf(score: number): Verdict {
  if (score >= 0.5) return "strong buy";
  if (score >= 0.1) return "buy";
  if (score > -0.1) return "neutral";
  if (score > -0.5) return "sell";
  return "strong sell";
}

function pushIf(list: RatingEntry[], name: string, value: number, vote: Vote | null) {
  if (vote !== null && Number.isFinite(value)) list.push({ name, value, vote });
}

/** Votes of eleven oscillators and moving averages on the latest bar. Needs about 60 bars. */
export function technicalRating(bars: readonly OHLCV[]): Rating | null {
  if (bars.length < 60) return null;
  const close = source(bars, "close");
  const price = last(close);
  const oscillators: RatingEntry[] = [];
  const averages: RatingEntry[] = [];

  const rsi14 = rsi(close, 14);
  pushIf(oscillators, "RSI (14)", last(rsi14), ok(last(rsi14), last(rsi14, 1)) ? (last(rsi14) < 30 && last(rsi14) > last(rsi14, 1) ? "buy" : last(rsi14) > 70 && last(rsi14) < last(rsi14, 1) ? "sell" : "neutral") : null);

  const stoch = stochastic(bars, 14, 3, 3);
  pushIf(oscillators, "Stochastic %K (14, 3, 3)", last(stoch.k), ok(last(stoch.k), last(stoch.d)) ? (last(stoch.k) < 20 && last(stoch.k) > last(stoch.d) ? "buy" : last(stoch.k) > 80 && last(stoch.k) < last(stoch.d) ? "sell" : "neutral") : null);

  const cci20 = cci(bars, 20);
  pushIf(oscillators, "CCI (20)", last(cci20), ok(last(cci20), last(cci20, 1)) ? (last(cci20) < -100 && last(cci20) > last(cci20, 1) ? "buy" : last(cci20) > 100 && last(cci20) < last(cci20, 1) ? "sell" : "neutral") : null);

  const dmi = adx(bars, 14);
  pushIf(oscillators, "ADX (14)", last(dmi.adx), ok(last(dmi.adx), last(dmi.plusDi), last(dmi.minusDi), last(dmi.plusDi, 1), last(dmi.minusDi, 1))
    ? last(dmi.adx) > 20 && last(dmi.plusDi) > last(dmi.minusDi) && last(dmi.plusDi, 1) <= last(dmi.minusDi, 1)
      ? "buy"
      : last(dmi.adx) > 20 && last(dmi.plusDi) < last(dmi.minusDi) && last(dmi.plusDi, 1) >= last(dmi.minusDi, 1)
        ? "sell"
        : "neutral"
    : null);

  const mid = source(bars, "hl2");
  const slowMid = sma(mid, 34);
  const ao = sma(mid, 5).map((v, i) => v - slowMid[i]);
  pushIf(oscillators, "Awesome Oscillator", last(ao), ok(last(ao), last(ao, 1)) ? (last(ao) > 0 && last(ao) > last(ao, 1) ? "buy" : last(ao) < 0 && last(ao) < last(ao, 1) ? "sell" : "neutral") : null);

  const momentum = close.map((v, i) => (i >= 10 ? v - close[i - 10] : Number.NaN));
  pushIf(oscillators, "Momentum (10)", last(momentum), ok(last(momentum), last(momentum, 1)) ? (last(momentum) > last(momentum, 1) ? "buy" : last(momentum) < last(momentum, 1) ? "sell" : "neutral") : null);

  const m = macd(close, 12, 26, 9);
  pushIf(oscillators, "MACD (12, 26)", last(m.macd), ok(last(m.macd), last(m.signal)) ? (last(m.macd) > last(m.signal) ? "buy" : last(m.macd) < last(m.signal) ? "sell" : "neutral") : null);

  const stochRsi = stochastic(
    rsi14.map((v) => ({ open: v, high: v, low: v, close: v, volume: 0, time: 0 })),
    14,
    3,
    3,
  );
  pushIf(oscillators, "Stochastic RSI (14)", last(stochRsi.k), ok(last(stochRsi.k), last(stochRsi.d)) ? (last(stochRsi.k) < 20 && last(stochRsi.k) > last(stochRsi.d) ? "buy" : last(stochRsi.k) > 80 && last(stochRsi.k) < last(stochRsi.d) ? "sell" : "neutral") : null);

  const wr = williamsR(bars, 14);
  pushIf(oscillators, "Williams %R (14)", last(wr), ok(last(wr), last(wr, 1)) ? (last(wr) < -80 && last(wr) > last(wr, 1) ? "buy" : last(wr) > -20 && last(wr) < last(wr, 1) ? "sell" : "neutral") : null);

  // Elder's bull/bear power around a 13-period EMA.
  const ema13 = ema(close, 13);
  const bull = bars.map((b, i) => b.high - ema13[i]);
  const bear = bars.map((b, i) => b.low - ema13[i]);
  if (ok(last(ema13), last(ema13, 1), last(bull), last(bull, 1), last(bear), last(bear, 1))) {
    const up = last(ema13) > last(ema13, 1);
    const vote: Vote = up && last(bear) < 0 && last(bear) > last(bear, 1) ? "buy" : !up && last(bull) > 0 && last(bull) < last(bull, 1) ? "sell" : "neutral";
    pushIf(oscillators, "Bull Bear Power", last(bull) + last(bear), vote);
  }

  // Ultimate oscillator (7, 14, 28).
  const bp = bars.map((b, i) => (i ? b.close - Math.min(b.low, bars[i - 1].close) : Number.NaN));
  const tr = bars.map((b, i) => (i ? Math.max(b.high, bars[i - 1].close) - Math.min(b.low, bars[i - 1].close) : Number.NaN));
  const avg = (n: number) => {
    let a = 0;
    let t = 0;
    for (let k = 0; k < n; k++) {
      a += bp[bars.length - 1 - k];
      t += tr[bars.length - 1 - k];
    }
    return t ? a / t : Number.NaN;
  };
  const uo = (100 * (4 * avg(7) + 2 * avg(14) + avg(28))) / 7;
  pushIf(oscillators, "Ultimate Oscillator", uo, Number.isFinite(uo) ? (uo > 70 ? "buy" : uo < 30 ? "sell" : "neutral") : null);

  const voteAgainstPrice = (value: number): Vote | null => (ok(value, price) ? (value < price ? "buy" : value > price ? "sell" : "neutral") : null);
  for (const length of [10, 20, 30, 50, 100, 200]) {
    if (bars.length < length + 1) continue;
    const e = last(ema(close, length));
    const s = last(sma(close, length));
    pushIf(averages, `EMA (${length})`, e, voteAgainstPrice(e));
    pushIf(averages, `SMA (${length})`, s, voteAgainstPrice(s));
  }
  const cloud = ichimoku(bars, 9, 26, 52);
  pushIf(averages, "Ichimoku base line (26)", last(cloud.base), voteAgainstPrice(last(cloud.base)));
  const volume = source(bars, "volume");
  const vw = last(vwma(close, volume, 20));
  pushIf(averages, "VWMA (20)", vw, voteAgainstPrice(vw));
  const hull = last(hma(close, 9));
  pushIf(averages, "Hull MA (9)", hull, voteAgainstPrice(hull));

  const all = [...oscillators, ...averages];
  const score = scoreOf(all);
  return {
    oscillators,
    movingAverages: averages,
    score,
    oscillatorScore: scoreOf(oscillators),
    maScore: scoreOf(averages),
    verdict: verdictOf(score),
    counts: {
      buy: all.filter((e) => e.vote === "buy").length,
      sell: all.filter((e) => e.vote === "sell").length,
      neutral: all.filter((e) => e.vote === "neutral").length,
    },
  };
}
