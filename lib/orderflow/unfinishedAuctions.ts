import type { FootprintBar } from "@/types/trading";
import type { RendererLayerArgs } from "@luxalgo/vela";
import { nextBucket } from "@/lib/market/intervals";
import { executionPriceGrid } from "./priceGrid";
import { firstObservedPriceTouches, type PriceTouchBar } from "./referenceTouches";
import { footprintBarGeometry, type FootprintPlacement, type ResolvedFootprintPreferences } from "./footprint";
import { footprintNumber } from "./footprintFormat";

export interface UnfinishedAuction { time: number; side: "high" | "low"; lower: number; upper: number; price: number; buy: number; sell: number; from: number; touched: number | null }
/** Flags use raw quantities on merged rows, including display-filtered extrema.
 * The reference excludes quantities whose compact label rounds to zero. */
export function unfinishedAuctionRows(bar: FootprintBar, step: number, minimum: number): Omit<UnfinishedAuction, "from" | "touched">[] {
  if (!bar.levels.length) return [];
  let low = bar.levels[0], high = low;
  for (const row of bar.levels) { if (row.price < low.price) low = row; if (row.price > high.price) high = row; }
  const grid = executionPriceGrid(step), qualifies = (value: number) => value > 0 && parseFloat(footprintNumber(value)) !== 0 && value >= minimum;
  // High first matters when both outlines cover the same single observed row.
  return ([ ["high", high], ["low", low] ] as const).flatMap(([side, row]) => {
    if (!(qualifies(row.buyVolume) && qualifies(row.sellVolume))) return [];
    const upper = row.upperPrice ?? grid.row(grid.index(row.price)).upper;
    return [{ time: bar.time, side, lower: row.price, upper, price: side === "high" ? upper : row.price, buy: row.buyVolume, sell: row.sellVolume }];
  });
}
export function createUnfinishedAuctionCache() {
  let key = "", previous: UnfinishedAuction[] = [];
  return { read(footprints: readonly FootprintBar[], input: readonly PriceTouchBar[], timeframe: string, step: number, minimum: number, through?: number): UnfinishedAuction[] {
    const bars = through === undefined ? input : input.filter(bar => nextBucket(timeframe, bar.time) <= through);
    const times = new Set(bars.map(bar => bar.time));
    const refs = footprints.filter(bar => times.has(bar.time)).flatMap(bar => unfinishedAuctionRows(bar, step, minimum))
      .map(row => ({ ...row, from: nextBucket(timeframe, row.time), touched: null as number | null }));
    const next = JSON.stringify([timeframe, step, minimum, through, refs, bars.map(b => [b.time, b.low, b.high])]);
    if (next === key) return previous;
    const touches = firstObservedPriceTouches(bars, refs);
    previous = refs.map((ref, index) => ({ ...ref, touched: touches[index] })); key = next; return previous;
  } };
}
export function paintUnfinishedAuctions(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, auctions: readonly UnfinishedAuction[], style: ResolvedFootprintPreferences, placement?: FootprintPlacement) {
  if (!style.unfinishedVisible) return;
  ctx.save(); ctx.lineWidth = style.unfinishedWidth; ctx.globalAlpha = placement?.opacity ?? 1;
  for (const auction of auctions) {
    const { width, center, half } = footprintBarGeometry(args, auction.time, placement); if (!(width > 0) || (placement?.opacity ?? 1) <= .01) continue;
    const left = center - half, right = center + half, a = args.coords.priceToY(auction.lower, args.scale, args.bounds), b = args.coords.priceToY(auction.upper, args.scale, args.bounds);
    const top = Math.min(a, b), height = Math.max(1, Math.abs(a - b) - 1), inset = style.unfinishedWidth / 2;
    if (left > args.coords.width) continue;
    ctx.strokeStyle = auction.side === "high" ? style.unfinishedHighColor : style.unfinishedLowColor;
    if (right - left > style.unfinishedWidth && height > style.unfinishedWidth && top <= args.bounds.top + args.bounds.height && top + height >= args.bounds.top)
      ctx.strokeRect(left + inset, top + inset, right - left - style.unfinishedWidth, height - style.unfinishedWidth);
    if (!style.unfinishedExtend || right >= args.coords.width) continue;
    const end = auction.touched === null ? args.coords.width : Math.min(args.coords.width, args.coords.timeToX(auction.touched));
    const from = Math.max(0, right), y = args.coords.priceToY(auction.price, args.scale, args.bounds);
    if (end <= from || y < args.bounds.top || y > args.bounds.top + args.bounds.height) continue;
    ctx.beginPath(); ctx.moveTo(from, y); ctx.lineTo(end, y); ctx.stroke();
  }
  ctx.restore();
}
