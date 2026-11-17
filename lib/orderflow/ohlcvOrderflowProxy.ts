import type { OHLCV } from "@/types/trading";
import type { FootprintSignalKind } from "./footprintSignals";

export interface OhlcvProxyDeltaBar {
  time: number;
  high: number;
  low: number;
  close: number;
  barDelta: number;
}

export interface OhlcvProxySignal {
  time: number;
  price: number;
  kind: FootprintSignalKind;
  label: string;
  volumeRatio: number;
}

/**
 * Estimates cumulative volume delta from OHLCV candles via intra-bar
 * Close Location Value (CLV) buying/selling pressure when no classified
 * exchange tick tape is available (e.g., delayed equities / index ETFs).
 */
export function estimateOhlcvDeltaBars(bars: readonly OHLCV[]): OhlcvProxyDeltaBar[] {
  if (!bars.length) return [];
  const out: OhlcvProxyDeltaBar[] = [];
  let cumulative = 0;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (!Number.isFinite(bar.high) || !Number.isFinite(bar.low) || !Number.isFinite(bar.close)) continue;
    const range = bar.high - bar.low;
    const clv =
      range > 0 && Number.isFinite(range)
        ? Math.max(-1, Math.min(1, (2 * bar.close - bar.high - bar.low) / range))
        : i > 0 && Number.isFinite(bars[i - 1].close) && bar.close !== bars[i - 1].close
          ? bar.close > bars[i - 1].close
            ? 0.5
            : -0.5
          : bar.close >= bar.open
            ? 0.5
            : -0.5;
    const vol = Number.isFinite(bar.volume) && bar.volume > 0 ? bar.volume : 0;
    const barDelta = clv * vol;
    const prev = cumulative;
    cumulative += barDelta;
    out.push({
      time: bar.time,
      high: Math.max(prev, cumulative),
      low: Math.min(prev, cumulative),
      close: cumulative,
      barDelta,
    });
  }
  return out;
}

/**
 * Detects OHLCV proxy absorption (volume spike + extreme wick rejection)
 * and exhaustion (new extreme on shrinking follow-through volume) for
 * candle-only equities charts lacking live L1 Bid×Ask trade feeds.
 */
export function detectOhlcvProxySignals(bars: readonly OHLCV[], avgWindow = 20): OhlcvProxySignal[] {
  if (bars.length < 6) return [];
  const signals: OhlcvProxySignal[] = [];

  for (let i = 3; i < bars.length; i++) {
    const bar = bars[i];
    const prev = bars[i - 1];
    const range = bar.high - bar.low;
    if (!(range > 0) || !(bar.volume > 0)) continue;

    const start = Math.max(0, i - avgWindow);
    let volSum = 0;
    let count = 0;
    for (let j = start; j < i; j++) {
      if (bars[j].volume > 0) {
        volSum += bars[j].volume;
        count++;
      }
    }
    const avgVol = count > 0 ? volSum / count : bar.volume;
    if (!(avgVol > 0)) continue;

    const volRatio = bar.volume / avgVol;
    const body = Math.abs(bar.close - bar.open);
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const bodyRatio = body / range;
    const upperWickRatio = upperWick / range;
    const lowerWickRatio = lowerWick / range;
    const mid = (bar.high + bar.low) / 2;

    if (volRatio >= 1.75 && upperWickRatio >= 0.42 && bodyRatio <= 0.45) {
      signals.push({
        time: bar.time,
        price: bar.high,
        kind: "absorption-high",
        label: "ABS* ↑",
        volumeRatio: Number(volRatio.toFixed(2)),
      });
    }
    if (volRatio >= 1.75 && lowerWickRatio >= 0.42 && bodyRatio <= 0.45) {
      signals.push({
        time: bar.time,
        price: bar.low,
        kind: "absorption-low",
        label: "ABS* ↓",
        volumeRatio: Number(volRatio.toFixed(2)),
      });
    }

    if (
      prev.volume >= avgVol * 1.25 &&
      bar.volume <= prev.volume * 0.55 &&
      bar.high > prev.high &&
      prev.close > bars[i - 2].close &&
      bar.close < mid
    ) {
      signals.push({
        time: bar.time,
        price: bar.high,
        kind: "exhaustion-high",
        label: "EXH* ↑",
        volumeRatio: Number(volRatio.toFixed(2)),
      });
    }

    if (
      prev.volume >= avgVol * 1.25 &&
      bar.volume <= prev.volume * 0.55 &&
      bar.low < prev.low &&
      prev.close < bars[i - 2].close &&
      bar.close > mid
    ) {
      signals.push({
        time: bar.time,
        price: bar.low,
        kind: "exhaustion-low",
        label: "EXH* ↓",
        volumeRatio: Number(volRatio.toFixed(2)),
      });
    }
  }

  return signals;
}
