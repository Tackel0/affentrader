export type FibonacciType = "fibretracement" | "fibextension" | "fibextensiontrend";
export interface FibonacciPoint { time: number; price: number }
export const isFibonacciType = (type: string): type is FibonacciType => ["fibretracement", "fibextension", "fibextensiontrend"].includes(type);

/** Work in log-price space, retaining exact endpoints and rejecting unrepresentable prices. */
function geometricLevel(origin: number, from: number, to: number, ratio: number): number {
  if (![origin, from, to, ratio].every(Number.isFinite) || Math.min(origin, from, to) <= 0) return NaN;
  if (ratio === 0 || from === to) return origin;
  if (origin === from && ratio === 1) return to;
  const relative = (to - from) / from;
  const change = Math.abs(relative) < 0.5 ? Math.log1p(relative) : Math.log(to) - Math.log(from);
  const value = Math.exp(Math.log(origin) + ratio * change);
  return Number.isFinite(value) && value > 0 ? value : NaN;
}

/** The renderer and alert evaluator call this same construction, independent of screen coordinates. */
export function fibonacciPrice(type: FibonacciType, anchors: readonly FibonacciPoint[], ratio: number, reverse: boolean, logarithmic: boolean): number {
  const [a, b, c] = anchors;
  if (!a || !b || !Number.isFinite(ratio)) return NaN;
  if (type === "fibextensiontrend") {
    if (!c) return NaN;
    const direction = reverse ? -ratio : ratio;
    return logarithmic ? geometricLevel(c.price, a.price, b.price, direction) : c.price + direction * (b.price - a.price);
  }
  const from = type === "fibretracement" && !reverse ? b.price : a.price;
  const to = type === "fibretracement" && !reverse ? a.price : b.price;
  return logarithmic ? geometricLevel(from, from, to, ratio) : from + ratio * (to - from);
}
