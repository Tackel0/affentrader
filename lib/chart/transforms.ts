import type { OHLCV } from "@/types/trading";
import { atr } from "@/lib/ta";
import { requireMarkCapacity, requirePriceStep } from "./transformCapacity";

/**
 * Non-time chart transforms. Each takes raw OHLCV and returns derived marks
 * plus the source bar index where each mark completed, which the renderer
 * uses to align marks with the time axis (see `assignSlots`).
 */
export interface Brick {
  open: number;
  close: number;
  high: number;
  low: number;
  up: boolean;
  /** Index of the source bar on which this brick formed. */
  source: number;
}

export type BoxSizing =
  | { mode: "fixed"; size: number }
  | { mode: "atr"; length: number }
  | { mode: "percent"; percent: number };

export const DEFAULT_RENKO: BoxSizing = { mode: "atr", length: 14 };

export function boxSize(
  bars: readonly OHLCV[],
  sizing: BoxSizing,
  atLength = bars.length,
): number {
  const last = bars[Math.max(0, atLength - 1)];
  if (!last) return 0;
  if (sizing.mode === "fixed") return Math.max(sizing.size, 1e-12);
  if (sizing.mode === "percent")
    return Math.max((last.close * sizing.percent) / 100, 1e-12);
  const range = atr(bars.slice(0, atLength), sizing.length);
  for (let i = range.length - 1; i >= 0; i--)
    if (Number.isFinite(range[i]) && range[i] > 0) return range[i];
  return Math.max((last.close * 0.01), 1e-12);
}

/** Renko bricks built from closes using a fixed box size. */
export function renko(bars: readonly OHLCV[], size: number): Brick[] {
  const out: Brick[] = [];
  if (!bars.length || !(size > 0)) return out;
  let base = Math.round(bars[0].close / size) * size;
  requirePriceStep(base, base + size);
  let direction = 0;
  const push = (open: number, close: number, source: number) => {
    requireMarkCapacity(out.length + 1);
    requirePriceStep(open, close);
    out.push({
      open,
      close,
      high: Math.max(open, close),
      low: Math.min(open, close),
      up: close > open,
      source,
    });
  };
  for (let i = 1; i < bars.length; i++) {
    const close = bars[i].close;
    for (let moved = true; moved; ) {
      moved = true;
      if (direction >= 0 && close >= base + size) {
        push(base, base + size, i);
        base += size;
        direction = 1;
      } else if (direction <= 0 && close <= base - size) {
        push(base, base - size, i);
        base -= size;
        direction = -1;
      } else if (direction === 1 && close <= base - 2 * size) {
        // A reversal needs two boxes against the trend.
        push(base - size, base - 2 * size, i);
        base -= 2 * size;
        direction = -1;
      } else if (direction === -1 && close >= base + 2 * size) {
        push(base + size, base + 2 * size, i);
        base += 2 * size;
        direction = 1;
      } else moved = false;
    }
  }
  return out;
}
/** Three-line (or N-line) break chart built from closes. */
export function lineBreak(bars: readonly OHLCV[], lines = 3): Brick[] {
  const out: Brick[] = [];
  if (bars.length < 2) return out;
  for (let i = 1; i < bars.length; i++) {
    const close = bars[i].close;
    const last = out.at(-1);
    if (!last) {
      const previous = bars[i - 1].close;
      if (close === previous) continue;
      out.push({
        open: previous,
        close,
        high: Math.max(previous, close),
        low: Math.min(previous, close),
        up: close > previous,
        source: i,
      });
      continue;
    }
    const recent = out.slice(-lines);
    const high = Math.max(...recent.map((b) => Math.max(b.open, b.close)));
    const low = Math.min(...recent.map((b) => Math.min(b.open, b.close)));
    if (close > last.close && (last.up || close > high)) {
      const open = last.up ? last.close : last.open;
      out.push({ open, close, high: close, low: open, up: true, source: i });
    } else if (close < last.close && (!last.up || close < low)) {
      const open = last.up ? last.open : last.close;
      out.push({ open, close, high: open, low: close, up: false, source: i });
    }
  }
  return out;
}

/**
 * Range bars: every bar spans exactly `size`. Each source bar contributes the
 * conventional Oâ†’Hâ†’Lâ†’C (bullish) or Oâ†’Lâ†’Hâ†’C (bearish) path.
 */
export function rangeBars(bars: readonly OHLCV[], size: number): Brick[] {
  const out: Brick[] = [];
  if (!bars.length || !(size > 0)) return out;
  let open = bars[0].open;
  let high = open;
  let low = open;
  const push = (up: boolean, closePrice: number, source: number) => {
    requireMarkCapacity(out.length + 1);
    requirePriceStep(open, closePrice);
    out.push({ open, close: closePrice, high, low, up, source });
    open = closePrice;
    high = closePrice;
    low = closePrice;
  };
  bars.forEach((bar, source) => {
    const path =
      bar.close >= bar.open
        ? [bar.open, bar.high, bar.low, bar.close]
        : [bar.open, bar.low, bar.high, bar.close];
    for (const price of path) {
      high = Math.max(high, price);
      low = Math.min(low, price);
      while (high - low >= size) {
        // Close the bar at whichever extreme was reached last.
        if (price >= (high + low) / 2) {
          const closePrice = low + size;
          high = closePrice;
          push(true, closePrice, source);
          low = closePrice;
          open = closePrice;
        } else {
          const closePrice = high - size;
          low = closePrice;
          push(false, closePrice, source);
          high = closePrice;
          open = closePrice;
        }
      }
    }
  });
  return out;
}

export interface KagiSegment {
  from: number;
  to: number;
  /** Thick "yang" line (price broke the previous high) versus thin "yin". */
  thick: boolean;
  up: boolean;
  source: number;
}

/** Kagi lines with a reversal threshold in price units. */
export function kagi(bars: readonly OHLCV[], reversal: number): KagiSegment[] {
  const out: KagiSegment[] = [];
  if (bars.length < 2 || !(reversal > 0)) return out;
  let start = bars[0].close;
  let end = start;
  let up = true;
  let started = false;
  let thick = true;
  let priorHigh = start;
  let priorLow = start;
  for (let i = 1; i < bars.length; i++) {
    const close = bars[i].close;
    if (!started) {
      if (Math.abs(close - start) < reversal) continue;
      up = close > start;
      end = close;
      started = true;
      continue;
    }
    if (up) {
      if (close > end) end = close;
      else if (end - close >= reversal) {
        out.push({ from: start, to: end, thick, up: true, source: i });
        priorHigh = Math.max(priorHigh, end);
        start = end;
        end = close;
        up = false;
        if (close < priorLow) thick = false;
      }
      if (close > priorHigh && !thick) thick = true;
    } else {
      if (close < end) end = close;
      else if (close - end >= reversal) {
        out.push({ from: start, to: end, thick, up: false, source: i });
        priorLow = Math.min(priorLow, end);
        start = end;
        end = close;
        up = true;
        if (close > priorHigh) thick = true;
      }
      if (close < priorLow && thick) thick = false;
    }
  }
  if (started) out.push({ from: start, to: end, thick, up, source: bars.length - 1 });
  return out;
}

export interface PointFigureColumn {
  up: boolean;
  /** Box prices, bottom to top, each being the box's lower edge. */
  boxes: number[];
  source: number;
}

/** Point & Figure columns of X (up) and O (down) boxes. */
export function pointFigure(
  bars: readonly OHLCV[],
  box: number,
  reversal = 3,
): PointFigureColumn[] {
  const out: PointFigureColumn[] = [];
  if (!bars.length || !(box > 0)) return out;
  const floorBox = (price: number) => Math.floor(price / box + 1e-9) * box;
  let top = floorBox(bars[0].close);
  requirePriceStep(top, top + box);
  let bottom = top;
  let direction = 0;
  const rounded = (v: number) => Math.round(v * 1e10) / 1e10;
  let totalBoxes = 0;
  const emit = (up: boolean, from: number, to: number, source: number) => {
    const boxes: number[] = [];
    const start = Math.min(from, to), units = (Math.max(from, to) - start) / box;
    const count = Math.floor(units + Math.max(1, Math.abs(units)) * Number.EPSILON * 8) + 1;
    requireMarkCapacity(totalBoxes + count);
    for (let index = 0; index < count; index++) {
      const price = rounded(start + index * box);
      if (index) requirePriceStep(boxes[index - 1], price);
      boxes.push(price);
    }
    totalBoxes += count;
    out.push({ up, boxes, source });
  };
  let columnStart = top;
  for (let i = 1; i < bars.length; i++) {
    const high = floorBox(bars[i].high);
    const low = floorBox(bars[i].low);
    if (direction === 0) {
      if (high - columnStart >= box) {
        direction = 1;
        top = high;
        bottom = columnStart;
      } else if (columnStart - low >= box) {
        direction = -1;
        bottom = low;
        top = columnStart;
      }
      continue;
    }
    if (direction === 1) {
      if (high > top) top = high;
      else if (top - low >= reversal * box) {
        emit(true, bottom, top, i);
        direction = -1;
        const columnTop = top - box;
        bottom = low;
        top = columnTop;
      }
    } else {
      if (low < bottom) bottom = low;
      else if (high - bottom >= reversal * box) {
        emit(false, bottom, top, i);
        direction = 1;
        const columnBottom = bottom + box;
        top = high;
        bottom = columnBottom;
      }
    }
  }
  if (direction !== 0) emit(direction === 1, bottom, top, bars.length - 1);
  return out;
}

/**
 * Give every mark a distinct x slot. A mark prefers the slot of the source bar
 * on which it formed; when several marks formed on one bar they take the next
 * free slots to the right. If that runs past the last bar the whole set shifts
 * left so the newest mark sits on the newest bar.
 */
export function assignSlots(sources: readonly number[], lastIndex: number): number[] {
  const slots: number[] = [];
  let previous = -1;
  for (const source of sources) {
    const slot = Math.max(source, previous + 1);
    slots.push(slot);
    previous = slot;
  }
  const overflow = (slots.at(-1) ?? 0) - lastIndex;
  return overflow > 0 ? slots.map((s) => s - overflow) : slots;
}

