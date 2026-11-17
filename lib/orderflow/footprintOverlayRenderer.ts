import type { RendererLayerArgs } from "@luxalgo/vela";
import { footprintPlacements, footprintStep, footprintTextPlan, paintFootprintBar, type FootprintInstance } from "./footprint";
import { footprintDisplayBar } from "./footprintCells";
import type { FootprintOverlayChannel } from "./footprintOverlay";
import { createFootprintPocCache, paintFootprintPocExtensions } from "./footprintPoc";
import { createFootprintStackedZoneCache, paintFootprintStackedZones } from "./footprintStackedZones";
import { createUnfinishedAuctionCache, paintUnfinishedAuctions } from "./unfinishedAuctions";
import { visibleFootprintTimes, visibleFootprintPlacement, paintVisibleFootprint, type VisibleFootprintFrame } from "./visibleFootprint";
import { paintFootprintHover, type FootprintHoverView } from "./footprintHover";
import type { FootprintMagnifierSurface } from "./footprintMagnifierSurface";
import { nextBucket } from "@/lib/market/intervals";
import { createFootprintReveal, footprintRawSpacing } from "./footprintReveal";
import type { FootprintBar } from "@/types/trading";
import type { ResolvedFootprintPreferences } from "./footprint";

export function createFootprintOverlayCache() {
  return {
    reveal: createFootprintReveal(),
    poc: createFootprintPocCache(),
    stacks: createFootprintStackedZoneCache(),
    unfinished: createUnfinishedAuctionCache(),
    display: undefined as { key: string; raw: readonly FootprintBar[]; bars: FootprintBar[]; styleKey: string; step: number; through?: number } | undefined,
  };
}
function displayStyleKey(style: ResolvedFootprintPreferences) {
  return JSON.stringify([
    style.imbalanceRatio, style.imbalanceMinVolume, style.ignoreZeroOpposite, style.averageTradeSize,
    style.minVolume, style.maxVolume, style.minBidVolume, style.maxBidVolume, style.minAskVolume, style.maxAskVolume,
  ]);
}
export function paintFootprintOverlay(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, channel: FootprintOverlayChannel, cache: ReturnType<typeof createFootprintOverlayCache>, magnify = false, surface?: FootprintMagnifierSurface) {
  const { history, style, identity } = channel; if (!history || !style || !identity) { cache.reveal.reset(); return; }
  const through = identity.live ? undefined : identity.through;
  if (through === null) { cache.reveal.reset(); return; }
  if (!(style.rowSize > 0) && !channel.priceTick) { cache.reveal.reset(); return; }
  const step = footprintStep(args, style, args.bars.at(-1)?.close ?? 1, channel.priceTick), ownArgs = { ...args, priceStyle: "footprint" };
  let range: VisibleFootprintFrame | undefined;
  if (channel.kind === "visible") {
    const times = visibleFootprintTimes(args, identity.timeframe, through);
    const raw = history.readVisible({ step, ratio: style.imbalanceRatio, minimumVolume: style.imbalanceMinVolume, ignoreZeroOpposite: style.ignoreZeroOpposite }, times);
    const bar = raw ? footprintDisplayBar(raw, step, style) : null;
    range = { bar, first: times[0], last: times.at(-1), candles: times.length, observedCandles: history.visibleCoverage(times).observedCandles, step, style,
      ...(bar ? { placement: visibleFootprintPlacement(args, bar.time, channel.widthPercent, channel.alignment) } : {}) };
    paintVisibleFootprint(ctx, args, range);
    if (bar && range.placement) paintFootprintHover(ctx, ownArgs, [{ id: "vr", label: "Visible Range Footprint", bars: [bar], step, style, placement: range.placement }], magnify,
      through === undefined ? undefined : { timeframe: identity.timeframe, through }, surface);
    return { bars: bar ? [bar] : [], step, style, range, stacks: undefined, unfinished: undefined, poc: undefined };
  }
  const rawBars = history.read({ step, ratio: style.imbalanceRatio, minimumVolume: style.imbalanceMinVolume, ignoreZeroOpposite: style.ignoreZeroOpposite });
  const styleKey = displayStyleKey(style);
  const frameKey = `${identity.symbol}:${identity.timeframe}:${identity.revision}:${through ?? ""}:${step}:${styleKey}`;
  let bars: FootprintBar[];
  if (cache.display && cache.display.key === frameKey && cache.display.raw === rawBars) {
    bars = cache.display.bars;
  } else {
    bars = rawBars
      .filter(bar => through === undefined || nextBucket(identity.timeframe, bar.time) <= through)
      .map(bar => footprintDisplayBar(bar, step, style));
    cache.display = { key: frameKey, raw: rawBars, bars, styleKey, step, through };
  }
  const opacity = cache.reveal.update(args.nowMs, footprintRawSpacing(args), bars.some(bar => bar.levels.length > 0), JSON.stringify([identity.symbol, identity.timeframe, identity.live, identity.revision]), through);
  const instance: FootprintInstance = { id: "fp1", label: "Footprint", style }, placement = footprintPlacements(args, [instance], opacity).get("fp1")!;
  const candles = new Map(args.bars.map(bar => [bar.time, bar]));
  const drawable = bars.filter(bar => candles.has(bar.time)), textPlan = footprintTextPlan(ctx, args, drawable, step, style, placement);
  for (const bar of drawable) paintFootprintBar(ctx, args, bar, candles.get(bar.time), step, style, placement, undefined, undefined, textPlan);
  const stacks = style.stackedVisible ? cache.stacks.read(bars, args.bars, identity.timeframe, step, style.stackedRows, through) : undefined;
  const unfinished = style.unfinishedVisible ? cache.unfinished.read(bars, args.bars, identity.timeframe, step, style.unfinishedMinVolume, through) : undefined;
  const poc = style.pocVisible && style.pocExtend ? cache.poc.read(bars, args.bars, identity.timeframe, step, style.averageTradeSize, through) : undefined;
  if (stacks) paintFootprintStackedZones(ctx, args, stacks, style, placement);
  if (unfinished) paintUnfinishedAuctions(ctx, args, unfinished, style, placement);
  if (poc) paintFootprintPocExtensions(ctx, args, poc, style, placement);
  const views: FootprintHoverView[] = [{ id: "fp1", label: "Footprint", bars, step, style, placement }];
  paintFootprintHover(ctx, ownArgs, views, magnify, through === undefined ? undefined : { timeframe: identity.timeframe, through }, surface);
  return { bars, step, style, stacks, unfinished, poc, range: undefined };
}
