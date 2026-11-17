import { canonicalDecimal } from "./priceGrid";
import type { TpoInitialBalance } from "./tpoInitialBalance";

export interface TpoIbExtension {
  status: "ready" | "unavailable" | "incomplete" | "developing" | "unsupported";
  upper: number | null;
  lower: number | null;
}

/** Range expansion beyond each IB extreme. Only a fully revealed IB can define fixed levels. */
export function tpoIbExtension(ib: TpoInitialBalance, percent: number): TpoIbExtension {
  if (!Number.isInteger(percent) || percent < 1 || percent > 500) throw new RangeError("IB extension must be an integer from 1 to 500 percent.");
  const absent = { upper: null, lower: null };
  if (ib.status !== "complete") return { status: ib.status, ...absent };
  if (ib.high === null || ib.low === null || ![ib.high, ib.low].every(Number.isFinite) || ib.high < ib.low)
    return { status: "unsupported", ...absent };
  const high = canonicalDecimal(ib.high), low = canonicalDecimal(ib.low), exponent = Math.min(high.exponent, low.exponent);
  const h = high.coefficient * 10n ** BigInt(high.exponent - exponent), l = low.coefficient * 10n ** BigInt(low.exponent - exponent);
  const offset = (h - l) * BigInt(percent);
  const upper = Number(`${h * 100n + offset}e${exponent - 2}`), lower = Number(`${l * 100n - offset}e${exponent - 2}`);
  if (![upper, lower].every(Number.isFinite) || h > l && (upper <= ib.high || lower >= ib.low))
    return { status: "unsupported", ...absent };
  return { status: "ready", upper, lower };
}
