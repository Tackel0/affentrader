import type { DepthLevel } from "@/types/trading";
import { canonicalDecimal } from "./priceGrid";

export function depthMetrics(book: { bids: readonly DepthLevel[]; asks: readonly DepthLevel[] }, requestedLevels: number) {
  const levels = Math.min(requestedLevels, book.bids.length, book.asks.length);
  if (levels < 1) return null;

  const bid = book.bids[0].price;
  const ask = book.asks[0].price;
  const bidDecimal = canonicalDecimal(bid);
  const askDecimal = canonicalDecimal(ask);
  const exponent = Math.min(bidDecimal.exponent, askDecimal.exponent);
  const difference = askDecimal.coefficient * 10n ** BigInt(askDecimal.exponent - exponent)
    - bidDecimal.coefficient * 10n ** BigInt(bidDecimal.exponent - exponent);
  const spread = Number(`${difference}e${exponent}`);
  const midpoint = bid + spread / 2;

  const bids = book.bids.slice(0, levels);
  const asks = book.asks.slice(0, levels);
  const scale = Math.max(...[...bids, ...asks].map(level => level.quantity));
  const bidWeight = bids.reduce((sum, level) => sum + level.quantity / scale, 0);
  const askWeight = asks.reduce((sum, level) => sum + level.quantity / scale, 0);
  return { levels, spread, midpoint, spreadBps: spread / midpoint * 10000, bidShare: bidWeight / (bidWeight + askWeight) };
}
