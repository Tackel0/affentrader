import type { FootprintBar, FootprintDeltaPath } from "@/types/trading";
import { validFootprintDeltaPath } from "./footprintDelta";
import type { UnfinishedAuction } from "./unfinishedAuctions";
import { footprintStatistics } from "./footprintStatistics";
import { footprintModeTitle } from "./footprintModes";
import { footprintValueArea } from "./footprintValueArea";
import type { FootprintPocReference } from "./footprintPoc";
import { footprintFiltersActive } from "./footprintFilters";
import type { FootprintStackedZone } from "./footprintStackedZones";
import type { VisibleFootprintFrame } from "./visibleFootprint";
import { createFootprintInspection, footprintInspectionStats, validInspectionSettings, type FootprintInspectionSettings, type FootprintInspectionTarget } from "./footprintInspection";

export interface FootprintSurface { overlayTitle?: string; symbol: string; timeframe: string; epoch: number; bars: readonly FootprintBar[]; simulated: boolean; dropped: number; sourceLabel?: string; replayThrough?: number; sourceStamp?: string; analysis?: FootprintInspectionSettings; deltaPaths?: ReadonlyMap<number, FootprintDeltaPath>; unfinished?: readonly UnfinishedAuction[]; pocReferences?: readonly FootprintPocReference[]; stackedZones?: readonly FootprintStackedZone[]; visibleRange?: VisibleFootprintFrame }
export interface FootprintReadout { status: "ready" | "empty" | "replay" | "unavailable"; message: string;
  rows: Array<{ label: string; value: string }>; inspectionTarget?: FootprintInspectionTarget }
const surfaces = new Map<string, { token: symbol; surface: FootprintSurface }>();
const listeners = new Set<() => void>();
const notified = new Map<string, FootprintSurface>();
let notifyQueued = false;
function scheduleSurfaceNotify() {
  if (!listeners.size || notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    if (!listeners.size) return;
    let changed = notified.size !== surfaces.size;
    if (!changed) {
      for (const [key, entry] of surfaces) {
        if (notified.get(key) !== entry.surface) { changed = true; break; }
      }
    }
    if (!changed) return;
    notified.clear();
    for (const [key, entry] of surfaces) notified.set(key, entry.surface);
    for (const listener of [...listeners]) { try { listener(); } catch { /* Subscriber failure must not break surface updates. */ } }
  });
}
export function subscribeFootprintSurfaces(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    notified.clear();
    for (const [key, entry] of surfaces) notified.set(key, entry.surface);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) notified.clear();
  };
}
export function publishFootprintSurface(cell: string, token: symbol, surface: FootprintSurface) {
  surfaces.set(cell, { token, surface });
  scheduleSurfaceNotify();
}
export function clearFootprintSurface(cell: string, token: symbol) {
  if (surfaces.get(cell)?.token === token) {
    surfaces.delete(cell);
    scheduleSurfaceNotify();
  }
}
export function readFootprintOverlaySurfaces(cell: string, context: Parameters<typeof readFootprintSurface>[1], time: number | undefined, ids: readonly string[]) {
  return [...new Set(ids)].flatMap(id => {
    const key = `${cell}:${id}`, surface = surfaces.get(key)?.surface; if (!surface?.overlayTitle) return [];
    const selected = surface.visibleRange?.bar?.time ?? time;
    return [{ id, title: surface.overlayTitle, ...readFootprintSurface(key, context, selected) }];
  });
}
const format = (value: number) => Number.isFinite(value) ? value.toLocaleString("en-US", { maximumSignificantDigits: 12 }) : "—";
/** The timestamp comes from the native selected bar, never from parsing a zoned display string. */
export function readFootprintSurface(cell: string, context: { symbol: string; timeframe: string; epoch: number; replay: boolean; replayThrough?: number | null; sourceStamp?: string }, time: number | undefined): FootprintReadout {
  const surface = surfaces.get(cell)?.surface;
  if (context.replay && (context.replayThrough == null || surface?.replayThrough !== context.replayThrough)) return { status: "replay", message: "Replay: waiting for loaded recorded executions at the current completed-bar boundary.", rows: [] };
  if (context.replay && time !== undefined && time >= context.replayThrough!) return { status: "replay", message: "This Replay candle is still forming. Classified executions appear only when the candle completes.", rows: [] };
  if (!surface || surface.symbol !== context.symbol || surface.timeframe !== context.timeframe || surface.epoch !== context.epoch || !Number.isFinite(time))
    return { status: "unavailable", message: "Waiting for the current Footprint collection.", rows: [] };
  if (!context.replay && surface.replayThrough !== undefined) return { status: "unavailable", message: "Waiting for the live Footprint collection.", rows: [] };
  if (surface.sourceStamp !== undefined && surface.sourceStamp !== context.sourceStamp) return { status: "unavailable", message: "Waiting for the Footprint collection of the current source and archive selection.", rows: [] };
  const bar = surface.bars.find(bar => bar.time === time);
  if (!bar) return { status: "empty", message: "No collected executions for this candle. Missing history is not zero volume.", rows: [] };
  const totals = footprintStatistics(bar), buys = totals.buy, sells = totals.sell;
  const poc = bar.levels.find(level => level.price === bar.poc), percent = totals.deltaPercent;
  const analysis = surface.analysis && validInspectionSettings(surface.analysis) ? surface.analysis : undefined;
  const deltaPath = surface.deltaPaths?.get(bar.time);
  const observedPath = deltaPath && validFootprintDeltaPath(deltaPath, bar.time, surface.replayThrough) ? deltaPath : undefined;
  const stats = analysis ? footprintInspectionStats(bar, analysis) : undefined;
  const area = analysis?.valueAreaPercent === undefined ? null : footprintValueArea(bar, analysis.step, analysis.valueAreaPercent, analysis.averageTradeSize);
  const pocReference = surface.pocReferences?.find(ref => ref.time === bar.time);
  const buyCount = totals.buyCount, sellCount = totals.sellCount;
  const inspectionTarget: FootprintInspectionTarget | undefined = analysis && surface.sourceStamp !== undefined ? { cell, symbol: surface.symbol, timeframe: surface.timeframe, epoch: surface.epoch, time: bar.time,
    replay: context.replay, ...(surface.replayThrough !== undefined ? { replayThrough: surface.replayThrough } : {}), sourceStamp: surface.sourceStamp, ...(analysis.instance ? { instance: analysis.instance } : {}) } : undefined;
  return { status: "ready", message: `${surface.simulated ? "SIMULATED · " : ""}Partial collected executions${surface.dropped ? " · older candles evicted" : ""}. These quantities can differ from full candle volume.${surface.sourceLabel ? ` ${surface.sourceLabel}.` : ""}`, rows: [
    ...(surface.visibleRange ? [
      { label: "Visible range source", value: `${surface.visibleRange.observedCandles}/${surface.visibleRange.candles} selected candles with collected executions; missing history remains unknown.` },
      { label: "Visible range window UTC", value: surface.visibleRange.first === undefined ? "No selected candles" : `${new Date(surface.visibleRange.first).toISOString()} – ${new Date(surface.visibleRange.last!).toISOString()}` },
      { label: "Visible range total / delta", value: surface.visibleRange.bar ? `${format(surface.visibleRange.bar.volume)} / ${format(surface.visibleRange.bar.delta)}` : "No collected executions" },
      { label: "Visible range sizing", value: `${surface.visibleRange.style.averageTradeSize ? "Aggregate side volume / aggregate known trade counts" : "Raw classified volume"}; independent grid ${surface.visibleRange.step}.` },
    ] : []),
    ...(analysis?.instance ? [{ label: "Inspected footprint", value: `Footprint ${analysis.instance.slice(2)}` }] : []),
    { label: "Ask volume (buys)", value: format(buys) }, { label: "Bid volume (sells)", value: format(sells) },
    { label: "Collected volume", value: format(bar.volume) }, { label: "Delta (Ask − Bid)", value: format(bar.delta) },
    { label: "Delta %", value: percent === null ? "—" : `${format(percent)}%` },
    { label: "Buy %", value: totals.buyPercent === null ? "—" : `${format(totals.buyPercent)}%` }, { label: "Sell %", value: totals.sellPercent === null ? "—" : `${format(totals.sellPercent)}%` },
    { label: "Underlying trade count", value: totals.tradeCount === null ? "—" : String(totals.tradeCount) },
    { label: "Ask trade count", value: buyCount === null ? "—" : String(buyCount) }, { label: "Bid trade count", value: sellCount === null ? "—" : String(sellCount) },
    { label: "Trade count basis", value: "Explicit underlying print counts only; an unknown execution count makes its side total unavailable" },
    ...(analysis ? [{ label: "Footprint shape basis", value: analysis.averageTradeSize ? "Average per-side trade size; unknown sides omitted. POC and diagonals use these sizes; numeric volume labels remain raw." : "Raw classified per-side volume" },
      { label: "Footprint display mode", value: footprintModeTitle(analysis.volumeMode ?? "bid-ask") },
      { label: "Footprint cell values", value: analysis.cellValues ?? "auto" }] : []),
    ...(observedPath ? [
      { label: "Observed maximum delta", value: format(observedPath.high) }, { label: "Observed minimum delta", value: format(observedPath.low) },
      { label: "Ordered execution delta", value: format(observedPath.close) }, { label: "Observed executions", value: String(observedPath.executions) },
    ] : []),
    { label: "POC row [lower, upper)", value: poc && poc.upperPrice !== undefined ? `[${poc.price}, ${poc.upperPrice})` : "—" },
    ...(analysis && (footprintFiltersActive(analysis) || bar.levels.some(row => row.filtered !== undefined)) ? [
      { label: "Displayed / filtered price rows", value: `${bar.levels.filter(row => !row.filtered).length} / ${bar.levels.filter(row => row.filtered).length}` },
      { label: "Display filter basis", value: `${analysis.averageTradeSize ? "Known per-side average trade sizes" : "Raw per-side volume"}. Zero bounds are off; slots stay fixed. Stats and projected references use unfiltered data.` },
      { label: "Volume min / max", value: `${analysis.minVolume ?? 0} / ${analysis.maxVolume ?? 0}` },
      { label: "Bid min / max", value: `${analysis.minBidVolume ?? 0} / ${analysis.maxBidVolume ?? 0}` },
      { label: "Ask min / max", value: `${analysis.minAskVolume ?? 0} / ${analysis.maxAskVolume ?? 0}` },
    ] : []),
    ...(area ? [{ label: `Value area ${area.percent}% [lower, upper)`, value: `[${area.low}, ${area.high})` },
      { label: "Value area basis", value: `${area.basis === "volume" ? "Classified volume" : "Known per-side average trade sizes"}; expands from POC; equal neighbors prefer higher price. Missing executions remain unknown.` },
      { label: "POC midpoint", value: String(area.pocMid) }] : []),
    ...(pocReference ? [{ label: "Projected POC midpoint", value: String(pocReference.price) },
      { label: "POC first observed revisit", value: pocReference.touched === null ? "None in revealed candles" : new Date(pocReference.touched).toISOString() },
      { label: "POC revisit basis", value: "Unfiltered source rows; later inclusive candle ranges at the midpoint. A gap over the level does not prove a touch. Missing history remains unknown." }] : []),
    { label: "Price rows", value: format(bar.levels.length) },
    ...(surface.stackedZones ? [
      { label: "Stacked-zone revisit basis", value: "First later revealed candle whose inclusive range overlaps the complete zone. Displayed rows, filters and sizing basis determine stacks; missing history remains unknown." },
      ...surface.stackedZones.filter(zone=>zone.time===bar.time).map((zone,index)=>({label:`Projected ${zone.side} stack ${index+1}`,value:`[${zone.lower}, ${zone.upper}] · ${zone.rows} rows · ${zone.touched===null?"No observed revisit":new Date(zone.touched).toISOString()}`})),
    ] : []),
    ...(surface.unfinished ? [
      { label: "Unfinished auction basis", value: "Both sides positive on observed outer display rows; high uses upper edge, low lower edge. Later inclusive candle ranges determine observed revisits; gaps remain unknown." },
      ...surface.unfinished.filter(auction => auction.time === bar.time).flatMap(auction => [
        { label: `Unfinished ${auction.side} price`, value: String(auction.price) },
        { label: `Unfinished ${auction.side} first observed revisit`, value: auction.touched === null ? "None in revealed candles" : new Date(auction.touched).toISOString() },
      ]),
    ] : []),
    ...(stats && analysis ? [
      { label: "Price row size", value: String(analysis.step) }, { label: "Diagonal imbalance ratio", value: `${analysis.ratio}:1` },
      { label: "Minimum imbalance volume", value: format(analysis.minimumVolume) }, { label: "Zero / missing opposite", value: analysis.ignoreZeroOpposite ? "Excluded from imbalance" : "Eligible when own volume passes minimum" },
      { label: "Buy imbalance rows", value: format(stats.buyRows) }, { label: "Sell imbalance rows", value: format(stats.sellRows) },
      { label: "Minimum adjacent stack rows", value: format(analysis.minimumStackRows) }, { label: "Buy stacks", value: format(stats.buyStacks) }, { label: "Sell stacks", value: format(stats.sellStacks) },
    ] : []),
  ], ...(inspectionTarget ? { inspectionTarget } : {}) };
}
export function captureFootprintInspection(target: FootprintInspectionTarget, currentSourceStamp: string, capturedAt = Date.now()) {
  const surface = surfaces.get(target.cell)?.surface;
  if (!surface || surface.symbol !== target.symbol || surface.timeframe !== target.timeframe || surface.epoch !== target.epoch || surface.sourceStamp !== target.sourceStamp || target.sourceStamp !== currentSourceStamp ||
    (target.replay ? target.replayThrough === undefined || surface.replayThrough !== target.replayThrough || target.time >= target.replayThrough : surface.replayThrough !== undefined) || !surface.analysis || surface.analysis.instance !== target.instance) return null;
  const bar = surface.bars.find(bar => bar.time === target.time); if (!bar) return null;
  return createFootprintInspection(bar, surface.analysis, { symbol: surface.symbol, timeframe: surface.timeframe, simulated: surface.simulated, deltaPath: surface.deltaPaths?.get(bar.time),
    pocReference: surface.pocReferences?.find(ref => ref.time === bar.time),
    stackedZones: surface.stackedZones?.filter(zone=>zone.time===bar.time),
    ...(surface.replayThrough !== undefined ? { replayThrough: surface.replayThrough } : {}), coverage: `Partial collected executions; missing history remains unknown.${surface.dropped ? " Older candles evicted." : ""}${surface.sourceLabel ? ` ${surface.sourceLabel}` : ""}` }, capturedAt);
}
