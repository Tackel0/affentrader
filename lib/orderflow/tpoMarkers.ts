import { canonicalDecimal } from "./priceGrid";
export interface TpoMarkerPrice { price: number | null; time: number | null; status: "observed" | "missing" | "invalid" }
export interface TpoMarkers { open: TpoMarkerPrice; close: TpoMarkerPrice; midpoint: number; high: number; low: number }
type Bar = { time: number; high: number; low: number; open?: number; close?: number };
/** Exact canonical decimal midpoint; avoids overflow and cancellation in (high + low) / 2. */
export function tpoMidpoint(low: number, high: number): number {
  if (low > high) throw new RangeError("Invalid TPO range.");
  const a = canonicalDecimal(low), b = canonicalDecimal(high), e = Math.min(a.exponent, b.exponent);
  return Number(`${(a.coefficient * 10n ** BigInt(a.exponent - e) + b.coefficient * 10n ** BigInt(b.exponent - e)) * 5n}e${e - 1}`);
}
export function tpoMarkers(source: readonly Bar[], sessionStart: number, low: number, high: number): TpoMarkers {
  const first = source[0], last = source.at(-1);
  const point = (bar: Bar | undefined, key: "open" | "close", missing: boolean): TpoMarkerPrice => {
    if (!bar || missing || bar[key] === undefined) return { price: null, time: null, status: "missing" };
    const price = bar[key]!;
    return Number.isFinite(price) && price >= bar.low && price <= bar.high ? { price, time: bar.time, status: "observed" }
      : { price: null, time: bar.time, status: "invalid" };
  };
  return { open: point(first, "open", first?.time !== sessionStart), close: point(last, "close", false), midpoint: tpoMidpoint(low, high), low, high };
}
