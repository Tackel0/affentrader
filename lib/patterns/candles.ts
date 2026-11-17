import type { OHLCV } from "@/types/trading";
import { sma, atr, lastValue } from "@/lib/ta";

export type Bias = "bullish" | "bearish" | "neutral";

export interface CandlePattern {
  id: string;
  name: string;
  bias: Bias;
  /** Number of candles in the formation. */
  length: number;
  description: string;
}

export interface CandleHit extends CandlePattern {
  /** Index of the last candle of the formation. */
  index: number;
  confidence: number;
}

const body = (b: OHLCV) => Math.abs(b.close - b.open);
const range = (b: OHLCV) => b.high - b.low;
const upper = (b: OHLCV) => b.high - Math.max(b.open, b.close);
const lower = (b: OHLCV) => Math.min(b.open, b.close) - b.low;
const bull = (b: OHLCV) => b.close > b.open;
const bear = (b: OHLCV) => b.close < b.open;
const mid = (b: OHLCV) => (b.open + b.close) / 2;

type Trend = "up" | "down" | "flat";
interface Context {
  bars: readonly OHLCV[];
  /** Average candle body over the lookback, used to call a candle "long". */
  avgBody: number[];
  trend: (index: number) => Trend;
}

/** Mean of the last `length` values, using what is available while warming up. */
function trailingMean(values: number[], length: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= length) sum -= values[i - length];
    out.push(sum / Math.min(i + 1, length));
  }
  return out;
}

function createContext(bars: readonly OHLCV[]): Context {
  const avgBody = trailingMean(bars.map(body), 14);
  const avgRange = trailingMean(bars.map(range), 14);
  const closes = bars.map((b) => b.close);
  const slow = sma(closes, 10);
  return {
    bars,
    avgBody,
    trend: (index) => {
      // Direction of the prior move, judged on candles before `index`.
      const end = index - 1;
      const start = end - 6;
      if (start < 0 || !Number.isFinite(slow[end])) return "flat";
      const move = closes[end] - closes[start];
      const threshold = (avgRange[end] || range(bars[end])) * 1.2;
      if (move > threshold) return "up";
      if (move < -threshold) return "down";
      return "flat";
    },
  };
}

type Matcher = (c: Context, i: number) => number | false;

const long = (c: Context, i: number) => body(c.bars[i]) >= c.avgBody[i] * 1.0;
const small = (c: Context, i: number) => body(c.bars[i]) <= c.avgBody[i] * 0.6;

export const CANDLE_PATTERNS: (CandlePattern & { match: Matcher })[] = [
  {
    id: "doji",
    name: "Doji",
    bias: "neutral",
    length: 1,
    description: "Open and close are nearly equal: indecision.",
    match: (c, i) => {
      const b = c.bars[i];
      return range(b) > 0 && body(b) <= range(b) * 0.1 ? 0.6 : false;
    },
  },
  {
    id: "dragonfly-doji",
    name: "Dragonfly doji",
    bias: "bullish",
    length: 1,
    description: "Long lower shadow with no upper shadow after a decline.",
    match: (c, i) => {
      const b = c.bars[i];
      return range(b) > 0 &&
        body(b) <= range(b) * 0.1 &&
        lower(b) >= range(b) * 0.7 &&
        c.trend(i) === "down"
        ? 0.7
        : false;
    },
  },
  {
    id: "gravestone-doji",
    name: "Gravestone doji",
    bias: "bearish",
    length: 1,
    description: "Long upper shadow with no lower shadow after a rally.",
    match: (c, i) => {
      const b = c.bars[i];
      return range(b) > 0 &&
        body(b) <= range(b) * 0.1 &&
        upper(b) >= range(b) * 0.7 &&
        c.trend(i) === "up"
        ? 0.7
        : false;
    },
  },
  {
    id: "hammer",
    name: "Hammer",
    bias: "bullish",
    length: 1,
    description: "Small body with a long lower shadow after a decline.",
    match: (c, i) => {
      const b = c.bars[i];
      return body(b) > range(b) * 0.1 &&
        lower(b) >= body(b) * 2 &&
        upper(b) <= Math.max(body(b) * 0.6, range(b) * 0.08) &&
        body(b) <= range(b) * 0.4 &&
        c.trend(i) === "down"
        ? 0.7
        : false;
    },
  },
  {
    id: "hanging-man",
    name: "Hanging man",
    bias: "bearish",
    length: 1,
    description: "Hammer shape after a rally warns of selling pressure.",
    match: (c, i) => {
      const b = c.bars[i];
      return body(b) > range(b) * 0.1 &&
        lower(b) >= body(b) * 2 &&
        upper(b) <= Math.max(body(b) * 0.6, range(b) * 0.08) &&
        body(b) <= range(b) * 0.4 &&
        c.trend(i) === "up"
        ? 0.6
        : false;
    },
  },
  {
    id: "inverted-hammer",
    name: "Inverted hammer",
    bias: "bullish",
    length: 1,
    description: "Long upper shadow, small body, after a decline.",
    match: (c, i) => {
      const b = c.bars[i];
      return body(b) > range(b) * 0.1 &&
        upper(b) >= body(b) * 2 &&
        lower(b) <= Math.max(body(b) * 0.6, range(b) * 0.08) &&
        body(b) <= range(b) * 0.4 &&
        c.trend(i) === "down"
        ? 0.55
        : false;
    },
  },
  {
    id: "shooting-star",
    name: "Shooting star",
    bias: "bearish",
    length: 1,
    description: "Long upper shadow, small body, after a rally.",
    match: (c, i) => {
      const b = c.bars[i];
      return body(b) > range(b) * 0.1 &&
        upper(b) >= body(b) * 2 &&
        lower(b) <= Math.max(body(b) * 0.6, range(b) * 0.08) &&
        body(b) <= range(b) * 0.4 &&
        c.trend(i) === "up"
        ? 0.7
        : false;
    },
  },
  {
    id: "bullish-marubozu",
    name: "Bullish marubozu",
    bias: "bullish",
    length: 1,
    description: "A long up candle with almost no shadows.",
    match: (c, i) => {
      const b = c.bars[i];
      return bull(b) && range(b) > 0 && body(b) >= range(b) * 0.95 && long(c, i) ? 0.65 : false;
    },
  },
  {
    id: "bearish-marubozu",
    name: "Bearish marubozu",
    bias: "bearish",
    length: 1,
    description: "A long down candle with almost no shadows.",
    match: (c, i) => {
      const b = c.bars[i];
      return bear(b) && range(b) > 0 && body(b) >= range(b) * 0.95 && long(c, i) ? 0.65 : false;
    },
  },
  {
    id: "spinning-top",
    name: "Spinning top",
    bias: "neutral",
    length: 1,
    description: "Small body with shadows on both sides.",
    match: (c, i) => {
      const b = c.bars[i];
      return range(b) > 0 &&
        body(b) <= range(b) * 0.3 &&
        body(b) > range(b) * 0.1 &&
        upper(b) >= body(b) &&
        lower(b) >= body(b)
        ? 0.4
        : false;
    },
  },
  {
    id: "inside-bar",
    name: "Inside bar",
    bias: "neutral",
    length: 2,
    description: "The range sits inside the previous candle: compression.",
    match: (c, i) => {
      if (i < 1) return false;
      const [p, b] = [c.bars[i - 1], c.bars[i]];
      return b.high < p.high && b.low > p.low ? 0.4 : false;
    },
  },
  {
    id: "outside-bar",
    name: "Outside bar",
    bias: "neutral",
    length: 2,
    description: "The range engulfs the previous candle: expansion.",
    match: (c, i) => {
      if (i < 1) return false;
      const [p, b] = [c.bars[i - 1], c.bars[i]];
      return b.high > p.high && b.low < p.low ? 0.4 : false;
    },
  },
  {
    id: "bullish-engulfing",
    name: "Bullish engulfing",
    bias: "bullish",
    length: 2,
    description: "An up candle fully engulfs the prior down candle after a decline.",
    match: (c, i) => {
      if (i < 1) return false;
      const [p, b] = [c.bars[i - 1], c.bars[i]];
      return bear(p) && bull(b) && b.open <= p.close && b.close >= p.open &&
        body(b) > body(p) && c.trend(i) === "down"
        ? 0.75
        : false;
    },
  },
  {
    id: "bearish-engulfing",
    name: "Bearish engulfing",
    bias: "bearish",
    length: 2,
    description: "A down candle fully engulfs the prior up candle after a rally.",
    match: (c, i) => {
      if (i < 1) return false;
      const [p, b] = [c.bars[i - 1], c.bars[i]];
      return bull(p) && bear(b) && b.open >= p.close && b.close <= p.open &&
        body(b) > body(p) && c.trend(i) === "up"
        ? 0.75
        : false;
    },
  },
  {
    id: "bullish-harami",
    name: "Bullish harami",
    bias: "bullish",
    length: 2,
    description: "A small up candle inside a large down candle after a decline.",
    match: (c, i) => {
      if (i < 1) return false;
      const [p, b] = [c.bars[i - 1], c.bars[i]];
      return bear(p) && bull(b) && long(c, i - 1) && b.open > p.close && b.close < p.open &&
        c.trend(i) === "down"
        ? 0.55
        : false;
    },
  },
  {
    id: "bearish-harami",
    name: "Bearish harami",
    bias: "bearish",
    length: 2,
    description: "A small down candle inside a large up candle after a rally.",
    match: (c, i) => {
      if (i < 1) return false;
      const [p, b] = [c.bars[i - 1], c.bars[i]];
      return bull(p) && bear(b) && long(c, i - 1) && b.open < p.close && b.close > p.open &&
        c.trend(i) === "up"
        ? 0.55
        : false;
    },
  },
  {
    id: "piercing-line",
    name: "Piercing line",
    bias: "bullish",
    length: 2,
    description: "An up candle closes above the midpoint of the prior down candle.",
    match: (c, i) => {
      if (i < 1) return false;
      const [p, b] = [c.bars[i - 1], c.bars[i]];
      return bear(p) && bull(b) && long(c, i - 1) && b.open <= p.close &&
        b.close > mid(p) && b.close < p.open && c.trend(i) === "down"
        ? 0.65
        : false;
    },
  },
  {
    id: "dark-cloud-cover",
    name: "Dark cloud cover",
    bias: "bearish",
    length: 2,
    description: "A down candle closes below the midpoint of the prior up candle.",
    match: (c, i) => {
      if (i < 1) return false;
      const [p, b] = [c.bars[i - 1], c.bars[i]];
      return bull(p) && bear(b) && long(c, i - 1) && b.open >= p.close && b.close < mid(p) &&
        b.close > p.open && c.trend(i) === "up"
        ? 0.65
        : false;
    },
  },
  {
    id: "tweezer-top",
    name: "Tweezer top",
    bias: "bearish",
    length: 2,
    description: "Two candles share the same high after a rally.",
    match: (c, i) => {
      if (i < 1) return false;
      const [p, b] = [c.bars[i - 1], c.bars[i]];
      return bull(p) && bear(b) && Math.abs(p.high - b.high) <= range(p) * 0.05 &&
        c.trend(i) === "up"
        ? 0.55
        : false;
    },
  },
  {
    id: "tweezer-bottom",
    name: "Tweezer bottom",
    bias: "bullish",
    length: 2,
    description: "Two candles share the same low after a decline.",
    match: (c, i) => {
      if (i < 1) return false;
      const [p, b] = [c.bars[i - 1], c.bars[i]];
      return bear(p) && bull(b) && Math.abs(p.low - b.low) <= range(p) * 0.05 &&
        c.trend(i) === "down"
        ? 0.55
        : false;
    },
  },
  {
    id: "morning-star",
    name: "Morning star",
    bias: "bullish",
    length: 3,
    description: "Long down candle, small star, long up candle closing into the first body.",
    match: (c, i) => {
      if (i < 2) return false;
      const [a, s, b] = [c.bars[i - 2], c.bars[i - 1], c.bars[i]];
      return bear(a) && long(c, i - 2) && small(c, i - 1) && bull(b) && long(c, i) &&
        Math.max(s.open, s.close) < a.close + body(a) * 0.1 && b.close > mid(a) &&
        c.trend(i - 1) === "down"
        ? 0.8
        : false;
    },
  },
  {
    id: "evening-star",
    name: "Evening star",
    bias: "bearish",
    length: 3,
    description: "Long up candle, small star, long down candle closing into the first body.",
    match: (c, i) => {
      if (i < 2) return false;
      const [a, s, b] = [c.bars[i - 2], c.bars[i - 1], c.bars[i]];
      return bull(a) && long(c, i - 2) && small(c, i - 1) && bear(b) && long(c, i) &&
        Math.min(s.open, s.close) > a.close - body(a) * 0.1 && b.close < mid(a) &&
        c.trend(i - 1) === "up"
        ? 0.8
        : false;
    },
  },
  {
    id: "three-white-soldiers",
    name: "Three white soldiers",
    bias: "bullish",
    length: 3,
    description: "Three consecutive long up candles, each closing higher.",
    match: (c, i) => {
      if (i < 2) return false;
      const [a, b, d] = [c.bars[i - 2], c.bars[i - 1], c.bars[i]];
      return [a, b, d].every(bull) && [i - 2, i - 1, i].every((k) => long(c, k)) &&
        b.close > a.close && d.close > b.close &&
        b.open > a.open && b.open < a.close && d.open > b.open && d.open < b.close
        ? 0.75
        : false;
    },
  },
  {
    id: "three-black-crows",
    name: "Three black crows",
    bias: "bearish",
    length: 3,
    description: "Three consecutive long down candles, each closing lower.",
    match: (c, i) => {
      if (i < 2) return false;
      const [a, b, d] = [c.bars[i - 2], c.bars[i - 1], c.bars[i]];
      return [a, b, d].every(bear) && [i - 2, i - 1, i].every((k) => long(c, k)) &&
        b.close < a.close && d.close < b.close &&
        b.open < a.open && b.open > a.close && d.open < b.open && d.open > b.close
        ? 0.75
        : false;
    },
  },
  {
    id: "three-inside-up",
    name: "Three inside up",
    bias: "bullish",
    length: 3,
    description: "Bullish harami confirmed by a close above the first candle's open.",
    match: (c, i) => {
      if (i < 2) return false;
      const [a, b, d] = [c.bars[i - 2], c.bars[i - 1], c.bars[i]];
      return bear(a) && long(c, i - 2) && bull(b) && b.open > a.close && b.close < a.open &&
        bull(d) && d.close > a.open && c.trend(i - 1) === "down"
        ? 0.7
        : false;
    },
  },
  {
    id: "three-inside-down",
    name: "Three inside down",
    bias: "bearish",
    length: 3,
    description: "Bearish harami confirmed by a close below the first candle's open.",
    match: (c, i) => {
      if (i < 2) return false;
      const [a, b, d] = [c.bars[i - 2], c.bars[i - 1], c.bars[i]];
      return bull(a) && long(c, i - 2) && bear(b) && b.open < a.close && b.close > a.open &&
        bear(d) && d.close < a.open && c.trend(i - 1) === "up"
        ? 0.7
        : false;
    },
  },
  {
    id: "rising-three-methods",
    name: "Rising three methods",
    bias: "bullish",
    length: 5,
    description: "A long up candle, three small pullbacks inside it, then a new high close.",
    match: (c, i) => {
      if (i < 4) return false;
      const k = c.bars.slice(i - 4, i + 1);
      const inside = [1, 2, 3].every(
        (n) => k[n].high <= k[0].high && k[n].low >= k[0].low && bear(k[n]),
      );
      return bull(k[0]) && long(c, i - 4) && inside && bull(k[4]) && k[4].close > k[0].close
        ? 0.7
        : false;
    },
  },
  {
    id: "falling-three-methods",
    name: "Falling three methods",
    bias: "bearish",
    length: 5,
    description: "A long down candle, three small rallies inside it, then a new low close.",
    match: (c, i) => {
      if (i < 4) return false;
      const k = c.bars.slice(i - 4, i + 1);
      const inside = [1, 2, 3].every(
        (n) => k[n].high <= k[0].high && k[n].low >= k[0].low && bull(k[n]),
      );
      return bear(k[0]) && long(c, i - 4) && inside && bear(k[4]) && k[4].close < k[0].close
        ? 0.7
        : false;
    },
  },
];

/** Detect every candlestick formation in `bars`; later candles win ties per id. */
export function detectCandlePatterns(
  bars: readonly OHLCV[],
  options: { ids?: string[]; from?: number } = {},
): CandleHit[] {
  const context = createContext(bars);
  const hits: CandleHit[] = [];
  const active = CANDLE_PATTERNS.filter(
    (p) => !options.ids || options.ids.includes(p.id),
  );
  for (let i = Math.max(options.from ?? 0, 2); i < bars.length; i++) {
    for (const pattern of active) {
      const confidence = pattern.match(context, i);
      if (confidence === false) continue;
      hits.push({
        id: pattern.id,
        name: pattern.name,
        bias: pattern.bias,
        length: pattern.length,
        description: pattern.description,
        index: i,
        confidence,
      });
    }
  }
  return hits;
}

export function recentRange(bars: readonly OHLCV[], length = 14): number {
  return lastValue(atr(bars, length)) || 0;
}

