import type { OHLCV } from "@/types/trading";
import {
  CANDLE_PATTERNS,
  detectCandlePatterns,
  type Bias,
} from "./candles";
import { CHART_PATTERNS, detectChartPatterns, type PatternLine } from "./chart";
import type {
  OverlayMarker,
  OverlayPrimitive,
  OverlaySegment,
} from "@/lib/chart/overlays";

export { CANDLE_PATTERNS, CHART_PATTERNS };
export type { Bias };

export interface PatternHit {
  key: string;
  id: string;
  name: string;
  kind: "candlestick" | "chart";
  bias: Bias;
  description: string;
  startIndex: number;
  endIndex: number;
  /** Open time of the bar where the formation completed. */
  time: number;
  confidence: number;
  confirmed: boolean;
  lines: PatternLine[];
}

export interface PatternOptions {
  candlestick: boolean;
  chart: boolean;
  /** Pattern ids to hide; everything else in the enabled families shows. */
  disabled: string[];
  minConfidence: number;
  /** Only detect over the most recent N bars (keeps big histories fast). */
  lookback: number;
}

/** Frequent, low-signal formations stay off until the user opts in. */
export const NOISY_PATTERNS = [
  "doji",
  "spinning-top",
  "inside-bar",
  "outside-bar",
  "bullish-marubozu",
  "bearish-marubozu",
  "rectangle",
  "tweezer-top",
  "tweezer-bottom",
  "bullish-harami",
  "bearish-harami",
];

export const DEFAULT_PATTERN_OPTIONS: PatternOptions = {
  candlestick: true,
  chart: true,
  disabled: NOISY_PATTERNS,
  minConfidence: 0.55,
  lookback: 300,
};

const MAX_CANDLE_HITS = 40;
const MAX_CHART_HITS = 8;

export function allPatternIds(): { id: string; name: string; kind: "candlestick" | "chart"; bias: Bias }[] {
  return [
    ...CANDLE_PATTERNS.map((p) => ({ id: p.id, name: p.name, kind: "candlestick" as const, bias: p.bias })),
    ...CHART_PATTERNS.map((p) => ({ id: p.id, name: p.name, kind: "chart" as const, bias: p.bias })),
  ];
}

export function detectPatterns(
  bars: readonly OHLCV[],
  options: PatternOptions = DEFAULT_PATTERN_OPTIONS,
): PatternHit[] {
  const offset = Math.max(0, bars.length - options.lookback);
  const window = bars.slice(offset);
  const hits: PatternHit[] = [];
  const enabled = (id: string) => !options.disabled.includes(id);
  const candleHits: PatternHit[] = [];
  if (options.candlestick)
    for (const hit of detectCandlePatterns(window, {
      ids: CANDLE_PATTERNS.map((p) => p.id).filter(enabled),
    })) {
      if (hit.confidence < options.minConfidence) continue;
      const index = hit.index + offset;
      candleHits.push({
        key: `${hit.id}:${index}`,
        id: hit.id,
        name: hit.name,
        kind: "candlestick",
        bias: hit.bias,
        description: hit.description,
        startIndex: index - hit.length + 1,
        endIndex: index,
        time: bars[index].time,
        confidence: hit.confidence,
        confirmed: true,
        lines: [],
      });
    }
  // One formation per candle (the most reliable), newest first, capped.
  const bestPerCandle = new Map<number, PatternHit>();
  for (const hit of candleHits) {
    const current = bestPerCandle.get(hit.endIndex);
    if (!current || hit.confidence > current.confidence)
      bestPerCandle.set(hit.endIndex, hit);
  }
  hits.push(
    ...[...bestPerCandle.values()]
      .sort((a, b) => b.endIndex - a.endIndex)
      .slice(0, MAX_CANDLE_HITS),
  );
  const chartHits: PatternHit[] = [];
  if (options.chart)
    for (const hit of detectChartPatterns(window, {
      ids: CHART_PATTERNS.map((p) => p.id).filter(enabled),
    })) {
      if (hit.confidence < options.minConfidence) continue;
      const shift = (line: PatternLine): PatternLine => ({
        ...line,
        from: { ...line.from, index: line.from.index + offset },
        to: { ...line.to, index: line.to.index + offset },
      });
      const endIndex = hit.endIndex + offset;
      chartHits.push({
        key: `${hit.id}:${endIndex}`,
        id: hit.id,
        name: hit.name,
        kind: "chart",
        bias: hit.bias,
        description: hit.description,
        startIndex: hit.startIndex + offset,
        endIndex,
        time: bars[endIndex].time,
        confidence: hit.confidence,
        confirmed: hit.confirmed,
        lines: hit.lines.map(shift),
      });
    }
  hits.push(
    ...chartHits
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_CHART_HITS),
  );
  return hits.sort((a, b) => a.endIndex - b.endIndex);
}

const COLORS: Record<Bias, string> = {
  bullish: "#089981",
  bearish: "#f23645",
  neutral: "#787b86",
};

/** Convert pattern hits into overlay primitives (markers and trend lines). */
export function patternOverlays(
  hits: readonly PatternHit[],
  bars: readonly OHLCV[],
): OverlayPrimitive[] {
  const out: OverlayPrimitive[] = [];
  const timeAt = (index: number) =>
    bars[Math.max(0, Math.min(bars.length - 1, index))].time;
  for (const hit of hits) {
    const bar = bars[hit.endIndex];
    if (!bar) continue;
    if (hit.kind === "candlestick") {
      const bearish = hit.bias === "bearish";
      const marker: OverlayMarker = {
        kind: "marker",
        time: bar.time,
        price: bearish ? bar.high : bar.low,
        shape: hit.bias === "neutral" ? "diamond" : bearish ? "triangleDown" : "triangleUp",
        color: COLORS[hit.bias],
        label: hit.name,
        position: bearish ? "above" : "below",
      };
      out.push(marker);
    } else {
      for (const line of hit.lines) {
        const segment: OverlaySegment = {
          kind: "segment",
          from: { time: timeAt(line.from.index), price: line.from.price },
          to: { time: timeAt(line.to.index), price: line.to.price },
          color: COLORS[hit.bias],
          width: line.label === "Neckline" ? 2 : 1.5,
          dash: line.label === "Neckline" ? [6, 4] : undefined,
          label: line.label === "Neckline" || line.label === "Pole" ? line.label : undefined,
        };
        out.push(segment);
      }
      out.push({
        kind: "marker",
        time: bar.time,
        price: hit.bias === "bearish" ? bar.high : bar.low,
        shape: "flag",
        color: COLORS[hit.bias],
        label: `${hit.name}${hit.confirmed ? " ✓" : ""}`,
        position: hit.bias === "bearish" ? "above" : "below",
      });
    }
  }
  return out;
}

