import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "@/types/trading";
import { nextBucket } from "@/lib/market/intervals";
import { firstObservedPriceTouches, type PriceTouchBar } from "./referenceTouches";
import { footprintValueArea } from "./footprintValueArea";
import { footprintBarGeometry, type FootprintPlacement, type ResolvedFootprintPreferences } from "./footprint";
import { footprintPocColor } from "./footprintStructure";

export interface FootprintPocReference { time: number; lower: number; upper: number; price: number; from: number; touched: number | null }
/** Re-evaluate repaired historical ranges and backwards Replay seeks. A missing
 * candle cannot establish a revisit; same-bar contact never ends a projection. */
export function createFootprintPocCache() {
  let key = "", previous: FootprintPocReference[] = [];
  return { read(footprints: readonly FootprintBar[], input: readonly PriceTouchBar[], timeframe: string, step: number, average = false, through?: number): FootprintPocReference[] {
    const bars = through === undefined ? input : input.filter(bar => nextBucket(timeframe, bar.time) <= through);
    const times = new Set(bars.map(bar => bar.time));
    const refs = footprints.filter(bar => times.has(bar.time)).flatMap(bar => {
      // Like the reference, projections use unfiltered source rows; the local
      // outline/VA may use a different POC after display filters are applied.
      const area = footprintValueArea(bar, step, 1, average, true);
      return area ? [{ time: bar.time, lower: area.pocLow, upper: area.pocHigh, price: area.pocMid, from: nextBucket(timeframe, bar.time), touched: null as number | null }] : [];
    });
    const next = JSON.stringify([timeframe, step, average, through, refs, bars.map(bar => [bar.time, bar.low, bar.high])]);
    if (next === key) return previous;
    const touches = firstObservedPriceTouches(bars, refs);
    previous = refs.map((ref, index) => ({ ...ref, touched: touches[index] })); key = next; return previous;
  } };
}
export function paintFootprintPocExtensions(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, refs: readonly FootprintPocReference[], style: ResolvedFootprintPreferences, placement?: FootprintPlacement) {
  // The native overlay branch requires at least two loaded candles before it
  // enables POC projections, even when a lone origin is already observed.
  if (!style.pocVisible || !style.pocExtend || args.bars.length < 2) return;
  ctx.save(); ctx.globalAlpha = .62 * (placement?.opacity ?? 1); ctx.strokeStyle = footprintPocColor(style.pocColor, args.theme.background ?? "#131722"); ctx.lineWidth = style.pocWidth;
  for (const ref of refs) {
    const { width, center, half } = footprintBarGeometry(args, ref.time, placement);
    if (!(width > 0) || (placement?.opacity ?? 1) <= .01) continue;
    const from = Math.max(0, center + half);
    const to = ref.touched === null ? args.coords.width : Math.min(args.coords.width, args.coords.timeToX(ref.touched));
    const y = args.coords.priceToY(ref.price, args.scale, args.bounds);
    if (from >= to || y < args.bounds.top || y > args.bounds.top + args.bounds.height) continue;
    ctx.beginPath(); ctx.moveTo(from, y); ctx.lineTo(to, y); ctx.stroke();
  }
  ctx.restore();
}
