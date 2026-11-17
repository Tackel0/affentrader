import type { OHLCV } from "@luxalgo/vela";

export const ANCHORED_VWAP_VERSION = "weighted-hlc3-v1";
export const MAX_ANCHORED_VWAP_BARS = 50000;
export type VwapBar = Pick<OHLCV, "time" | "high" | "low" | "close" | "volume">;
export interface VwapSample { time: number; mid: number; upper: number; lower: number; deviation: number }
export interface AnchoredVwapResult { samples: VwapSample[]; volume: number; rows: number; positiveBars: number; zeroBars: number }
const fields = ["time", "high", "low", "close", "volume"] as const;
function selected(source: readonly VwapBar[], anchor: number, multiplier: number, through: number): VwapBar[] {
  if (!Number.isFinite(anchor) || Math.abs(anchor) >= 8640000000000000 || !Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 100 ||
    !(Number.isFinite(through) || through === Infinity)) throw new Error("Choose a valid anchor time and band multiplier (greater than 0, at most 100).");
  if (!source.length || !Number.isFinite(source[0].time) || source[0].time > anchor) throw new Error("Anchor history is not loaded. Load earlier bars or move the anchor.");
  if (source.some(bar => !Number.isFinite(bar.time))) throw new Error("Anchored VWAP needs finite bar timestamps.");
  const bars = source.filter(bar => bar.time >= anchor && bar.time <= through);
  if (bars.length > MAX_ANCHORED_VWAP_BARS) throw new Error("Anchored VWAP exceeds 50,000 loaded bars. Move the anchor closer.");
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];
    if (![bar.time, bar.high, bar.low, bar.close, bar.volume ?? 0].every(Number.isFinite) || Math.abs(bar.time) >= 8640000000000000 ||
      bar.high < bar.low || bar.close < bar.low || bar.close > bar.high || (bar.volume ?? 0) < 0 || index > 0 && bar.time <= bars[index - 1].time)
      throw new Error("Anchored VWAP needs valid ascending HLCV bars with nonnegative volume.");
  }
  return bars;
}
function calculate(bars: readonly VwapBar[], multiplier: number): AnchoredVwapResult {
  const result: AnchoredVwapResult = { samples: [], volume: 0, rows: bars.length, positiveBars: 0, zeroBars: 0 };
  let mean = 0, deviation = 0;
  for (const bar of bars) {
    const volume = bar.volume ?? 0;
    if (volume > 0) {
      // Differences retain small moves on a large price base; the divided-term
      // fallback supports finite ranges whose subtraction itself overflows.
      const high = bar.high - bar.close, low = bar.low - bar.close;
      const price = Number.isFinite(high) && Number.isFinite(low) ? bar.close + high / 3 + low / 3 : bar.high / 3 + bar.low / 3 + bar.close / 3;
      const weight = result.volume + volume;
      if (!Number.isFinite(weight) || !Number.isFinite(price)) throw new Error("Anchored VWAP exceeds supported quantity or price precision.");
      if (result.volume === 0) { mean = price; deviation = 0; }
      else {
        const ratio = volume / weight, delta = price - mean, remaining = 1 - ratio;
        const factor = Math.sqrt(remaining) * Math.sqrt(ratio);
        // Weighted Welford in standard-deviation space avoids both E[p²]-E[p]²
        // cancellation and squaring a representable but very large price move.
        const step = Number.isFinite(delta) ? factor * delta : factor * price - factor * mean;
        deviation = Math.hypot(Math.sqrt(remaining) * deviation, step);
        mean = Number.isFinite(delta) ? mean + ratio * delta : remaining * mean + ratio * price;
      }
      result.volume = weight; result.positiveBars++;
    } else result.zeroBars++;
    // A leading zero-volume prefix has no VWAP. Later zero-volume bars carry
    // the observed weighted state, regardless of their prices.
    if (result.volume === 0) continue;
    const spread = deviation * multiplier, upper = mean + spread, lower = mean - spread;
    if (![mean, deviation, upper, lower].every(Number.isFinite)) throw new Error("Anchored VWAP bands exceed supported price precision.");
    result.samples.push({ time: bar.time, mid: mean, upper, lower, deviation });
  }
  return result;
}
export function anchoredVwap(source: readonly VwapBar[], anchor: number, multiplier = 1, through = Infinity): AnchoredVwapResult {
  return calculate(selected(source, anchor, multiplier, through), multiplier);
}
/** Snapshot comparisons catch in-place historical revisions as well as immutable
 * live replacements. A failed calculation cannot publish a partially updated cache. */
export class AnchoredVwapCache {
  private previous: VwapBar[] = [];
  private anchor = NaN;
  private multiplier = NaN;
  private result: AnchoredVwapResult | undefined;
  read(source: readonly VwapBar[], anchor: number, multiplier: number): AnchoredVwapResult {
    const bars = selected(source, anchor, multiplier, Infinity);
    if (this.result && this.anchor === anchor && this.multiplier === multiplier && bars.length === this.previous.length &&
      bars.every((bar, index) => fields.every(field => (bar[field] ?? 0) === (this.previous[index][field] ?? 0)))) return this.result;
    const result = calculate(bars, multiplier);
    this.previous = bars.map(bar => ({ ...bar })); this.anchor = anchor; this.multiplier = multiplier; this.result = result;
    return result;
  }
}
