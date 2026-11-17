import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "@/types/trading";
import { nextBucket } from "@/lib/market/intervals";
import { FootprintHistory } from "./footprintHistory";
import { footprintStep, paintFootprintBar, resolveVisibleFootprint, type FootprintPlacement, type ResolvedFootprintPreferences } from "./footprint";
import { footprintDisplayBar } from "./footprintCells";
export interface VisibleFootprintFrame { bar: FootprintBar | null; first?: number; last?: number; candles: number; observedCandles: number; step: number; style: ResolvedFootprintPreferences; placement?: FootprintPlacement }
/** Include partially visible edge candle slots, consistently with the existing
 * visible profile. Replay still admits only completed selected candles. */
export function visibleFootprintTimes(args: RendererLayerArgs, timeframe: string, through?: number): number[] {
  if (through !== undefined && !Number.isFinite(through)) return [];
  const range = args.coords.visibleLogicalRange();
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from > range.to) return [];
  const first = Math.max(0, Math.floor(range.from)), last = Math.min(args.bars.length - 1, Math.ceil(range.to));
  if (first > last) return [];
  return args.bars.slice(first, last + 1)
    .filter(bar => through === undefined || nextBucket(timeframe, bar.time) <= through).map(bar => bar.time);
}
export function visibleFootprintPlacement(args: RendererLayerArgs, time: number, widthPercent: number, alignment: "left" | "right" = "right"): FootprintPlacement | undefined {
  if (args.coords.width < 50) return;
  const width = Math.min(args.coords.width - 16, Math.max(42, args.coords.width * widthPercent / 100));
  const center = alignment === "left" ? 8 + width / 2 : args.coords.width - 8 - width / 2;
  return { width, offset: center - args.coords.timeToX(time), within: false };
}
export function readVisibleFootprint(history: FootprintHistory, args: RendererLayerArgs, timeframe: string, through?: number, priceTick?: number): VisibleFootprintFrame | undefined {
  const { enabled, style, widthPercent } = resolveVisibleFootprint(args.settings);
  if (!enabled) { history.clearVisible(); return; }
  if (!(style.rowSize > 0) && !(priceTick && priceTick > 0)) { history.clearVisible(); return; }
  const times = visibleFootprintTimes(args, timeframe, through);
  const step = footprintStep(args, style, args.bars.at(-1)?.close ?? 1, priceTick);
  const raw = history.readVisible({ step, ratio: style.imbalanceRatio, minimumVolume: style.imbalanceMinVolume, ignoreZeroOpposite: style.ignoreZeroOpposite }, times);
  const bar = raw ? footprintDisplayBar(raw, step, style) : null;
  return { bar, first: times[0], last: times.at(-1), candles: times.length,
    observedCandles: history.visibleCoverage(times).observedCandles, step, style,
    ...(bar ? { placement: visibleFootprintPlacement(args, bar.time, widthPercent) } : {}) };
}
export function paintVisibleFootprint(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, frame: VisibleFootprintFrame | undefined) {
  if (!frame?.bar || !frame.placement) return;
  ctx.save(); try {
    ctx.globalAlpha = 1;
    paintFootprintBar(ctx, args, frame.bar, undefined, frame.step, frame.style, frame.placement);
    const center = args.coords.timeToX(frame.bar.time) + frame.placement.offset;
    ctx.fillStyle = args.theme.textColor; ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("Visible range · partial executions", center, args.bounds.top + 6, frame.placement.width);
  } finally { ctx.restore(); }
}
