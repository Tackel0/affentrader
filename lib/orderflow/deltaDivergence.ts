import type { OHLCV } from "@/types/trading";

export type DeltaDivergenceKind = "bullish" | "bearish";

export interface DeltaDivergenceSignal {
  kind: DeltaDivergenceKind;
  fromTime: number;
  toTime: number;
  fromPrice: number;
  toPrice: number;
  fromDelta: number;
  toDelta: number;
  label: string;
}

/**
 * Automated Price vs. Delta/CVD Divergence detector.
 * Aligns delta candles by exact bar timestamp against OHLCV candles:
 * - Bearish Divergence: Price makes Higher High while Delta/CVD makes Lower High (distribution)
 * - Bullish Divergence: Price makes Lower Low while Delta/CVD makes Higher Low (absorption)
 */
export function detectDeltaDivergences(
  bars: readonly OHLCV[],
  deltaBars: readonly Pick<OHLCV, "time" | "high" | "low" | "close">[],
  pivotRadius = 2,
  maxDistanceBars = 24,
): DeltaDivergenceSignal[] {
  if (bars.length < pivotRadius * 2 + 3 || !deltaBars.length) return [];

  const deltaByTime = new Map<number, Pick<OHLCV, "time" | "high" | "low" | "close">>();
  for (const d of deltaBars) {
    if (Number.isFinite(d.close)) deltaByTime.set(d.time, d);
  }

  const highPivots: Array<{ idx: number; time: number; price: number; delta: number }> = [];
  const lowPivots: Array<{ idx: number; time: number; price: number; delta: number }> = [];

  for (let i = pivotRadius; i < bars.length - pivotRadius; i++) {
    const bar = bars[i];
    if (!Number.isFinite(bar.high) || !Number.isFinite(bar.low)) continue;
    const dBar = deltaByTime.get(bar.time);
    if (!dBar) continue;

    let isHigh = true;
    let isLow = true;
    for (let j = i - pivotRadius; j <= i + pivotRadius; j++) {
      if (j === i) continue;
      const cmp = bars[j];
      if (!Number.isFinite(cmp.high) || !Number.isFinite(cmp.low)) {
        isHigh = false;
        isLow = false;
        break;
      }
      // Left non-strict / right strict tie-break preserves flat double tops/bottoms on their rightmost pivot.
      if (j < i ? cmp.high > bar.high : cmp.high >= bar.high) isHigh = false;
      if (j < i ? cmp.low < bar.low : cmp.low <= bar.low) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) {
      highPivots.push({
        idx: i,
        time: bar.time,
        price: bar.high,
        delta: Number.isFinite(dBar.high) ? Math.max(dBar.high, dBar.close) : dBar.close,
      });
    }
    if (isLow) {
      lowPivots.push({
        idx: i,
        time: bar.time,
        price: bar.low,
        delta: Number.isFinite(dBar.low) ? Math.min(dBar.low, dBar.close) : dBar.close,
      });
    }
  }

  const out: DeltaDivergenceSignal[] = [];

  for (let i = 1; i < highPivots.length; i++) {
    const prev = highPivots[i - 1];
    const curr = highPivots[i];
    if (curr.idx - prev.idx > maxDistanceBars) continue;
    if (curr.price > prev.price && curr.delta < prev.delta) {
      out.push({
        kind: "bearish",
        fromTime: prev.time,
        toTime: curr.time,
        fromPrice: prev.price,
        toPrice: curr.price,
        fromDelta: prev.delta,
        toDelta: curr.delta,
        label: "Bear Delta Div",
      });
    }
  }

  for (let i = 1; i < lowPivots.length; i++) {
    const prev = lowPivots[i - 1];
    const curr = lowPivots[i];
    if (curr.idx - prev.idx > maxDistanceBars) continue;
    if (curr.price < prev.price && curr.delta > prev.delta) {
      out.push({
        kind: "bullish",
        fromTime: prev.time,
        toTime: curr.time,
        fromPrice: prev.price,
        toPrice: curr.price,
        fromDelta: prev.delta,
        toDelta: curr.delta,
        label: "Bull Delta Div",
      });
    }
  }

  return out.sort((a, b) => a.toTime - b.toTime);
}
