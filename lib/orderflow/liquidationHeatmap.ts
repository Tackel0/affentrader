import { nextBucket, parseInterval } from "@/lib/market/intervals";
import { bybitMarket, isSymbolId, providerOf } from "@/lib/symbolId";
import type { OHLCV } from "@luxalgo/vela";

export const LIQUIDATION_HEATMAP = "af-liquidation-heatmap";
export const LIQUIDATION_LEVERAGES = {
  "5× / 10× / 20×": [5, 10, 20],
  "10× / 20× / 40×": [10, 20, 40],
  "20× / 50× / 100×": [20, 50, 100],
} as const;

export const defaultLiquidationHeatmap = {
  leverages: "10× / 20× / 40×" as keyof typeof LIQUIDATION_LEVERAGES,
  maintenancePercent: 0.5,
  lookback: 180,
  rowPercent: 0.25,
  opacity: 65,
  longColor: "#38bdf8",
  shortColor: "#f59e0b",
};

export function liquidationHeatmapSettings(input: Record<string, unknown>): typeof defaultLiquidationHeatmap {
  const defaults = defaultLiquidationHeatmap;
  const number = (key: "maintenancePercent" | "lookback" | "rowPercent" | "opacity", min: number, max: number) => {
    const value = input[key];
    return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : defaults[key];
  };
  const color = (key: "longColor" | "shortColor") => {
    const value = input[key];
    return typeof value === "string" && /^#[\da-f]{6}$/i.test(value) ? value : defaults[key];
  };
  return {
    leverages: typeof input.leverages === "string" && Object.hasOwn(LIQUIDATION_LEVERAGES, input.leverages)
      ? input.leverages as keyof typeof LIQUIDATION_LEVERAGES : defaults.leverages,
    maintenancePercent: number("maintenancePercent", 0, 0.75),
    lookback: Math.round(number("lookback", 30, 360)),
    rowPercent: number("rowPercent", 0.1, 1),
    opacity: number("opacity", 10, 85),
    longColor: color("longColor"),
    shortColor: color("shortColor"),
  };
}

export function liquidationReference(symbol: string): "Perpetual reference" | "Spot reference" | null {
  if (!isSymbolId(symbol)) return null;
  const provider = providerOf(symbol);
  if (provider === "hyperliquid" || bybitMarket(symbol)?.category === "linear") return "Perpetual reference";
  return provider === "binance" || provider === "kraken" || provider === "bybit" ? "Spot reference" : null;
}

type Side = "long" | "short";
/** Isolated linear position with constant maintenance margin, before fees or funding. */
export function estimatedLiquidationPrice(entry: number, leverage: number, maintenance: number, side: Side): number {
  return side === "long" ? entry * ((1 - 1 / leverage) / (1 - maintenance))
    : entry * ((1 + 1 / leverage) / (1 + maintenance));
}

export interface LiquidationBand {
  side: Side;
  row: number;
  from: number;
  to: number | null;
  weight: number;
}

interface ActiveBand {
  from: number;
  weight: number;
  center: number;
}

export function completedLiquidationBars(bars: readonly OHLCV[], timeframe: string, through: number): number {
  const interval = parseInterval(timeframe);
  if (!interval || interval.unit === "T" || !Number.isFinite(through)) return 0;
  let end = bars.length;
  while (end && !(nextBucket(timeframe, bars[end - 1].time) <= through)) end--;
  return end;
}

export function buildLiquidationHeatmap(bars: readonly OHLCV[], end: number, timeframe: string, settings: typeof defaultLiquidationHeatmap) {
  const start = Math.max(0, end - settings.lookback);
  const logStep = Math.log1p(settings.rowPercent / 100);
  const leverages = LIQUIDATION_LEVERAGES[settings.leverages];
  let maxVolume = 0;
  for (let i = start; i < end; i++) {
    const volume = bars[i].volume ?? 0;
    if (Number.isFinite(volume)) maxVolume = Math.max(maxVolume, volume);
  }

  const bands: LiquidationBand[] = [];
  const active = { long: new Map<number, ActiveBand>(), short: new Map<number, ActiveBand>() };
  let maxWeight = 0;
  let previousClose: number | undefined;
  const save = (side: Side, row: number, band: ActiveBand, to: number | null) => {
    if (to !== null && to <= band.from) return;
    bands.push({ side, row, from: band.from, to, weight: band.weight });
    maxWeight = Math.max(maxWeight, band.weight);
  };
  if (!maxVolume) return { bands, logStep, maxWeight };

  for (let i = start; i < end; i++) {
    const bar = bars[i];
    const volume = bar.volume ?? 0;
    const closeTime = nextBucket(timeframe, bar.time);
    if (!Number.isFinite(closeTime) || closeTime <= bar.time || bar.time < (previousClose ?? 0)) continue;
    const validPrices = Number.isFinite(bar.low) && Number.isFinite(bar.high) && Number.isFinite(bar.close)
      && bar.low > 0 && bar.low <= bar.close && bar.close <= bar.high;
    const gap = previousClose !== undefined && previousClose !== bar.time;
    for (const side of ["long", "short"] as const) {
      for (const [row, band] of active[side]) {
        const crossed = side === "long" ? bar.low <= band.center : bar.high >= band.center;
        if (gap || !validPrices || crossed) {
          save(side, row, band, gap ? previousClose! : bar.time);
          active[side].delete(row);
        }
      }
      if (!validPrices || !Number.isFinite(volume) || volume <= 0) continue;
      const weight = volume / maxVolume / leverages.length;
      for (const leverage of leverages) {
        const price = estimatedLiquidationPrice(bar.close, leverage, settings.maintenancePercent / 100, side);
        const row = Math.round(Math.log(price) / logStep);
        const center = Math.exp(row * logStep);
        if (!Number.isFinite(center) || center <= 0 || (side === "long" ? center >= bar.close : center <= bar.close)) continue;
        const prior = active[side].get(row);
        if (prior) save(side, row, prior, closeTime);
        active[side].set(row, { from: closeTime, weight: weight + (prior?.weight ?? 0), center });
      }
    }
    previousClose = closeTime;
  }
  for (const side of ["long", "short"] as const) {
    for (const [row, band] of active[side]) save(side, row, band, null);
  }
  return { bands, logStep, maxWeight };
}
