import type { OHLCV } from "@/types/trading";

export interface BarChange {
  difference: number;
  percent: number | null;
  previousClose: number;
  previousTime: number;
  close: number;
}

/** Resolve an exact selected bucket, never a later or nearest substitute. Session gaps are valid. */
export function barChange(bars: readonly Pick<OHLCV, "time" | "close">[], selected: Pick<OHLCV, "time" | "close"> | null | undefined, revealedThrough = Infinity): BarChange | null {
  if (!selected || !Number.isFinite(selected.time) || !Number.isFinite(selected.close) || Number.isNaN(revealedThrough) || selected.time > revealedThrough) return null;
  let left = 0, right = bars.length - 1;
  while (left <= right) {
    const middle = (left + right) >>> 1;
    if (bars[middle].time < selected.time) left = middle + 1;
    else if (bars[middle].time > selected.time) right = middle - 1;
    else {
      const previous = bars[middle - 1];
      if (!previous || !Number.isFinite(previous.time) || previous.time >= selected.time || !Number.isFinite(previous.close)) return null;
      const difference = selected.close - previous.close;
      if (!Number.isFinite(difference)) return null;
      const percent = previous.close === 0 ? null : difference / previous.close * 100;
      return { difference, percent: percent !== null && Number.isFinite(percent) ? percent : null,
        previousClose: previous.close, previousTime: previous.time, close: selected.close };
    }
  }
  return null;
}

/** Round the absolute change with the selected price's precision, not the delta's magnitude. */
export function formatBarChange(change: BarChange): string {
  const magnitude = Math.abs(change.close);
  const decimals = magnitude >= 100 ? 2 : magnitude >= 1 ? 4 : magnitude < 0.001 ? 8 : 5;
  const signed = (value: number, places: number) => {
    const rounded = Number(value.toFixed(places));
    return `${rounded < 0 ? "−" : rounded > 0 ? "+" : ""}${Math.abs(rounded).toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places })}`;
  };
  return `${signed(change.difference, decimals)} (${change.percent === null ? "—" : `${signed(change.percent, 2)}%`})`;
}
