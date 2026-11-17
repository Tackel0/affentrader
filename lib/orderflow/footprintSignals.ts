import type { FootprintBar, FootprintLevel, OHLCV } from "@/types/trading";

export type FootprintSignalKind =
  | "absorption-high"
  | "absorption-low"
  | "exhaustion-high"
  | "exhaustion-low";

export interface FootprintBarSignal {
  time: number;
  price: number;
  upperPrice: number;
  kind: FootprintSignalKind;
  label: string;
  buyVolume: number;
  sellVolume: number;
  strength: number;
}

const activeLevels = (bar: FootprintBar): FootprintLevel[] =>
  bar.levels
    .filter((l) => !l.filtered && (l.buyVolume > 0 || l.sellVolume > 0))
    .sort((a, b) => a.price - b.price);

/**
 * Detects textbook institutional footprint bar anomalies at bar highs and lows:
 * 1. Absorption High / Low: Heavy two-sided volume concentration at an extreme level
 *    with passive limit defense (min(buy, sell)/total >= 0.34) or aggressive effort failing
 *    against candle close rejection.
 * 2. Exhaustion High / Low: Sharp vanishing volume taper at the extreme print
 *    (edge side volume <= 25% of adjacent level), indicating buyer/seller exhaustion.
 */
export function detectFootprintBarSignals(
  bar: FootprintBar,
  candle?: Pick<OHLCV, "open" | "high" | "low" | "close">,
): FootprintBarSignal[] {
  const levels = activeLevels(bar);
  if (levels.length < 3) return [];

  const signals: FootprintBarSignal[] = [];
  const totalVols = levels.map((l) => l.buyVolume + l.sellVolume);
  const avgVol = totalVols.reduce((s, v) => s + v, 0) / levels.length;
  if (!(avgVol > 0)) return [];

  const bottom = levels[0];
  const nextLow = levels[1];
  const top = levels[levels.length - 1];
  const prevHigh = levels[levels.length - 2];

  const bearishCandleClose = candle ? candle.close <= candle.open || candle.close < top.price : true;
  const bullishCandleClose = candle ? candle.close >= candle.open || candle.close > (bottom.upperPrice ?? bottom.price) : true;

  // 1. Absorption at Bar High (top 2 levels)
  for (const level of [top, prevHigh]) {
    const total = level.buyVolume + level.sellVolume;
    const minSide = Math.min(level.buyVolume, level.sellVolume);
    if (
      total >= avgVol * 1.45 &&
      minSide / total >= 0.34 &&
      level.buyVolume > 0 &&
      level.sellVolume > 0 &&
      bearishCandleClose
    ) {
      signals.push({
        time: bar.time,
        price: level.price,
        upperPrice: level.upperPrice ?? level.price,
        kind: "absorption-high",
        label: "ABS ↑",
        buyVolume: level.buyVolume,
        sellVolume: level.sellVolume,
        strength: Math.min(1, Number((total / (avgVol * 2.5)).toFixed(2))),
      });
      break;
    }
  }

  // 2. Absorption at Bar Low (bottom 2 levels)
  for (const level of [bottom, nextLow]) {
    const total = level.buyVolume + level.sellVolume;
    const minSide = Math.min(level.buyVolume, level.sellVolume);
    if (
      total >= avgVol * 1.45 &&
      minSide / total >= 0.34 &&
      level.buyVolume > 0 &&
      level.sellVolume > 0 &&
      bullishCandleClose
    ) {
      signals.push({
        time: bar.time,
        price: level.price,
        upperPrice: level.upperPrice ?? level.price,
        kind: "absorption-low",
        label: "ABS ↓",
        buyVolume: level.buyVolume,
        sellVolume: level.sellVolume,
        strength: Math.min(1, Number((total / (avgVol * 2.5)).toFixed(2))),
      });
      break;
    }
  }

  // 3. Exhaustion Print at Bar High (tapering buying aggression at extreme top)
  if (
    prevHigh.buyVolume >= avgVol * 0.6 &&
    top.buyVolume <= prevHigh.buyVolume * 0.25 &&
    top.sellVolume <= avgVol * 0.8
  ) {
    signals.push({
      time: bar.time,
      price: top.price,
      upperPrice: top.upperPrice ?? top.price,
      kind: "exhaustion-high",
      label: "EXH ↑",
      buyVolume: top.buyVolume,
      sellVolume: top.sellVolume,
      strength: Math.max(0, Math.min(1, Number((1 - top.buyVolume / Math.max(1e-12, prevHigh.buyVolume)).toFixed(2)))),
    });
  }

  // 4. Exhaustion Print at Bar Low (tapering selling aggression at extreme bottom)
  if (
    nextLow.sellVolume >= avgVol * 0.6 &&
    bottom.sellVolume <= nextLow.sellVolume * 0.25 &&
    bottom.buyVolume <= avgVol * 0.8
  ) {
    signals.push({
      time: bar.time,
      price: bottom.price,
      upperPrice: bottom.upperPrice ?? bottom.price,
      kind: "exhaustion-low",
      label: "EXH ↓",
      buyVolume: bottom.buyVolume,
      sellVolume: bottom.sellVolume,
      strength: Math.max(0, Math.min(1, Number((1 - bottom.sellVolume / Math.max(1e-12, nextLow.sellVolume)).toFixed(2)))),
    });
  }

  return signals;
}

export interface TrappedParticipantsSummary {
  trappedBuyers: number;
  trappedSellers: number;
  trappedBuyLevels: number;
  trappedSellLevels: number;
  summary: string | null;
}

/**
 * Estimates trapped aggressive buyers/sellers when price closes decisively away from
 * opposing aggressive delta prints inside the candle tail/wick.
 */
export function detectTrappedParticipants(
  bar: FootprintBar,
  candle?: Pick<OHLCV, "open" | "high" | "low" | "close">,
): TrappedParticipantsSummary {
  let trappedBuyers = 0;
  let trappedSellers = 0;
  let trappedBuyLevels = 0;
  let trappedSellLevels = 0;
  const levels = activeLevels(bar);
  if (!levels.length) {
    return { trappedBuyers: 0, trappedSellers: 0, trappedBuyLevels: 0, trappedSellLevels: 0, summary: null };
  }
  const bearClose = candle ? candle.close < candle.open : bar.delta < 0;
  const bullClose = candle ? candle.close > candle.open : bar.delta > 0;
  const refHigh = candle ? Math.max(candle.open, candle.close) : levels[Math.floor(levels.length / 2)].price;
  const refLow = candle ? Math.min(candle.open, candle.close) : levels[Math.floor(levels.length / 2)].price;

  for (const level of levels) {
    const upper = level.upperPrice ?? level.price;
    const netDelta = level.buyVolume - level.sellVolume;
    if (bearClose && level.price > refHigh && netDelta > 0) {
      trappedBuyers += netDelta;
      trappedBuyLevels++;
    }
    if (bullClose && upper < refLow && netDelta < 0) {
      trappedSellers += -netDelta;
      trappedSellLevels++;
    }
  }

  const parts: string[] = [];
  if (trappedBuyers > 0) parts.push(`Trapped buyers ${trappedBuyers.toLocaleString("en-US", { maximumSignificantDigits: 4 })} (${trappedBuyLevels} lvls)`);
  if (trappedSellers > 0) parts.push(`Trapped sellers ${trappedSellers.toLocaleString("en-US", { maximumSignificantDigits: 4 })} (${trappedSellLevels} lvls)`);
  return {
    trappedBuyers,
    trappedSellers,
    trappedBuyLevels,
    trappedSellLevels,
    summary: parts.length ? parts.join(" · ") : null,
  };
}
