import { canonicalDecimal } from "./priceGrid";

const fail = () => new Error("Profile price rows cannot be distinguished. Reduce Rows or change the range.");
const ten = (n: number) => 10n ** BigInt(n);
const floor = (a: bigint, b: bigint) => a / b - (a < 0n && a % b ? 1n : 0n);
/** Decimal projection only. Assignment and overlap fractions use the exact rational
 * grid, even when an equal-width row boundary has no finite decimal expansion. */
function projected(numerator: bigint, denominator: bigint, exponent: number) {
  return Number(`${numerator * ten(25) / denominator}e${exponent - 25}`);
}
function fraction(numerator: bigint, denominator: bigint) {
  const a = Number(numerator), b = Number(denominator);
  return Number.isFinite(a) && Number.isFinite(b) ? a / b : projected(numerator, denominator, 0);
}
export function rangePriceGrid(min: number, max: number, count: number) {
  if (![min, max].every(Number.isFinite) || !(max > min) || !Number.isInteger(count) || count < 1 || count > 500) throw fail();
  const a = canonicalDecimal(min), b = canonicalDecimal(max), exponent = Math.min(a.exponent, b.exponent), n = BigInt(count);
  const lower = a.coefficient * ten(a.exponent - exponent), upper = b.coefficient * ten(b.exponent - exponent), span = upper - lower;
  const edges = Array.from({ length: count + 1 }, (_, index) => index === 0 ? min : index === count ? max : projected(lower * n + span * BigInt(index), n, exponent));
  if (edges.some((edge, index) => !Number.isFinite(edge) || index > 0 && edge <= edges[index - 1])) throw fail();
  const centers = Array.from({ length: count }, (_, index) => projected(lower * 2n * n + span * BigInt(index * 2 + 1), 2n * n, exponent));
  const clamp = (index: bigint) => Number(index < 0n ? 0n : index >= n ? n - 1n : index);
  const allocation = (low: number, high: number) => {
    if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) throw fail();
    const l = canonicalDecimal(low), h = canonicalDecimal(high), unit = Math.min(exponent, l.exponent, h.exponent);
    // Exact integer fast path. Only use Number arithmetic when every operand and
    // product is a safe integer; correct the rounded quotient against exact products.
    // Canonical sub-boundary decimals that exceed this representation use BigInt below.
    const scaleN = 10 ** (exponent - unit), bottomN = Number(lower) * scaleN, rangeN = Number(span) * scaleN;
    const lowN = Number(l.coefficient) * 10 ** (l.exponent - unit), highN = Number(h.coefficient) * 10 ** (h.exponent - unit);
    if ([bottomN, rangeN, lowN, highN, rangeN * count].every(Number.isSafeInteger) && lowN >= bottomN && highN - bottomN <= rangeN) {
      const exactFloor = (value: number) => {
        let q = Math.floor(value / rangeN);
        if (q * rangeN > value) q--;
        else if ((q + 1) * rangeN <= value) q++;
        return q;
      };
      const firstValue = (lowN - bottomN) * count, first = Math.min(count - 1, Math.max(0, exactFloor(firstValue)));
      if (lowN === highN) return { first, last: first, firstFraction: 1, fullFraction: 0 };
      const value = (highN - bottomN) * count, quotient = exactFloor(value);
      const last = Math.max(first, Math.min(count - 1, quotient + (quotient * rangeN < value ? 1 : 0) - 1));
      const denominator = (highN - lowN) * count;
      return { first, last, firstFraction: Math.max(0, Math.min(1, (rangeN * (first + 1) - firstValue) / denominator)), fullFraction: rangeN / denominator };
    }
    const scale = ten(exponent - unit), bottom = lower * scale, range = span * scale;
    const lo = l.coefficient * ten(l.exponent - unit), hi = h.coefficient * ten(h.exponent - unit);
    const first = clamp(floor((lo - bottom) * n, range));
    if (lo === hi) return { first, last: first, firstFraction: 1, fullFraction: 0 };
    const position = (hi - bottom) * n;
    const last = Math.max(first, clamp(-floor(-position, range) - 1n));
    const denominator = (hi - lo) * n;
    return { first, last, firstFraction: Math.max(0, Math.min(1, fraction(bottom * n + range * BigInt(first + 1) - lo * n, denominator))),
      fullFraction: fraction(range, denominator) };
  };
  return { edges, centers, allocation };
}
