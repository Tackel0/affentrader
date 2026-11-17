import { ADX, ATR, BollingerBands, EMA, MACD, RSI } from "trading-signals";
import {
  MFI,
  WilliamsR,
  bearishengulfingpattern,
  bullishengulfingpattern,
  dragonflydoji,
  eveningstar,
  hammerpattern,
  morningstar,
  piercingline,
  shootingstar,
  tweezerbottom,
} from "technicalindicators";
import * as ss from "simple-statistics";
import type { OHLCV } from "@/types/trading";

export interface QuantTechnicalSnapshot {
  rsi14: number | null;
  adx14: number | null;
  atr14: number | null;
  atrPct: number | null;
  macdHistogram: number | null;
  bollingerWidthPct: number | null;
  annualizedVolPct: number | null;
  priceSlopePerBarPct: number | null;
  mfi14: number | null;
  willR14: number | null;
  sortinoRatio: number | null;
  maxDrawdownPct: number | null;
  var95Pct: number | null;
  candlestickPatterns: string[];
}

/**
 * Computes institutional quantitative, risk, and candlestick metrics using `trading-signals`,
 * `technicalindicators`, and `simple-statistics` from an OHLCV candle array.
 */
export function computeQuantSignals(bars: readonly OHLCV[]): QuantTechnicalSnapshot {
  if (bars.length < 15) {
    return {
      rsi14: null,
      adx14: null,
      atr14: null,
      atrPct: null,
      macdHistogram: null,
      bollingerWidthPct: null,
      annualizedVolPct: null,
      priceSlopePerBarPct: null,
      mfi14: null,
      willR14: null,
      sortinoRatio: null,
      maxDrawdownPct: null,
      var95Pct: null,
      candlestickPatterns: [],
    };
  }

  const rsiInd = new RSI(14);
  const adxInd = new ADX(14);
  const atrInd = new ATR(14);
  const bbInd = new BollingerBands(20, 2);
  const macdInd = new MACD(new EMA(12), new EMA(26), new EMA(9));

  const logReturns: number[] = [];
  let peak = bars[0].close;
  let maxDd = 0;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    rsiInd.update(b.close, false);
    adxInd.update({ high: b.high, low: b.low, close: b.close }, false);
    atrInd.update({ high: b.high, low: b.low, close: b.close }, false);
    bbInd.update(b.close, false);
    macdInd.update(b.close, false);
    if (i > 0 && bars[i - 1].close > 0 && b.close > 0) {
      logReturns.push(Math.log(b.close / bars[i - 1].close));
    }
    if (b.close > peak) peak = b.close;
    if (peak > 0) {
      const dd = (peak - b.close) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }

  const lastClose = bars.at(-1)!.close;
  const rsi14 = rsiInd.isStable ? Number(Number(rsiInd.getResult()).toFixed(2)) : null;
  const adx14 = adxInd.isStable ? Number(Number(adxInd.getResult()).toFixed(2)) : null;
  const atr14 = atrInd.isStable ? Number(Number(atrInd.getResult()).toFixed(4)) : null;
  const atrPct = atr14 !== null && lastClose > 0 ? Number(((atr14 / lastClose) * 100).toFixed(2)) : null;

  let macdHistogram: number | null = null;
  if (macdInd.isStable) {
    const m = macdInd.getResult();
    if (m && typeof m.histogram === "number" && Number.isFinite(m.histogram)) {
      macdHistogram = Number(m.histogram.toFixed(4));
    }
  }

  let bollingerWidthPct: number | null = null;
  if (bbInd.isStable) {
    const bb = bbInd.getResult();
    if (bb && bb.middle > 0) {
      bollingerWidthPct = Number((((bb.upper - bb.lower) / bb.middle) * 100).toFixed(2));
    }
  }

  const annualizedVolPct =
    logReturns.length >= 10
      ? Number((ss.standardDeviation(logReturns) * Math.sqrt(252) * 100).toFixed(2))
      : null;

  const recentCloses = bars.slice(-20);
  const reg =
    recentCloses.length >= 5
      ? ss.linearRegression(recentCloses.map((b, idx) => [idx, b.close]))
      : null;
  const priceSlopePerBarPct =
    reg && lastClose > 0 ? Number(((reg.m / lastClose) * 100).toFixed(3)) : null;

  // Volume & momentum oscillators via technicalindicators
  const mfiVals = MFI.calculate({
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
    close: bars.map((b) => b.close),
    volume: bars.map((b) => Math.max(0, b.volume || 0)),
    period: 14,
  });
  const mfi14 = mfiVals.length && Number.isFinite(mfiVals.at(-1)) ? Number(mfiVals.at(-1)!.toFixed(2)) : null;

  const willRVals = WilliamsR.calculate({
    high: bars.map((b) => b.high),
    low: bars.map((b) => b.low),
    close: bars.map((b) => b.close),
    period: 14,
  });
  const willR14 = willRVals.length && Number.isFinite(willRVals.at(-1)) ? Number(willRVals.at(-1)!.toFixed(2)) : null;

  // Risk metrics via simple-statistics
  let sortinoRatio: number | null = null;
  let var95Pct: number | null = null;
  if (logReturns.length >= 12) {
    const meanRet = ss.mean(logReturns);
    const downside = logReturns.filter((r) => r < 0);
    const downsideDev =
      downside.length >= 2
        ? Math.sqrt(downside.reduce((sum, r) => sum + r * r, 0) / logReturns.length)
        : 0;
    if (downsideDev > 0) {
      sortinoRatio = Number(((meanRet / downsideDev) * Math.sqrt(252)).toFixed(2));
    }
    const q5 = ss.quantile(logReturns, 0.05);
    if (Number.isFinite(q5)) {
      var95Pct = Number((Math.abs(Math.min(0, q5)) * 100).toFixed(2));
    }
  }
  const maxDrawdownPct = Number((maxDd * 100).toFixed(2));

  // Candlestick pattern recognition on last 5 bars
  const tail5 = bars.slice(-5);
  const candleInput = {
    open: tail5.map((b) => b.open),
    high: tail5.map((b) => b.high),
    low: tail5.map((b) => b.low),
    close: tail5.map((b) => b.close),
  };
  const tail2 = {
    open: tail5.slice(-2).map((b) => b.open),
    high: tail5.slice(-2).map((b) => b.high),
    low: tail5.slice(-2).map((b) => b.low),
    close: tail5.slice(-2).map((b) => b.close),
  };
  const tail3 = {
    open: tail5.slice(-3).map((b) => b.open),
    high: tail5.slice(-3).map((b) => b.high),
    low: tail5.slice(-3).map((b) => b.low),
    close: tail5.slice(-3).map((b) => b.close),
  };
  const tail1 = {
    open: [tail5.at(-1)!.open],
    high: [tail5.at(-1)!.high],
    low: [tail5.at(-1)!.low],
    close: [tail5.at(-1)!.close],
  };

  const patterns: string[] = [];
  if (hammerpattern(candleInput)) patterns.push("Hammer (Bullish)");
  if (bullishengulfingpattern(tail2)) patterns.push("Bullish Engulfing");
  if (morningstar(tail3)) patterns.push("Morning Star");
  if (piercingline(tail2)) patterns.push("Piercing Line");
  if (tweezerbottom(candleInput)) patterns.push("Tweezer Bottom");
  if (dragonflydoji(tail1)) patterns.push("Dragonfly Doji");
  if (bearishengulfingpattern(tail2)) patterns.push("Bearish Engulfing");
  if (eveningstar(tail3)) patterns.push("Evening Star");
  if (shootingstar(candleInput)) patterns.push("Shooting Star");

  return {
    rsi14,
    adx14,
    atr14,
    atrPct,
    macdHistogram,
    bollingerWidthPct,
    annualizedVolPct,
    priceSlopePerBarPct,
    mfi14,
    willR14,
    sortinoRatio,
    maxDrawdownPct,
    var95Pct,
    candlestickPatterns: patterns,
  };
}
