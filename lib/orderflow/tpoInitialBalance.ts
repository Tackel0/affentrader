import { canonicalDecimal } from "./priceGrid";
export interface TpoInitialBalance {
  start: number; end: number; high: number | null; low: number | null; range: number | null;
  loadedBars: number; expectedBars: number; missingSlots: number;
  status: "unavailable" | "incomplete" | "developing" | "complete";
}
/** Legacy block-count entry point retained for old callers. */
export function tpoInitialBalance(bars: readonly { time: number; high: number; low: number }[], start: number, sessionEnd: number,
  blockMs: number, blocks: number, duration: number, revealedUntil: number): TpoInitialBalance {
  if (!Number.isFinite(blockMs) || blockMs <= 0 || !Number.isInteger(blocks) || blocks < 1 || blocks > 48)
    throw new Error("Invalid initial balance time range or block count.");
  return openingRange(bars, start, sessionEnd, blockMs * blocks, duration, revealedUntil);
}
export function tpoInitialBalanceMinutes(bars: readonly { time: number; high: number; low: number }[], start: number, sessionEnd: number,
  minutes: number, duration: number, revealedUntil: number): TpoInitialBalance {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 11520) throw new Error("Invalid initial balance minutes.");
  return openingRange(bars, start, sessionEnd, minutes * 60000, duration, revealedUntil);
}
/** Only revealed whole candles inside the opening window contribute; never slice OHLC extremes across its boundary. */
function openingRange(bars: readonly { time: number; high: number; low: number }[], start: number, sessionEnd: number,
  rangeMs: number, duration: number, revealedUntil: number): TpoInitialBalance {
  if (![start, sessionEnd, rangeMs, duration, revealedUntil].every(Number.isFinite) || sessionEnd <= start || rangeMs <= 0 || duration <= 0)
    throw new Error("Invalid initial balance time range.");
  const end = Math.min(sessionEnd, start + rangeMs), expectedBars = Math.ceil((end - start) / duration);
  const times = new Set<number>(); let high = -Infinity, low = Infinity;
  for (const bar of bars) if (bar.time >= start && bar.time <= revealedUntil && bar.time < end && bar.time + duration <= end) {
    if (![bar.time, bar.high, bar.low].every(Number.isFinite) || bar.low > bar.high || (bar.time - start) % duration !== 0)
      throw new Error("Invalid or unaligned initial balance candle.");
    times.add(bar.time); high = Math.max(high, bar.high); low = Math.min(low, bar.low);
  }
  const due = Math.min(expectedBars, Math.max(0, Math.floor((revealedUntil - start) / duration) + 1));
  const missingSlots = Math.max(0, due - times.size);
  let range: number | null = null;
  if (times.size) {
    const h = canonicalDecimal(high), l = canonicalDecimal(low), exponent = Math.min(h.exponent, l.exponent);
    range = Number(`${h.coefficient * 10n ** BigInt(h.exponent - exponent) - l.coefficient * 10n ** BigInt(l.exponent - exponent)}e${exponent}`);
    if (!Number.isFinite(range)) throw new Error("Initial balance range exceeds supported precision.");
  }
  return { start, end, high: times.size ? high : null, low: times.size ? low : null, range, loadedBars: times.size, expectedBars, missingSlots,
    status: !times.size ? "unavailable" : missingSlots || (end - start) % duration !== 0 ? "incomplete" : revealedUntil < end ? "developing" : "complete" };
}
