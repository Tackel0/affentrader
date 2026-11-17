import type { OHLCV } from "@/types/trading";
import { atr, pivots, lastValue, type Pivot } from "@/lib/ta";
import type { Bias } from "./candles";

export interface PatternLine {
  from: { index: number; price: number };
  to: { index: number; price: number };
  label?: string;
}

export interface ChartHit {
  id: string;
  name: string;
  bias: Bias;
  description: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
  /** True once price has closed through the pattern's trigger level. */
  confirmed: boolean;
  lines: PatternLine[];
}

export interface ChartPatternInfo {
  id: string;
  name: string;
  bias: Bias;
  description: string;
}

export const CHART_PATTERNS: ChartPatternInfo[] = [
  { id: "double-top", name: "Double top", bias: "bearish", description: "Two similar highs separated by a trough; the neckline break confirms." },
  { id: "double-bottom", name: "Double bottom", bias: "bullish", description: "Two similar lows separated by a peak; the neckline break confirms." },
  { id: "triple-top", name: "Triple top", bias: "bearish", description: "Three similar highs stopped at one resistance." },
  { id: "triple-bottom", name: "Triple bottom", bias: "bullish", description: "Three similar lows held at one support." },
  { id: "head-shoulders", name: "Head and shoulders", bias: "bearish", description: "A higher peak between two lower peaks; a neckline break confirms." },
  { id: "inverse-head-shoulders", name: "Inverse head and shoulders", bias: "bullish", description: "A deeper trough between two shallower troughs." },
  { id: "ascending-triangle", name: "Ascending triangle", bias: "bullish", description: "Flat resistance with rising support." },
  { id: "descending-triangle", name: "Descending triangle", bias: "bearish", description: "Flat support with falling resistance." },
  { id: "symmetrical-triangle", name: "Symmetrical triangle", bias: "neutral", description: "Converging lower highs and higher lows." },
  { id: "rising-wedge", name: "Rising wedge", bias: "bearish", description: "Both boundaries rise and converge." },
  { id: "falling-wedge", name: "Falling wedge", bias: "bullish", description: "Both boundaries fall and converge." },
  { id: "ascending-channel", name: "Ascending channel", bias: "bullish", description: "Parallel rising boundaries." },
  { id: "descending-channel", name: "Descending channel", bias: "bearish", description: "Parallel falling boundaries." },
  { id: "rectangle", name: "Rectangle range", bias: "neutral", description: "Horizontal support and resistance." },
  { id: "bull-flag", name: "Bull flag", bias: "bullish", description: "A sharp rise followed by a shallow, drifting consolidation." },
  { id: "bear-flag", name: "Bear flag", bias: "bearish", description: "A sharp drop followed by a shallow, drifting consolidation." },
];

interface Line {
  slope: number;
  intercept: number;
  r2: number;
}

function fit(points: { x: number; y: number }[]): Line | null {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return {
    slope,
    intercept: my - slope * mx,
    r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy),
  };
}
const at = (line: Line, x: number) => line.slope * x + line.intercept;

export interface ChartPatternOptions {
  /** Bars on each side that confirm a swing point. */
  strength?: number;
  ids?: string[];
}

export function detectChartPatterns(
  bars: readonly OHLCV[],
  options: ChartPatternOptions = {},
): ChartHit[] {
  const strength = Math.max(2, options.strength ?? 5);
  if (bars.length < strength * 4 + 10) return [];
  const range = atr(bars, 14);
  const swings = pivots(bars, strength, strength);
  const wanted = (id: string) => !options.ids || options.ids.includes(id);
  const hits: ChartHit[] = [];
  const atrAt = (index: number) => {
    const v = range[Math.min(index, range.length - 1)];
    return Number.isFinite(v) && v > 0 ? v : lastValue(range) || bars[index].close * 0.01;
  };
  const confirmedBelow = (from: number, level: number, within = 25) => {
    for (let i = from + 1; i < Math.min(bars.length, from + within); i++)
      if (bars[i].close < level) return true;
    return false;
  };
  const confirmedAbove = (from: number, level: number, within = 25) => {
    for (let i = from + 1; i < Math.min(bars.length, from + within); i++)
      if (bars[i].close > level) return true;
    return false;
  };
  const info = (id: string) => CHART_PATTERNS.find((p) => p.id === id)!;
  const push = (
    id: string,
    startIndex: number,
    endIndex: number,
    confidence: number,
    confirmed: boolean,
    lines: PatternLine[],
  ) => {
    if (!wanted(id)) return;
    const meta = info(id);
    hits.push({
      id,
      name: meta.name,
      bias: meta.bias,
      description: meta.description,
      startIndex,
      endIndex,
      confidence: Math.max(0.2, Math.min(0.95, confidence)),
      confirmed,
      lines,
    });
  };

  // Alternating windows of swings.
  const alternating = (window: Pivot[]) =>
    window.every((p, i) => i === 0 || p.kind !== window[i - 1].kind);

  for (let s = 0; s + 2 < swings.length; s++) {
    const three = swings.slice(s, s + 3);
    if (alternating(three)) {
      const [a, b, c] = three;
      const unit = atrAt(c.index);
      const similar = Math.abs(a.price - c.price) <= Math.max(unit * 0.9, a.price * 0.012);
      if (a.kind === "high" && similar && a.price - b.price >= unit * 2) {
        push(
          "double-top",
          a.index,
          c.index,
          0.55 + Math.min(0.3, (a.price - b.price) / (unit * 12)),
          confirmedBelow(c.index, b.price),
          [
            { from: { index: a.index, price: a.price }, to: { index: c.index, price: c.price }, label: "Top" },
            { from: { index: a.index, price: b.price }, to: { index: Math.min(bars.length - 1, c.index + 12), price: b.price }, label: "Neckline" },
          ],
        );
      }
      if (a.kind === "low" && similar && b.price - a.price >= unit * 2) {
        push(
          "double-bottom",
          a.index,
          c.index,
          0.55 + Math.min(0.3, (b.price - a.price) / (unit * 12)),
          confirmedAbove(c.index, b.price),
          [
            { from: { index: a.index, price: a.price }, to: { index: c.index, price: c.price }, label: "Bottom" },
            { from: { index: a.index, price: b.price }, to: { index: Math.min(bars.length - 1, c.index + 12), price: b.price }, label: "Neckline" },
          ],
        );
      }
    }
  }

  for (let s = 0; s + 4 < swings.length; s++) {
    const five = swings.slice(s, s + 5);
    if (!alternating(five)) continue;
    const [p0, p1, p2, p3, p4] = five;
    const unit = atrAt(p4.index);
    const tolerance = Math.max(unit, p0.price * 0.015);
    if (p0.kind === "high") {
      const flatTops = Math.max(p0.price, p2.price, p4.price) - Math.min(p0.price, p2.price, p4.price) <= tolerance;
      if (flatTops)
        push("triple-top", p0.index, p4.index, 0.6, confirmedBelow(p4.index, Math.min(p1.price, p3.price)), [
          { from: { index: p0.index, price: p0.price }, to: { index: p4.index, price: p4.price }, label: "Resistance" },
        ]);
      const head = p2.price - Math.max(p0.price, p4.price);
      const shoulderGap = Math.abs(p0.price - p4.price);
      if (head >= unit && shoulderGap <= head * 0.6 + tolerance * 0.5 && Math.abs(p1.price - p3.price) <= head * 1.2) {
        const neckline = (p1.price + p3.price) / 2;
        push("head-shoulders", p0.index, p4.index, 0.6 + Math.min(0.25, head / (unit * 10)), confirmedBelow(p4.index, neckline), [
          { from: { index: p1.index, price: p1.price }, to: { index: Math.min(bars.length - 1, p4.index + 10), price: p3.price }, label: "Neckline" },
          { from: { index: p0.index, price: p0.price }, to: { index: p2.index, price: p2.price } },
          { from: { index: p2.index, price: p2.price }, to: { index: p4.index, price: p4.price } },
        ]);
      }
    } else {
      const flatBottoms = Math.max(p0.price, p2.price, p4.price) - Math.min(p0.price, p2.price, p4.price) <= tolerance;
      if (flatBottoms)
        push("triple-bottom", p0.index, p4.index, 0.6, confirmedAbove(p4.index, Math.max(p1.price, p3.price)), [
          { from: { index: p0.index, price: p0.price }, to: { index: p4.index, price: p4.price }, label: "Support" },
        ]);
      const head = Math.min(p0.price, p4.price) - p2.price;
      const shoulderGap = Math.abs(p0.price - p4.price);
      if (head >= unit && shoulderGap <= head * 0.6 + tolerance * 0.5 && Math.abs(p1.price - p3.price) <= head * 1.2) {
        const neckline = (p1.price + p3.price) / 2;
        push("inverse-head-shoulders", p0.index, p4.index, 0.6 + Math.min(0.25, head / (unit * 10)), confirmedAbove(p4.index, neckline), [
          { from: { index: p1.index, price: p1.price }, to: { index: Math.min(bars.length - 1, p4.index + 10), price: p3.price }, label: "Neckline" },
          { from: { index: p0.index, price: p0.price }, to: { index: p2.index, price: p2.price } },
          { from: { index: p2.index, price: p2.price }, to: { index: p4.index, price: p4.price } },
        ]);
      }
    }
  }

  // Trend-line formations from the last swings on each side.
  for (let end = 0; end < swings.length; end++) {
    const upToHere = swings.slice(0, end + 1);
    const highs = upToHere.filter((p) => p.kind === "high").slice(-4);
    const lows = upToHere.filter((p) => p.kind === "low").slice(-4);
    if (highs.length < 3 || lows.length < 3) continue;
    const start = Math.min(highs[0].index, lows[0].index);
    const last = swings[end].index;
    if (last - start < strength * 3 || last - start > 400) continue;
    const upperLine = fit(highs.map((p) => ({ x: p.index, y: p.price })));
    const lowerLine = fit(lows.map((p) => ({ x: p.index, y: p.price })));
    if (!upperLine || !lowerLine || upperLine.r2 < 0.6 || lowerLine.r2 < 0.6) continue;
    const unit = atrAt(last);
    const upperSlope = (upperLine.slope * (last - start)) / unit;
    const lowerSlope = (lowerLine.slope * (last - start)) / unit;
    const flat = (v: number) => Math.abs(v) < 0.9;
    const widthStart = at(upperLine, start) - at(lowerLine, start);
    const widthEnd = at(upperLine, last) - at(lowerLine, last);
    if (widthStart <= 0 || widthEnd <= 0) continue;
    const converging = widthEnd < widthStart * 0.75;
    const parallel = widthEnd > widthStart * 0.8 && widthEnd < widthStart * 1.25;
    const rising = (v: number) => v >= 0.9;
    const falling = (v: number) => v <= -0.9;
    let id: string | null = null;
    if (converging) {
      if (flat(upperSlope) && rising(lowerSlope)) id = "ascending-triangle";
      else if (flat(lowerSlope) && falling(upperSlope)) id = "descending-triangle";
      else if (falling(upperSlope) && rising(lowerSlope)) id = "symmetrical-triangle";
      else if (rising(upperSlope) && rising(lowerSlope)) id = "rising-wedge";
      else if (falling(upperSlope) && falling(lowerSlope)) id = "falling-wedge";
    } else if (parallel) {
      if (rising(upperSlope) && rising(lowerSlope)) id = "ascending-channel";
      else if (falling(upperSlope) && falling(lowerSlope)) id = "descending-channel";
      else if (flat(upperSlope) && flat(lowerSlope)) id = "rectangle";
    }
    if (!id) continue;
    const fitQuality = (upperLine.r2 + lowerLine.r2) / 2;
    const lastClose = bars.at(-1)!.close;
    const confirmed =
      last < bars.length - 1 &&
      (lastClose > at(upperLine, bars.length - 1) || lastClose < at(lowerLine, bars.length - 1));
    push(id, start, last, 0.4 + fitQuality * 0.4, confirmed, [
      { from: { index: start, price: at(upperLine, start) }, to: { index: last, price: at(upperLine, last) }, label: "Resistance" },
      { from: { index: start, price: at(lowerLine, start) }, to: { index: last, price: at(lowerLine, last) }, label: "Support" },
    ]);
  }

  // Flags: a strong pole followed by a shallow counter-trend drift.
  if (wanted("bull-flag") || wanted("bear-flag")) {
    for (let end = 20; end < bars.length; end += 2) {
      for (const flagLength of [6, 10, 14]) {
        const flagStart = end - flagLength;
        const poleStart = flagStart - 12;
        if (poleStart < 0) continue;
        const unit = atrAt(end);
        const poleMove = bars[flagStart].close - bars[poleStart].close;
        if (Math.abs(poleMove) < unit * 5) continue;
        const flagBars = bars.slice(flagStart, end + 1);
        const high = Math.max(...flagBars.map((b) => b.high));
        const low = Math.min(...flagBars.map((b) => b.low));
        if (high - low > Math.abs(poleMove) * 0.5) continue;
        const drift = bars[end].close - bars[flagStart].close;
        const up = poleMove > 0;
        if ((up && (drift > unit * 0.5 || drift < -Math.abs(poleMove) * 0.5)) ||
            (!up && (drift < -unit * 0.5 || drift > Math.abs(poleMove) * 0.5)))
          continue;
        const upperFit = fit(flagBars.map((b, i) => ({ x: flagStart + i, y: b.high })));
        const lowerFit = fit(flagBars.map((b, i) => ({ x: flagStart + i, y: b.low })));
        if (!upperFit || !lowerFit) continue;
        push(up ? "bull-flag" : "bear-flag", poleStart, end, 0.55 + Math.min(0.3, Math.abs(poleMove) / (unit * 25)),
          up ? bars.at(-1)!.close > at(upperFit, bars.length - 1) && end < bars.length - 1
             : bars.at(-1)!.close < at(lowerFit, bars.length - 1) && end < bars.length - 1,
          [
            { from: { index: poleStart, price: bars[poleStart].close }, to: { index: flagStart, price: bars[flagStart].close }, label: "Pole" },
            { from: { index: flagStart, price: at(upperFit, flagStart) }, to: { index: end, price: at(upperFit, end) } },
            { from: { index: flagStart, price: at(lowerFit, flagStart) }, to: { index: end, price: at(lowerFit, end) } },
          ]);
      }
    }
  }

  // Keep the strongest hit per pattern within overlapping windows.
  hits.sort((a, b) => b.confidence - a.confidence);
  const kept: ChartHit[] = [];
  for (const hit of hits) {
    const duplicate = kept.some(
      (k) =>
        k.id === hit.id &&
        Math.abs(k.endIndex - hit.endIndex) < strength * 3 &&
        Math.abs(k.startIndex - hit.startIndex) < strength * 6,
    );
    if (!duplicate) kept.push(hit);
  }
  return kept.sort((a, b) => a.endIndex - b.endIndex);
}
