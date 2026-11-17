import { DerivedTransformError } from "@/lib/chart/transformCapacity";

export class ExecutionPriceGridError extends DerivedTransformError {
  constructor() {
    super("precision"); this.name = "ExecutionPriceGridError";
    this.message = "This row size exceeds the supported price precision. Increase the price row size or use Auto.";
  }
}
interface Decimal { readonly coefficient: bigint; readonly exponent: number }
const decimalCache = new Map<number, Decimal>();
export interface ExecutionPriceRow { index: number; lower: number; upper: number; center: number }

/** Venue prices arrive as decimal JSON numbers. Preserve their canonical decimal
 * spelling: adding an epsilon to a binary quotient moves genuine below-boundary
 * executions into the next row. No binary division or fixed decimal rounding is
 * used to assign rows. BigInt is internal; public results remain JSON-safe. */
export function canonicalDecimal(value: number): Decimal {
  if (!Number.isFinite(value)) throw new ExecutionPriceGridError();
  const cached = decimalCache.get(value); if (cached) return cached;
  const [mantissa, exponent = "0"] = value.toString().split("e"), point = mantissa.indexOf(".");
  const result = Object.freeze({ coefficient: BigInt(mantissa.replace(".", "")), exponent: Number(exponent) - (point < 0 ? 0 : mantissa.length - point - 1) });
  if (decimalCache.size >= 16384) decimalCache.delete(decimalCache.keys().next().value!);
  decimalCache.set(value, result); return result;
}
const power = (exponent: number) => 10n ** BigInt(exponent);

export function executionPriceGrid(step: number) {
  if (!Number.isFinite(step) || step <= 0) throw new ExecutionPriceGridError();
  const unit = canonicalDecimal(step), indices = new Map<number, number>(), rows = new Map<number, ExecutionPriceRow>();
  const boundary = (index: number) => Number(`${BigInt(index) * unit.coefficient}e${unit.exponent}`);
  const row = (index: number): ExecutionPriceRow => {
    const cached = rows.get(index); if (cached) return cached;
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(index - 1) || !Number.isSafeInteger(index + 1)) throw new ExecutionPriceGridError();
    const lower = boundary(index), upper = boundary(index + 1), previous = boundary(index - 1);
    if (![lower, upper, previous].every(Number.isFinite) || !(previous < lower && lower < upper)) throw new ExecutionPriceGridError();
    const center = Number(`${(2n * BigInt(index) + 1n) * unit.coefficient * 5n}e${unit.exponent - 1}`);
    const result = { index, lower, upper, center }; rows.set(index, result); return result;
  };
  const index = (price: number): number => {
    const cached = indices.get(price); if (cached !== undefined) return cached;
    if (!Number.isFinite(price)) throw new ExecutionPriceGridError();
    const value = canonicalDecimal(price), exponent = value.exponent - unit.exponent;
    const numerator = value.coefficient * (exponent >= 0 ? power(exponent) : 1n);
    const denominator = unit.coefficient * (exponent < 0 ? power(-exponent) : 1n);
    let quotient = numerator / denominator;
    if (numerator < 0n && numerator % denominator !== 0n) quotient--;
    const result = Number(quotient);
    if (!Number.isSafeInteger(result) || BigInt(result) !== quotient) throw new ExecutionPriceGridError();
    row(result); indices.set(price, result); return result;
  };
  return { index, row };
}
