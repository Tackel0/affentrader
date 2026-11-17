import type { OHLCV } from "@/types/trading";
import {
  adx,
  atr,
  bollinger,
  cci,
  ema,
  highest,
  lastValue,
  lowest,
  macd,
  mfi,
  rsi,
  sma,
  source,
  stochastic,
  supertrend,
  williamsR,
} from "@/lib/ta";

export interface Technicals {
  rsi: number;
  stochK: number;
  cci: number;
  mfi: number;
  williamsR: number;
  adx: number;
  /** MACD histogram as a percent of price, so symbols compare. */
  macdPercent: number;
  atrPercent: number;
  /** Position inside the Bollinger bands: 0 at the lower band, 1 at the upper. */
  bbPercentB: number;
  /** Distance of price above (+) or below (−) each moving average, in percent. */
  ema20: number;
  ema50: number;
  ema200: number;
  /** Latest volume divided by its 20-bar average. */
  rvol: number;
  change1: number;
  change5: number;
  change20: number;
  /** Distance below the 20-bar high and above the 20-bar low, in percent. */
  fromHigh20: number;
  fromLow20: number;
  supertrend: 1 | -1;
  /** −1 (strong sell) … +1 (strong buy), averaged over MAs and oscillators. */
  rating: number;
  ratingLabel: RatingLabel;
}

export type RatingLabel = "Strong sell" | "Sell" | "Neutral" | "Buy" | "Strong buy";

export function ratingLabel(score: number): RatingLabel {
  if (score <= -0.5) return "Strong sell";
  if (score <= -0.1) return "Sell";
  if (score < 0.1) return "Neutral";
  if (score < 0.5) return "Buy";
  return "Strong buy";
}

const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : Number.NaN);

/** Compute every screener metric from candles; null when history is too short. */
export function computeTechnicals(bars: readonly OHLCV[]): Technicals | null {
  if (bars.length < 60) return null;
  const closes = source(bars, "close");
  const price = closes.at(-1)!;
  const e = (n: number) => lastValue(ema(closes, n));
  const s = (n: number) => lastValue(sma(closes, n));
  const m = macd(closes);
  const stoch = stochastic(bars);
  const directional = adx(bars);
  const bands = bollinger(closes);
  const volume = source(bars, "volume");
  const avgVolume = lastValue(sma(volume.slice(0, -1), 20));
  const high20 = lastValue(highest(source(bars, "high"), 20));
  const low20 = lastValue(lowest(source(bars, "low"), 20));
  const trend = supertrend(bars);
  const ema200 = bars.length >= 200 ? e(200) : Number.NaN;
  const t: Omit<Technicals, "rating" | "ratingLabel"> = {
    rsi: lastValue(rsi(closes, 14)),
    stochK: lastValue(stoch.k),
    cci: lastValue(cci(bars)),
    mfi: lastValue(mfi(bars)),
    williamsR: lastValue(williamsR(bars)),
    adx: lastValue(directional.adx),
    macdPercent: (lastValue(m.histogram) / price) * 100,
    atrPercent: (lastValue(atr(bars, 14)) / price) * 100,
    bbPercentB:
      (price - lastValue(bands.lower)) /
      (lastValue(bands.upper) - lastValue(bands.lower) || Number.NaN),
    ema20: pct(price, e(20)),
    ema50: pct(price, e(50)),
    ema200: pct(price, ema200),
    rvol: avgVolume ? volume.at(-1)! / avgVolume : Number.NaN,
    change1: pct(price, closes.at(-2)!),
    change5: pct(price, closes.at(-6)!),
    change20: pct(price, closes.at(-21)!),
    fromHigh20: pct(price, high20),
    fromLow20: pct(price, low20),
    supertrend: lastValue(trend.direction) >= 0 ? 1 : -1,
  };
  const votes: number[] = [];
  for (const length of [10, 20, 30, 50, 100, 200]) {
    if (bars.length < length) continue;
    votes.push(price > e(length) ? 1 : -1, price > s(length) ? 1 : -1);
  }
  votes.push(t.rsi < 30 ? 1 : t.rsi > 70 ? -1 : 0);
  votes.push(t.stochK < 20 ? 1 : t.stochK > 80 ? -1 : 0);
  votes.push(t.cci < -100 ? 1 : t.cci > 100 ? -1 : 0);
  votes.push(t.williamsR < -80 ? 1 : t.williamsR > -20 ? -1 : 0);
  votes.push(
    t.adx > 20
      ? lastValue(directional.plusDi) > lastValue(directional.minusDi)
        ? 1
        : -1
      : 0,
  );
  votes.push(lastValue(m.macd) > lastValue(m.signal) ? 1 : -1);
  votes.push(t.supertrend);
  const rating = votes.reduce((sum, v) => sum + v, 0) / votes.length;
  return { ...t, rating, ratingLabel: ratingLabel(rating) };
}

export interface ScreenerRow extends Partial<Technicals> {
  symbol: string;
  price: number;
  change24h: number;
  quoteVolume: number;
  volume: number;
  trades: number;
  high24h: number;
  low24h: number;
  /** Where the price sits in its 24h range, 0–100. */
  rangePosition: number;
}

export type FilterOp = ">" | "<" | ">=" | "<=" | "between" | "=";
export interface ScreenerFilter {
  id: string;
  field: keyof ScreenerRow;
  op: FilterOp;
  value: number;
  value2?: number;
}

export function matchesFilter(row: ScreenerRow, filter: ScreenerFilter): boolean {
  const raw = row[filter.field];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return false;
  switch (filter.op) {
    case ">":
      return raw > filter.value;
    case "<":
      return raw < filter.value;
    case ">=":
      return raw >= filter.value;
    case "<=":
      return raw <= filter.value;
    case "=":
      return raw === filter.value;
    case "between":
      return raw >= Math.min(filter.value, filter.value2 ?? filter.value) && raw <= Math.max(filter.value, filter.value2 ?? filter.value);
  }
}

export function applyFilters(rows: readonly ScreenerRow[], filters: readonly ScreenerFilter[]): ScreenerRow[] {
  return rows.filter((row) => filters.every((f) => matchesFilter(row, f)));
}

export interface FieldInfo {
  key: keyof ScreenerRow;
  label: string;
  group: "Market" | "Momentum" | "Trend" | "Volatility" | "Volume" | "Rating";
  /** True when the field needs candles (technical mode). */
  technical: boolean;
  digits: number;
}

export const SCREENER_FIELDS: FieldInfo[] = [
  { key: "price", label: "Price", group: "Market", technical: false, digits: 4 },
  { key: "change24h", label: "Change 24h %", group: "Market", technical: false, digits: 2 },
  { key: "quoteVolume", label: "Turnover 24h (USDT)", group: "Volume", technical: false, digits: 0 },
  { key: "trades", label: "Trades 24h", group: "Volume", technical: false, digits: 0 },
  { key: "rangePosition", label: "24h range position %", group: "Market", technical: false, digits: 0 },
  { key: "rsi", label: "RSI (14)", group: "Momentum", technical: true, digits: 1 },
  { key: "stochK", label: "Stochastic %K", group: "Momentum", technical: true, digits: 1 },
  { key: "cci", label: "CCI (20)", group: "Momentum", technical: true, digits: 0 },
  { key: "mfi", label: "MFI (14)", group: "Momentum", technical: true, digits: 1 },
  { key: "macdPercent", label: "MACD histogram %", group: "Momentum", technical: true, digits: 3 },
  { key: "adx", label: "ADX (14)", group: "Trend", technical: true, digits: 1 },
  { key: "ema20", label: "Price vs EMA 20 %", group: "Trend", technical: true, digits: 2 },
  { key: "ema50", label: "Price vs EMA 50 %", group: "Trend", technical: true, digits: 2 },
  { key: "ema200", label: "Price vs EMA 200 %", group: "Trend", technical: true, digits: 2 },
  { key: "supertrend", label: "Supertrend (1 up / −1 down)", group: "Trend", technical: true, digits: 0 },
  { key: "atrPercent", label: "ATR %", group: "Volatility", technical: true, digits: 2 },
  { key: "bbPercentB", label: "Bollinger %B", group: "Volatility", technical: true, digits: 2 },
  { key: "rvol", label: "Relative volume", group: "Volume", technical: true, digits: 2 },
  { key: "change1", label: "Change 1 bar %", group: "Market", technical: true, digits: 2 },
  { key: "change5", label: "Change 5 bars %", group: "Market", technical: true, digits: 2 },
  { key: "change20", label: "Change 20 bars %", group: "Market", technical: true, digits: 2 },
  { key: "fromHigh20", label: "From 20-bar high %", group: "Market", technical: true, digits: 2 },
  { key: "fromLow20", label: "From 20-bar low %", group: "Market", technical: true, digits: 2 },
  { key: "rating", label: "Technical rating (−1…1)", group: "Rating", technical: true, digits: 2 },
];

export interface ScreenerPreset {
  id: string;
  name: string;
  timeframe: string;
  filters: ScreenerFilter[];
}

let counter = 0;
const f = (field: keyof ScreenerRow, op: FilterOp, value: number, value2?: number): ScreenerFilter => ({
  id: `preset-${++counter}`,
  field,
  op,
  value,
  value2,
});

export const BUILT_IN_PRESETS: ScreenerPreset[] = [
  { id: "oversold", name: "Oversold (RSI < 30)", timeframe: "1h", filters: [f("rsi", "<", 30)] },
  { id: "overbought", name: "Overbought (RSI > 70)", timeframe: "1h", filters: [f("rsi", ">", 70)] },
  { id: "strong-trend", name: "Strong uptrend", timeframe: "4h", filters: [f("adx", ">", 25), f("ema50", ">", 0), f("ema200", ">", 0), f("supertrend", "=", 1)] },
  { id: "breakout", name: "Volume breakout", timeframe: "1h", filters: [f("rvol", ">", 2), f("fromHigh20", ">", -0.5)] },
  { id: "squeeze", name: "Low volatility squeeze", timeframe: "1h", filters: [f("bbPercentB", "between", 0.4, 0.6), f("atrPercent", "<", 0.6)] },
  { id: "strong-buy", name: "Strong buy rating", timeframe: "4h", filters: [f("rating", ">=", 0.5)] },
];
