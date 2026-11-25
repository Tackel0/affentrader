"use client";
import {
  registerChartType,
  registerRendererLayer,
  registerNativeIndicator,
  type RendererLayerArgs,
  type NativeIndicatorContext,
} from "@luxalgo/vela";
import { useChartStore } from "@/stores/useChartStore";
import { useAlertStore } from "@/stores/useAlertStore";
import { FootprintHistory } from "./footprintHistory";
import { createFootprintBackfill } from "./footprintBackfill";
import { publishFootprintSurface, clearFootprintSurface } from "./footprintReadout";
import { footprintHoverModifier, paintFootprintHover } from "./footprintHover";
import { createFootprintMagnifierSurface } from "./footprintMagnifierSurface";
import { publishFootprintMenuFrame, clearFootprintMenuFrame } from "./footprintMenu";
import { readVisibleFootprint, paintVisibleFootprint } from "./visibleFootprint";
import { FOOTPRINT_OVERLAY_IDS, FOOTPRINT_OVERLAY_TITLES, footprintOverlayDescriptor, type FootprintOverlayChannel } from "./footprintOverlay";
import { createFootprintOverlayCache, paintFootprintOverlay } from "./footprintOverlayRenderer";
import { createFootprintReveal, footprintBodyModulation, footprintRawSpacing } from "./footprintReveal";
import { createFootprintGridSource, footprintGridNotice } from "./footprintGrid";
import { requestCellFrame, type CellContext } from "@/lib/chart/cellContext";
import { marketService, stripVenue } from "@/lib/market/service";
import { providerOf } from "@/lib/symbolId";
import { canvasLayer, invalidateCanvasLayers } from "@/lib/chart/canvasLayer";
import { registerChartStyles } from "@/lib/chart/styles";
import { registerOverlayLayer } from "@/lib/chart/overlayLayer";
import {registerChartOrderLines} from "@/lib/trading/chartOrderLines";
import { registerDerivedIndicator } from "@/lib/indicators/derived";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { footprintPalette } from "./layout";
import { footprintModeLabel, footprintSettings, footprintStep, footprintTextPlan, paintFootprintBar, paintFootprintInstanceCandles, footprintPlacements, resolveFootprintInstances, resolveVisibleFootprint } from "./footprint";
import { createFootprintPocCache, paintFootprintPocExtensions } from "./footprintPoc";
import { createFootprintStackedZoneCache, paintFootprintStackedZones } from "./footprintStackedZones";
import { createUnfinishedAuctionCache, paintUnfinishedAuctions } from "./unfinishedAuctions";
import { footprintDisplayBar } from "./footprintCells";
import { isTickInterval } from "@/lib/market/intervals";
import { createTpoCache } from "./tpoModel";
import { TpoCandleSource } from "./tpoCandleSource";
import { TpoExecutionSource } from "./tpoExecutionSource";
import { resolveTpo, tpoSettings } from "./tpoSettings";
import { clearTpoRenderCache, paintTpoSessions } from "./tpoRenderer";
import { TPO_OVERLAY_ID, tpoOverlayDescriptor, resolveTpoOverlay, paintTpoOverlay, type TpoOverlayChannel } from "./tpoOverlay";
import { publishTpoMenuFrame, clearTpoMenuFrame } from "./tpoSessionMenu";
import { createTpoTouchCache } from "./tpoReferenceTouches";
import { publishTpoSurface, clearTpoSurface } from "./tpoReadout";
import { clearDerivedIssue, runDerivedPaint } from "@/lib/chart/derivedRenderState";
import { sessionProfileDescriptor } from "./volumeProfileIndicator";
import { paintVolumeProfiles, type VolumeProfileChannel } from "./volumeProfileRenderer";
import { publishSessionProfileSurface, clearSessionProfileSurface } from "./sessionProfileReadout";
import { sessionProfileJobs } from "./sessionProfileJobs";
import { auditPaint } from "@/lib/chart/paintAudit";
import { cvdDescriptor } from "./cvdIndicator";
import { registerFixedProfileConstruction } from "@/lib/drawings/fixedProfilePlugin";
import { registerAnchoredVwapConstruction } from "@/lib/drawings/anchoredVwapPlugin";
import { vwapBandsDescriptor } from "./vwapBandsIndicator";
import { footprintUpdates } from "./footprintUpdates";
import { VisibleProfileCache, visibleProfileDescriptor } from "./visibleProfile";
import { paintVisibleProfile } from "./visibleProfileRenderer";
import { studyTradeSource } from "./studyTradeSource";
import { nativeReplayBoundary } from "@/lib/chart/replayClock";
import { contextForCanvas } from "@/lib/chart/cellContext";
import { clearExecutionRangeWatch, rangeProfileSourceStamp, watchExecutionRange } from "./executionRangeSource";
import { clearVisibleProfileSurface, publishVisibleProfileSurface } from "./visibleProfileReadout";
import { depthHeatmapDescriptor, type DepthHeatmapChannel } from "./depthHeatmapIndicator";
import { clearDepthSurface, depthSourceKey, publishDepthSurface } from "./depthHeatmapReadout";
import { registerOrderflowSignalPlugins } from "./signalLayers";
import { paintDepthHeatmap } from "./depthHeatmapRenderer";
import { bubblesDescriptor, type BubblesChannel } from "./volumeBubblesIndicator";
import { paintVolumeBubbles } from "./volumeBubblesRenderer";
import { tradeCountDescriptor } from "./tradeCountIndicator";
import { countIds, countTitles } from "./tradeCount";
import { barStatsDescriptor, type BarStatsChannel } from "./barStatsIndicator";
import { paintBarStats } from "./barStatsRenderer";
import { tailsDescriptor, type TailsChannel } from "./volumeTailsIndicator";
import { loadPriceGridMetadata } from "@/lib/market/priceGridMetadata";
import { tailsIds, tailsTitles } from "./volumeTails";
import { paintVolumeTails, TailsRenderCache } from "./volumeTailsRenderer";
import { registerFixedTails } from "@/lib/drawings/fixedTailsPlugin";
import { rollingProfileDescriptor } from "./rollingProfileIndicator";
import { clearStudyNotice, currentStudyNotices, routeStudyNotice, STUDY_NOTICE_LAYER_ID } from "@/lib/chart/studyNotices";
import { registerLiquidationHeatmap } from "./liquidationHeatmapStudy";
const studyTrades = (symbol: string) => studyTradeSource.read(stripVenue(symbol), marketService.tradesFor(symbol));
function footprintBackfillSymbol(cell: CellContext) {
  const state = useChartStore.getState();
  return !cell.replay && !isTickInterval(cell.timeframe) && state.feedMode !== "simulation" &&
    state.dataSources[`${cell.symbol}:${cell.timeframe}`] === "exchange" ? stripVenue(cell.symbol) : "";
}
const replayTrades = (symbol: string, timeframe: string, through: number | null) => {
  const state = useChartStore.getState();
  return state.feedMode !== "simulation" && state.dataSources[`${symbol}:${timeframe}`] === "exchange" ? studyTradeSource.replay(stripVenue(symbol), through) : undefined;
};
const archiveOptions = {
  revision: (symbol: string) => JSON.stringify([studyTradeSource.revision(stripVenue(symbol)), useChartStore.getState().marketEpochs[symbol] ?? 0]),
  subscribe: (symbol: string, changed: () => void) => studyTradeSource.subscribe(stripVenue(symbol), changed),
  label: (symbol: string) => studyTradeSource.label(stripVenue(symbol), marketService.tradesFor(symbol)),
  replay: (context: NativeIndicatorContext) => replayTrades(context.symbol, context.timeframe, nativeReplayBoundary(context)),
};
const tpoExecutionDependencies = { trades: studyTrades, replay: replayTrades, revision: archiveOptions.revision, subscribe: archiveOptions.subscribe,
  ticks: (receive: (tick: import("@/types/trading").Tick) => void) => marketService.onTick(tick => { studyTradeSource.observe(tick); receive(tick); }) };
function depthSource(symbol: string, timeframe: string) {
  const state = useChartStore.getState(), provider = providerOf(symbol), supported = provider === "binance" || provider === "hyperliquid" || provider === "kraken" || provider === "bybit";
  return { key: depthSourceKey(state.marketEpochs[symbol] ?? 0, state.feedMode, state.dataSources[`${symbol}:${timeframe}`]),
    enabled: supported && !isTickInterval(timeframe) && state.feedMode !== "simulation" && state.dataSources[`${symbol}:${timeframe}`] === "exchange",
    reason: !supported ? "This source supplies no level-2 depth. IEX/Yahoo candles cannot create an order book." : isTickInterval(timeframe) ? "Depth heatmap requires a time-based chart interval." : "Waiting for live exchange depth; simulated data supplies no order book." };
}
let registered = false;
const projections = new Map<string, RendererLayerArgs>();
export function priceAtPoint(y: number, cellId = "primary"): number | null {
  const projection = projections.get(cellId);
  if (!projection) return null;
  const { coords, bounds, scale } = projection;
  if (y < bounds.top || y > bounds.top + bounds.height) return null;
  return coords.yToPrice(y, scale, bounds);
}
function createStudyNoticeLayer(title: string, paint: (ctx: CanvasRenderingContext2D, args: RendererLayerArgs, message: string) => void) {
  const owner = {};
  let message = "";
  const layer = canvasLayer((ctx, args) => paint(ctx, args, message), (args, cell) => {
    message = (args.data as { message?: string } | null | undefined)?.message ?? "";
    if (!message) {
      clearStudyNotice(owner);
      return false;
    }
    return !routeStudyNotice(owner, cell, title, message);
  });
  return { ...layer, destroy() { clearStudyNotice(owner); layer.destroy(); } };
}

export function registerOrderflowPlugins() {
  if (registered) return;
  registered = true;
  registerLiquidationHeatmap();
  for (const kind of ["bar", "visible"] as const) {
    registerNativeIndicator(footprintOverlayDescriptor(kind, studyTrades, (symbol, receive) => marketService.onTick(tick => {
      if (tick.symbol === stripVenue(symbol)) { studyTradeSource.observe(tick); receive(tick); }
    }), archiveOptions, loadPriceGridMetadata));
    registerRendererLayer({ id: FOOTPRINT_OVERLAY_IDS[kind], placement: "above-data", repaintOnCursor: true, create: () => {
      const token = Symbol("footprint-overlay");
      let cache = createFootprintOverlayCache();
      let key: string | undefined, cellId: string | undefined, channel: FootprintOverlayChannel | undefined, modulates = false;
      let canvas: HTMLCanvasElement | undefined;
      const backfill = createFootprintBackfill(() => { if (canvas) requestCellFrame(canvas); });
      let cachedSurface: { key: string; surface: import("./footprintReadout").FootprintSurface } | undefined;
      const magnifier = createFootprintMagnifierSurface();
      const hover = footprintHoverModifier(() => { magnifier.release(); if (cellId) invalidateCanvasLayers(cellId, FOOTPRINT_OVERLAY_IDS[kind]); });
      const deactivate = () => {
        backfill.clear(); magnifier.release(); hover.destroy(); modulates = false;
        if (key) { clearFootprintSurface(key, token); key = undefined; }
        if (channel) { channel.repaint = undefined; clearStudyNotice(channel); channel = undefined; }
        cache = createFootprintOverlayCache(); cachedSurface = undefined;
      };
      const layer = canvasLayer((ctx, args, cell) => {
        magnifier.clear(); modulates = false; cellId = cell.id; if (key) clearFootprintSurface(key, token);
        const next = args.data as FootprintOverlayChannel | undefined;
        if (channel !== next) {
          if (channel) deactivate();
          channel = next;
          if (channel && canvas) hover.mount(canvas);
        }
        if (!channel) return;
        channel.repaint = () => invalidateCanvasLayers(cell.id, FOOTPRINT_OVERLAY_IDS[kind]);
        const identity = channel.identity;
        if (!identity || identity.symbol !== cell.symbol || identity.timeframe !== cell.timeframe || identity.live !== !cell.replay || identity.revision !== archiveOptions.revision(cell.symbol) || cell.replay && identity.through !== (cell.replayThrough ?? null)) { backfill.clear(); clearStudyNotice(channel); cache.reveal.reset(); cachedSurface = undefined; return; }
        key = `${cell.id}:${channel.id}`;
        let message = channel.message;
        try {
          const historyNotice = backfill.read(footprintBackfillSymbol(cell), channel.history, args);
          if (historyNotice) message += ` ${historyNotice}`;
          const result = paintFootprintOverlay(ctx, args, channel, cache, hover.shift, magnifier), state = useChartStore.getState();
          if (result && channel.history) {
            modulates = kind === "bar";
            const style = result.style, coverage = channel.history.coverage;
            const epoch = state.marketEpochs[cell.symbol] ?? 0, sourceStamp = rangeProfileSourceStamp(cell.symbol, cell.timeframe);
            const surfaceKey = JSON.stringify([key, epoch, sourceStamp, identity.revision, identity.through ?? null, coverage.trades, coverage.dropped, coverage.simulated, result.step, message, result.bars.length, result.bars.at(-1)?.delta, result.bars.at(-1)?.volume, Boolean(result.range?.bar), result.unfinished?.length ?? 0, result.poc?.length ?? 0, result.stacks?.length ?? 0, result.style]);
            if (cachedSurface?.key !== surfaceKey || cachedSurface.surface.bars !== result.bars || cachedSurface.surface.visibleRange !== result.range) {
              cachedSurface = {
                key: surfaceKey,
                surface: { overlayTitle: FOOTPRINT_OVERLAY_TITLES[kind], symbol: cell.symbol, timeframe: cell.timeframe, epoch,
                  sourceStamp, bars: result.bars, simulated: coverage.simulated, dropped: coverage.dropped,
                  sourceLabel: `${FOOTPRINT_OVERLAY_TITLES[kind]} · ${message}`, visibleRange: result.range,
                  ...(identity.live ? {} : { replayThrough: identity.through! }),
                  ...(kind === "bar" ? { deltaPaths: new Map(result.bars.map(bar => [bar.time, channel!.history!.readDelta(bar.time)!])), unfinished: result.unfinished, pocReferences: result.poc, stackedZones: result.stacks,
                    analysis: { step: result.step, ratio: style.imbalanceRatio, minimumVolume: style.imbalanceMinVolume, ignoreZeroOpposite: style.ignoreZeroOpposite, minimumStackRows: style.stackedRows,
                      averageTradeSize: style.averageTradeSize, cellValues: style.cellValues, volumeMode: style.volumeMode, volumeSplit: style.volumeSplit, instance: "fp1", valueAreaPercent: style.valueAreaPercent, valueAreaVisible: style.valueAreaVisible, pocExtend: style.pocExtend,
                      minVolume: style.minVolume, maxVolume: style.maxVolume, minBidVolume: style.minBidVolume, maxBidVolume: style.maxBidVolume, minAskVolume: style.minAskVolume, maxAskVolume: style.maxAskVolume } } : {}) },
              };
            }
            publishFootprintSurface(key, token, cachedSurface.surface);
          }
        } catch (error) { cache.reveal.reset(); modulates = false; message = `${FOOTPRINT_OVERLAY_TITLES[kind]} unavailable: ${error instanceof Error ? error.message : "Invalid footprint data."}`; }
        if (!routeStudyNotice(channel, cell, FOOTPRINT_OVERLAY_TITLES[kind], message)) { ctx.fillStyle = args.theme.textColor; ctx.font = "10px sans-serif"; ctx.fillText(message, 8, args.bounds.top + 16, Math.max(10, args.coords.width - 16)); }
      }, (args) => {
        if (args.data) return true;
        if (channel) deactivate();
        return false;
      }, FOOTPRINT_OVERLAY_IDS[kind]);
      return { ...layer, animating: () => cache.reveal.animating,
        modulateBase: () => modulates && channel?.style ? footprintBodyModulation(cache.reveal.opacity, [channel.style.position]) : null,
        mount(element: HTMLCanvasElement) { canvas = element; layer.mount(element); magnifier.mount(element); }, destroy() { deactivate(); canvas = undefined; magnifier.destroy(); layer.destroy(); } };
    } });
  }
  registerFixedProfileConstruction();
  registerFixedTails();
  registerAnchoredVwapConstruction();
  registerNativeIndicator(vwapBandsDescriptor());
  registerChartStyles();
  registerOverlayLayer();
  registerChartOrderLines();
  for (const kind of ["visible", "rolling", "session"] as const) {
    registerRendererLayer({ id: tailsIds[kind], repaintOnCursor: true, create: () => {
      const owner = {}, cache = new TailsRenderCache(); let channel: TailsChannel | undefined;
      const layer = canvasLayer((ctx, args, cell) => {
        const next = args.data as TailsChannel | undefined;
        if (channel && next !== channel) channel.repaint = undefined;
        channel = next;
        if (!channel) { clearStudyNotice(owner); return; }
        channel.repaint = () => invalidateCanvasLayers(cell.id);
        const identity = channel.identity;
        if (!identity || identity.symbol !== cell.symbol || identity.timeframe !== cell.timeframe || identity.live !== !cell.replay
          || identity.revision !== archiveOptions.revision(cell.symbol) || cell.replay && identity.through !== (cell.replayThrough ?? null)) { clearStudyNotice(owner); return; }
        let message = channel.message;
        try { message = paintVolumeTails(ctx, args, channel, kind, cache); }
        catch (error) { message = `Volume Tails unavailable: ${error instanceof Error ? error.message : "Invalid range."}`; }
        if (!routeStudyNotice(owner, cell, tailsTitles[kind], message)) {
          ctx.globalAlpha = 1; ctx.fillStyle = args.theme.textColor; ctx.font = "10px sans-serif"; ctx.textAlign = "left";
          ctx.fillText(message, 8, args.bounds.top + args.bounds.height - 12, Math.max(10, args.coords.width - 16));
        }
      }, (args) => {
        if (args.data) return true;
        if (channel) { channel.repaint = undefined; channel = undefined; }
        clearStudyNotice(owner);
        return false;
      });
      return { ...layer, destroy() { clearStudyNotice(owner); if (channel) channel.repaint = undefined; layer.destroy(); } };
    } });
    registerNativeIndicator(tailsDescriptor(kind, studyTrades, (symbol, changed) => marketService.onTick(tick => {
      if (tick.symbol === stripVenue(symbol)) { studyTradeSource.observe(tick); changed(tick); }
    }), archiveOptions));
  }
  registerRendererLayer({ id: "af-bar-stats", repaintOnCursor: true, create: () => {
    let channel: BarStatsChannel | undefined;
    const layer = canvasLayer((ctx, args, cell) => {
      const next = args.data as BarStatsChannel | undefined;
      if (channel && channel !== next) { channel.repaint = undefined; clearStudyNotice(channel); }
      channel = next;
      if (!channel) return;
      channel.repaint = () => invalidateCanvasLayers(cell.id);
      const identity = channel.identity;
      if (!identity || identity.symbol !== cell.symbol || identity.timeframe !== cell.timeframe || identity.live !== !cell.replay
        || identity.revision !== archiveOptions.revision(cell.symbol) || cell.replay && identity.through !== (cell.replayThrough ?? null)) {
        clearStudyNotice(channel); return;
      }
      let message = channel.message;
      try { paintBarStats(ctx, args, channel); }
      catch (error) { message = `Bar Stats unavailable: ${error instanceof Error ? error.message : "Invalid projection."}`; }
      if (!routeStudyNotice(channel, cell, "Bar Stats", message)) {
        ctx.globalAlpha = 1; ctx.fillStyle = args.theme.textColor; ctx.font = "10px sans-serif"; ctx.textAlign = "left";
        ctx.fillText(message, 8, args.bounds.top + args.bounds.height - 10, Math.max(10, args.coords.width - 16));
      }
    }, (args) => {
      if (args.data) return true;
      if (channel) { channel.repaint = undefined; clearStudyNotice(channel); channel = undefined; }
      return false;
    });
    return { ...layer, destroy() { if (channel) { channel.repaint = undefined; clearStudyNotice(channel); } channel = undefined; layer.destroy(); } };
  } });
  registerNativeIndicator(barStatsDescriptor(studyTrades, (symbol, changed) =>
    marketService.onTick(tick => { if (tick.symbol === stripVenue(symbol)) { studyTradeSource.observe(tick); changed(tick); } }), archiveOptions));
  for (const kind of ["total", "delta", "cumulative"] as const) {
    registerRendererLayer({
      id: countIds[kind],
      create: () => createStudyNoticeLayer(countTitles[kind], (ctx, args, message) => {
        ctx.globalAlpha = 1; ctx.fillStyle = args.theme.textColor; ctx.font = "10px sans-serif"; ctx.textAlign = "left";
        ctx.fillText(message, 8, args.bounds.top + 14, Math.max(10, args.coords.width - 16));
      }),
    });
    registerNativeIndicator(tradeCountDescriptor(kind, studyTrades, (symbol, changed) =>
      marketService.onTick(tick => { if (tick.symbol === stripVenue(symbol)) { studyTradeSource.observe(tick); changed(tick); } }), archiveOptions));
  }
  registerRendererLayer({ id: "af-volume-bubbles", placement: "above-data", repaintOnCursor: true, create: () => {
    let channel: BubblesChannel | undefined;
    const layer = canvasLayer((ctx, args, cell) => {
      const next = args.data as BubblesChannel | undefined;
      if (channel && channel !== next) { channel.repaint = undefined; clearStudyNotice(channel); }
      channel = next;
      if (!channel) return;
      channel.repaint = () => invalidateCanvasLayers(cell.id);
      const identity = channel.identity;
      if (!identity || identity.symbol !== cell.symbol || identity.timeframe !== cell.timeframe || identity.live !== !cell.replay
        || identity.revision !== archiveOptions.revision(cell.symbol) || cell.replay && identity.through !== (cell.replayThrough ?? null)) {
        clearStudyNotice(channel); return;
      }
      let message = channel.message;
      try { paintVolumeBubbles(ctx, args, channel); }
      catch (error) { message = `Volume Bubbles unavailable: ${error instanceof Error ? error.message : "Invalid price grid."}`; }
      if (!routeStudyNotice(channel, cell, "Volume Bubbles", message)) {
        ctx.globalAlpha = 1; ctx.fillStyle = args.theme.textColor; ctx.font = "10px sans-serif"; ctx.textAlign = "left";
        ctx.fillText(message, 8, args.bounds.top + args.bounds.height - 14, Math.max(10, args.coords.width - 16));
      }
    }, (args) => {
      if (args.data) return true;
      if (channel) { clearStudyNotice(channel); channel.repaint = undefined; channel = undefined; }
      return false;
    });
    return { ...layer, destroy() { if (channel) { clearStudyNotice(channel); channel.repaint = undefined; } channel = undefined; layer.destroy(); } };
  } });
  registerNativeIndicator(bubblesDescriptor(studyTrades, (symbol, changed) =>
    marketService.onTick(tick => { if (tick.symbol === stripVenue(symbol)) { studyTradeSource.observe(tick); changed(tick); } }), archiveOptions,
    async symbol => ({ ...await loadPriceGridMetadata(stripVenue(symbol)), symbol })));
  registerDerivedIndicator();
  registerNativeIndicator(visibleProfileDescriptor());
  registerRendererLayer({ id: STUDY_NOTICE_LAYER_ID, placement: "above-data", create: () => {
    let notices: ReturnType<typeof currentStudyNotices> = [];
    return canvasLayer((ctx, args) => {
      const unavailable = notices.some(notice => /unavailable|waiting|no observed|no recorded|collecting|candles only/i.test(notice.message));
      const label = unavailable ? "Data gaps / waiting" : "Partial / estimated data";
      const text = args.coords.width < 420 ? `${unavailable ? "Data gaps" : "Partial data"} · ${notices.length} sources` : `${label} · ${notices.length} sources · Data coverage details`;
      ctx.globalAlpha = 1; ctx.font = "10px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      const width = Math.max(10, args.coords.width - 60), y = args.bounds.top + args.bounds.height - 9;
      ctx.fillStyle = args.theme.background; ctx.fillRect(48, y - 11, width + 4, 15); ctx.fillStyle = args.theme.textColor; ctx.fillText(text, 52, y, width);
    }, (_args, cell) => {
      notices = currentStudyNotices(cell);
      return notices.length > 0;
    }, STUDY_NOTICE_LAYER_ID);
  } });
  registerNativeIndicator(depthHeatmapDescriptor(receive => marketService.onBook(receive), depthSource));
  registerRendererLayer({ id: "af-depth-heatmap", placement: "below-data", create: () => {
    let channel: DepthHeatmapChannel | undefined;
    let cellId: string | undefined;
    const layer = canvasLayer((ctx, args, cell) => {
      const next = args.data as DepthHeatmapChannel | undefined;
      if (channel && cellId) clearDepthSurface(cellId, channel);
      cellId = cell.id;
      if (channel && channel !== next) { channel.repaint = undefined; clearStudyNotice(channel); }
      channel = next;
      if (channel) { channel.repaint = () => invalidateCanvasLayers(cell.id);
        const identity = channel.identity;
        if (identity?.symbol === cell.symbol && identity.timeframe === cell.timeframe && identity.live === !cell.replay && identity.source === depthSource(cell.symbol, cell.timeframe).key &&
          (!cell.replay || identity.replayThrough === (cell.replayThrough ?? null)))
          paintDepthHeatmap(ctx, args, channel, message => routeStudyNotice(channel!, cell, "Liquidity heatmap", message),
            cells => publishDepthSurface(cell.id, { owner: channel!, identity, cells }));
        else clearStudyNotice(channel);
      }
    }, (args) => {
      if (args.data) return true;
      if (channel) {
        channel.repaint = undefined;
        clearStudyNotice(channel);
        if (cellId) clearDepthSurface(cellId, channel);
        channel = undefined;
      }
      return false;
    });
    return { ...layer, destroy() { if (channel) { channel.repaint = undefined; clearStudyNotice(channel); if (cellId) clearDepthSurface(cellId, channel); } channel = undefined; layer.destroy(); } };
  } });
  registerRendererLayer({ id: "af-visible-profile", placement: "above-data", create: () => {
    const cache = new VisibleProfileCache(); let canvas: HTMLCanvasElement | undefined;
    const token = Symbol("visible-profile"); let publishedCell: string | undefined;
    const clear = () => { clearStudyNotice(cache); if (publishedCell) clearVisibleProfileSurface(publishedCell, token); publishedCell = undefined; };
    const cell = () => canvas ? contextForCanvas(canvas) : undefined;
    const repaint = () => { const current = cell(); if (current) invalidateCanvasLayers(current.id); };
    const layer = canvasLayer((ctx, args) => {
      const current = cell(), data = args.data as { volumeSource?: string; __afProfileId?: string } | undefined;
      watchExecutionRange(cache, canvas, repaint, data?.volumeSource === "Classified executions");
      const snapshot = paintVisibleProfile(ctx, args, cache, cell, repaint, (title, message) => current ? routeStudyNotice(cache, current, title, message) : false);
      if (!snapshot || !current || !data?.__afProfileId) { clear(); return; }
      if (publishedCell && publishedCell !== current.id) clear();
      const range = args.coords.visibleLogicalRange(), from = Math.max(0, Math.ceil(range.from)), to = Math.min(args.coords.barCount - 1, Math.floor(range.to));
      publishVisibleProfileSurface(current.id, token, { ...snapshot, ...current, id: data.__afProfileId,
        epoch: useChartStore.getState().marketEpochs[current.symbol] ?? 0, sourceStamp: rangeProfileSourceStamp(current.symbol, current.timeframe),
        viewport: to >= from ? { from: args.coords.logicalToTime(from), to: args.coords.logicalToTime(to) } : null });
      publishedCell = current.id;
    }, (args) => {
      if (args.data) return true;
      clear();
      clearExecutionRangeWatch(cache);
      return false;
    });
    return { ...layer, mount(element) { canvas = element; layer.mount(element); }, destroy() { clear(); clearExecutionRangeWatch(cache); canvas = undefined; layer.destroy(); } };
  } });
  registerRendererLayer({
    id: "af-alerts",
    placement: "above-data",
    create: () => {
      let alerts: ReturnType<typeof useAlertStore.getState>["alerts"] = [];
      let cellId: string | undefined;
      const layer = canvasLayer((ctx, args) => {
        const { coords, scale, bounds } = args;
        for (const alert of alerts)
          for (const price of [
            alert.price,
            ...(alert.upperPrice ? [alert.upperPrice] : []),
          ]) {
            const y = coords.priceToY(price, scale, bounds);
            ctx.strokeStyle = "#f7b955";
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(coords.width, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = "#f7b955";
            ctx.font = "10px sans-serif";
            ctx.fillText(`◉ ${alert.name}`, 12, y - 6);
          }
      }, (args, cell) => {
        cellId = cell.id;
        projections.set(cell.id, args);
        auditPaint(args, cell.id, cell.replay);
        const candidates = useAlertStore.getState().alerts;
        if (!candidates.length) return false;
        alerts = candidates.filter(alert => alert.symbol === cell.symbol && alert.status === "active");
        return alerts.length > 0;
      });
      return {
        ...layer,
        destroy() {
          if (cellId !== undefined) projections.delete(cellId);
          cellId = undefined;
          layer.destroy();
        },
      };
    },
  });
  registerChartType({
    id: "footprint",
    label: "Footprint",
    basePainting: "none",
    settings: footprintSettings(),
  });
  registerRendererLayer({
    id: "footprint",
    // Above the candles: the default layer sits below the data and the candle bodies hid every cell.
    placement: "above-data",
    repaintOnCursor: true,
    create: () => {
      const token = Symbol("footprint"); let layerId: string | undefined;
      const reveal = createFootprintReveal();
      let nativeCanvas: HTMLCanvasElement | undefined;
      const grid = createFootprintGridSource(() => { if (nativeCanvas) requestCellFrame(nativeCanvas); });
      const backfill = createFootprintBackfill(() => { if (nativeCanvas) requestCellFrame(nativeCanvas); });
      let modulation: ReturnType<typeof footprintBodyModulation> | null = null;
      const magnifier = createFootprintMagnifierSurface();
      const hover = footprintHoverModifier(() => { magnifier.release(); if (layerId) invalidateCanvasLayers(layerId, "footprint"); });
      const unfinishedCaches = new Map<string, ReturnType<typeof createUnfinishedAuctionCache>>();
      const pocCaches = new Map<string, ReturnType<typeof createFootprintPocCache>>();
      const stackCaches = new Map<string, ReturnType<typeof createFootprintStackedZoneCache>>();
      const displayCaches = new Map<string, { key: string; raw: readonly import("@/types/trading").FootprintBar[]; bars: import("@/types/trading").FootprintBar[] }>();
      let cachedSurface: { key: string; surface: import("./footprintReadout").FootprintSurface } | undefined;
      let collection: { key: string; symbol: string; history: FootprintHistory; replay: boolean; failedRowSizeKey?: string } | undefined;
      const updates = footprintUpdates(receive => marketService.onTick(tick => {
        if (collection?.symbol === tick.symbol && !collection.replay) {
          studyTradeSource.observe(tick);
          // The next scoped paint reports capacity/precision errors through the chart's existing error panel.
          try { collection.history.add([tick]); } catch { /* Stored by the collection; never render partial failed aggregates. */ }
        }
        receive(tick);
      }), id => invalidateCanvasLayers(id, "footprint"));
      let currentSymbol: string | undefined;
      let offArchive: (() => void) | undefined;
      const deactivate = () => {
        if (!layerId) return;
        updates.set(undefined); backfill.clear(); reveal.reset(); grid.reset(); magnifier.release(); hover.destroy();
        offArchive?.(); offArchive = undefined; currentSymbol = undefined;
        clearStudyNotice(updates); clearDerivedIssue(layerId, token); clearFootprintSurface(layerId, token); clearFootprintMenuFrame(layerId, token);
        collection = undefined; cachedSurface = undefined; modulation = null;
        unfinishedCaches.clear(); pocCaches.clear(); stackCaches.clear(); displayCaches.clear(); layerId = undefined;
      };
      const layer = canvasLayer((ctx, args, cell) => {
        if (!layerId && nativeCanvas) hover.mount(nativeCanvas);
        magnifier.clear(); layerId = cell.id; modulation = null;
        const sourceSymbol = stripVenue(cell.symbol);
        if (currentSymbol !== sourceSymbol) {
          offArchive?.(); currentSymbol = sourceSymbol;
          offArchive = studyTradeSource.subscribe(sourceSymbol, () => { if (layerId) invalidateCanvasLayers(layerId, "footprint"); });
        }
        clearFootprintSurface(cell.id, token);
        clearFootprintMenuFrame(cell.id, token);
        updates.set(!cell.replay && !isTickInterval(cell.timeframe) ? { id: cell.id, symbol: sourceSymbol } : undefined);
        const state = useChartStore.getState();
        const instances = resolveFootprintInstances(args.settings), placements = footprintPlacements(args, instances);
        const selectedId = `fp${args.settings?.readoutInstance ?? 1}`;
        const inspected = instances.find(instance => instance.id === selectedId) ?? instances[0];
        const style = inspected.style;
        const replay = cell.replay ? replayTrades(cell.symbol, cell.timeframe, cell.replayThrough ?? null) : undefined;
        if (cell.replay && !replay) {
          backfill.clear();
          reveal.reset(); paintFootprintInstanceCandles(ctx, args, instances, placements, 0);
          collection = undefined;
          clearDerivedIssue(cell.id, token);
          if (routeStudyNotice(updates, cell, "Footprint", "Replay: candles only. Load archived classified trades; gaps remain unknown.")) return;
          const noteTop = args.bounds.top + args.bounds.height - 90;
          ctx.fillStyle = args.theme.background;
          ctx.fillRect(12, noteTop, Math.min(196, args.coords.width - 24), 34);
          ctx.fillStyle = args.theme.textColor; ctx.font = "11px sans-serif";
          ctx.fillText("Replay: candles only", 16, noteTop + 13, args.coords.width - 32);
          ctx.fillText("Load archived classified trades", 16, noteTop + 27, args.coords.width - 32);
          return;
        }
        const owner = cell.id === "primary" ? useWorkspaceStore.getState().activeId : cell.id;
        let paintedCandles = false;
        runDerivedPaint(cell.id, token, { owner, symbol: cell.symbol, timeframe: cell.timeframe, type: "footprint" }, () => {
        const key = JSON.stringify([cell.symbol, cell.timeframe, state.marketEpochs[cell.symbol] ?? 0, studyTradeSource.revision(sourceSymbol), cell.replay, replay?.through]);
        const rowSizeKey = JSON.stringify(instances.map(instance => [instance.id, instance.style.rowSize]));
        if (isTickInterval(cell.timeframe)) collection = undefined;
        else if (!collection || collection.key !== key || (collection.history.failed && collection.failedRowSizeKey !== rowSizeKey)) {
          const history = new FootprintHistory(cell.timeframe);
          history.add(replay ? replay.trades : studyTrades(cell.symbol));
          collection = { key, symbol: stripVenue(cell.symbol), history, replay: cell.replay, failedRowSizeKey: rowSizeKey };
        } else if (!collection.history.failed) {
          collection.failedRowSizeKey = rowSizeKey;
        }
        const historyNotice = backfill.read(footprintBackfillSymbol(cell), collection?.history, args);
        collection?.history.retainViews(instances.map(instance => instance.id));
        for (const id of unfinishedCaches.keys()) if (!instances.some(instance => instance.id === id)) unfinishedCaches.delete(id);
        for (const id of pocCaches.keys()) if (!instances.some(instance => instance.id === id)) pocCaches.delete(id);
        for (const id of stackCaches.keys()) if (!instances.some(instance => instance.id === id)) stackCaches.delete(id);
        for (const id of displayCaches.keys()) if (!instances.some(instance => instance.id === id)) displayCaches.delete(id);
        const price = (cell.replay ? args.bars.at(-1)?.close : state.quotes[cell.symbol]?.price) ?? args.bars.at(-1)?.close;
        const rangeSettings = resolveVisibleFootprint(args.settings);
        const precision = grid.read({ symbol: cell.symbol, price, simulated: collection?.history.coverage.simulated ?? false,
          scope: JSON.stringify([cell.timeframe, cell.replay, state.marketEpochs[cell.symbol] ?? 0, studyTradeSource.revision(sourceSymbol)]),
          required: instances.some(instance => !(instance.style.rowSize > 0)) || rangeSettings.enabled && !(rangeSettings.style.rowSize > 0) });
        const gridNotice = footprintGridNotice(precision, cell.replay);
        const views = instances.map(instance => {
          const style = instance.style;
          if (!(style.rowSize > 0) && !precision.tick) return { instance, step: 0, bars: [] as import("@/types/trading").FootprintBar[], unfinished: undefined, pocReferences: undefined, stackedZones: undefined, placement: placements.get(instance.id)! };
          const step = footprintStep(args, style, price ?? 1, precision.tick);
          const rawBars = collection?.history.read({ step, ratio: style.imbalanceRatio, minimumVolume: style.imbalanceMinVolume,
            ignoreZeroOpposite: style.ignoreZeroOpposite }, instance.id) ?? [];
          const displayKey = JSON.stringify([collection?.key ?? "", step, style.imbalanceRatio, style.imbalanceMinVolume, style.ignoreZeroOpposite, style.averageTradeSize,
            style.minVolume, style.maxVolume, style.minBidVolume, style.maxBidVolume, style.minAskVolume, style.maxAskVolume]);
          const prevDisplay = displayCaches.get(instance.id);
          const bars = prevDisplay && prevDisplay.key === displayKey && prevDisplay.raw === rawBars
            ? prevDisplay.bars
            : rawBars.map(bar => footprintDisplayBar(bar, step, style));
          if (!prevDisplay || prevDisplay.bars !== bars) displayCaches.set(instance.id, { key: displayKey, raw: rawBars, bars });
          let cache = unfinishedCaches.get(instance.id);
          if (!cache) { cache = createUnfinishedAuctionCache(); unfinishedCaches.set(instance.id, cache); }
          const unfinished = style.unfinishedVisible ? cache.read(bars, args.bars, cell.timeframe, step, style.unfinishedMinVolume, replay?.through) : undefined;
          let pocCache = pocCaches.get(instance.id);
          if (!pocCache) { pocCache = createFootprintPocCache(); pocCaches.set(instance.id, pocCache); }
          const pocReferences = style.pocVisible && style.pocExtend ? pocCache.read(bars, args.bars, cell.timeframe, step, style.averageTradeSize, replay?.through) : undefined;
          let stackCache = stackCaches.get(instance.id);
          if (!stackCache) { stackCache = createFootprintStackedZoneCache(); stackCaches.set(instance.id, stackCache); }
          const stackedZones = style.stackedVisible ? stackCache.read(bars, args.bars, cell.timeframe, step, style.stackedRows, replay?.through) : undefined;
          return { instance, step, bars, unfinished, pocReferences, stackedZones, placement: placements.get(instance.id)! };
        });
        const { bars, step, unfinished, pocReferences, stackedZones } = views.find(view => view.instance.id === inspected.id)!;
        const opacity = reveal.update(args.nowMs, footprintRawSpacing(args), views.some(view => view.bars.some(bar => bar.levels.length > 0)),
          JSON.stringify([cell.symbol, cell.timeframe, state.marketEpochs[cell.symbol] ?? 0, studyTradeSource.revision(sourceSymbol), cell.replay]), replay?.through);
        modulation = footprintBodyModulation(opacity, instances.map(instance => instance.style.position));
        const revealedPlacements = footprintPlacements(args, instances, opacity);
        for (const view of views) view.placement = revealedPlacements.get(view.instance.id)!;
        paintFootprintInstanceCandles(ctx, args, instances, revealedPlacements, opacity); paintedCandles = true;
        const visibleFootprint = collection ? readVisibleFootprint(collection.history, args, cell.timeframe, replay?.through, precision.tick) : undefined;
        const coverage = collection?.history.coverage;
        if (coverage) {
          const epoch = state.marketEpochs[cell.symbol] ?? 0, sourceStamp = rangeProfileSourceStamp(cell.symbol, cell.timeframe);
          const sourceLabel = `${replay?.label || archiveOptions.label(cell.symbol) || historyNotice || "Collected executions"} · ${gridNotice}`;
          const surfaceKey = JSON.stringify([cell.id, cell.symbol, cell.timeframe, epoch, sourceStamp, coverage.trades, coverage.dropped, coverage.simulated, step, inspected.id,
            replay?.through ?? null, sourceLabel, bars.at(-1)?.delta, bars.at(-1)?.volume, style.imbalanceRatio, style.imbalanceMinVolume, style.ignoreZeroOpposite,
            style.stackedRows, style.averageTradeSize, style.cellValues, style.volumeMode, style.volumeSplit, style.valueAreaPercent, style.valueAreaVisible, style.pocExtend,
            style.minVolume, style.maxVolume, style.minBidVolume, style.maxBidVolume, style.minAskVolume, style.maxAskVolume,
            Boolean(visibleFootprint?.bar), visibleFootprint?.candles, visibleFootprint?.observedCandles, unfinished?.length ?? 0, pocReferences?.length ?? 0, stackedZones?.length ?? 0]);
          if (!cachedSurface || cachedSurface.key !== surfaceKey || cachedSurface.surface.bars !== bars || cachedSurface.surface.visibleRange !== visibleFootprint ||
            cachedSurface.surface.unfinished !== unfinished || cachedSurface.surface.pocReferences !== pocReferences || cachedSurface.surface.stackedZones !== stackedZones) {
            cachedSurface = {
              key: surfaceKey,
              surface: { deltaPaths: new Map(bars.map(bar => [bar.time, collection!.history.readDelta(bar.time)!])), symbol: cell.symbol, timeframe: cell.timeframe,
                epoch, bars, simulated: coverage.simulated, dropped: coverage.dropped, sourceStamp,
                analysis: step > 0 ? { step, ratio: style.imbalanceRatio, minimumVolume: style.imbalanceMinVolume, ignoreZeroOpposite: style.ignoreZeroOpposite, minimumStackRows: style.stackedRows, averageTradeSize: style.averageTradeSize, cellValues: style.cellValues, volumeMode: style.volumeMode, volumeSplit: style.volumeSplit, instance: inspected.id,
                  valueAreaPercent: style.valueAreaPercent, valueAreaVisible: style.valueAreaVisible, pocExtend: style.pocExtend,
                  minVolume: style.minVolume, maxVolume: style.maxVolume, minBidVolume: style.minBidVolume, maxBidVolume: style.maxBidVolume, minAskVolume: style.minAskVolume, maxAskVolume: style.maxAskVolume } : undefined,
                unfinished, pocReferences, stackedZones, visibleRange: visibleFootprint, sourceLabel, ...(replay ? { replayThrough: replay.through } : {}) },
            };
          }
          publishFootprintSurface(cell.id, token, cachedSurface.surface);
        }
        const { coords, bounds } = args;
        const palette = footprintPalette(useWorkspaceStore.getState().theme);
        const width = revealedPlacements.get(inspected.id)!.width;
        const candles = new Map(args.bars.map(bar => [bar.time, bar]));
        for (const view of views) {
          const volumeStyle = { ...view.instance.style, candleVisible: false };
          const drawable = view.bars.filter(bar => candles.has(bar.time)), textPlan = footprintTextPlan(ctx, args, drawable, view.step, volumeStyle, view.placement);
          for (const bar of drawable) paintFootprintBar(ctx, args, bar, candles.get(bar.time), view.step, volumeStyle, view.placement, undefined, undefined, textPlan);
        }
        for (const view of views) if (view.stackedZones) paintFootprintStackedZones(ctx,args,view.stackedZones,view.instance.style,view.placement);
        for (const view of views) if (view.unfinished) paintUnfinishedAuctions(ctx,args,view.unfinished,view.instance.style,view.placement);
        for (const view of views) if (view.pocReferences) paintFootprintPocExtensions(ctx,args,view.pocReferences,view.instance.style,view.placement);
        paintVisibleFootprint(ctx, args, visibleFootprint);
        const hoverViews = views.map(view => ({ id: view.instance.id, label: view.instance.label, bars: view.bars, step: view.step, style: view.instance.style, placement: view.placement }));
        if (visibleFootprint?.bar && visibleFootprint.placement) hoverViews.push({ id: "vr", label: "Visible range", bars: [visibleFootprint.bar], step: visibleFootprint.step, style: visibleFootprint.style, placement: visibleFootprint.placement });
        publishFootprintMenuFrame(cell.id, token, { args, views: hoverViews, visibleEnabled: args.settings.vrEnabled === true,
          scope: { symbol: cell.symbol, timeframe: cell.timeframe, epoch: state.marketEpochs[cell.symbol] ?? 0, sourceStamp: rangeProfileSourceStamp(cell.symbol, cell.timeframe), replay: cell.replay,
            ...(cell.replay ? { through: cell.replayThrough } : {}) } });
        paintFootprintHover(ctx, args, hoverViews, hover.shift,
          replay ? { timeframe: cell.timeframe, through: replay.through } : undefined, magnifier);
        if (width < 22 || opacity <= .01 || bars.length === 0) {
          const hint = providerOf(cell.symbol) === "yahoo" ? "Footprints need a classified trade stream: use Binance, Kraken or Hyperliquid." : isTickInterval(cell.timeframe) ? "Footprints require a time interval." : bars.length ? `Zoom in to read ${footprintModeLabel(style.volumeMode)} cells. Partial collected history.` : replay ? "No recorded executions revealed; missing history is unknown." : "Collecting trades; footprints begin at connection. Missing history is unknown.";
          if (routeStudyNotice(updates, cell, "Footprint", `${step > 0 ? hint : "Footprint rows are waiting for price precision."} · ${gridNotice}${historyNotice ? ` · ${historyNotice}` : ""}`)) return;
          ctx.fillStyle = palette.note;
          ctx.font = "11px sans-serif";
          ctx.fillText(
            providerOf(cell.symbol) === "yahoo"
              ? "Footprints need a trade stream: use a Binance, Kraken or Hyperliquid market"
              : isTickInterval(cell.timeframe)
                ? "Footprints require a time interval"
                : bars.length
                ? `Zoom in to read ${footprintModeLabel(style.volumeMode)} cells`
                : replay ? "No recorded executions revealed; missing history is unknown" : "Collecting trades · footprints begin at connection",
            16,
            bounds.top + 108,
          );
          return;
        }
        if (routeStudyNotice(updates, cell, "Footprint", `${replay ? "REPLAY · " : ""}${coverage?.simulated ? "SIMULATED · " : ""}${footprintModeLabel(style.volumeMode)} · ${coverage?.trades ?? 0} collected trades · partial history; gaps unknown. ${[replay?.label || archiveOptions.label(cell.symbol), historyNotice].filter(Boolean).join(" ") || "Collection begins at connection."} · ${gridNotice}`)) return;
        ctx.fillStyle = args.theme.textColor; ctx.font = "10px sans-serif";
        ctx.fillStyle = args.theme.background; ctx.fillRect(48, bounds.top + bounds.height - 23, Math.max(10, coords.width - 52), 20);
        ctx.fillStyle = args.theme.textColor;
        ctx.fillText(`${replay ? "REPLAY · " : ""}${coverage?.simulated ? "SIMULATED · " : ""}${footprintModeLabel(style.volumeMode)} · Partial history · ${coverage?.trades.toLocaleString("en-US") ?? 0} trades${coverage?.dropped ? " · older bars evicted" : ""}${replay ? " · archived; completed bars only" : archiveOptions.label(cell.symbol) ? " · includes archive; gaps possible" : ""}`, 52, bounds.top + bounds.height - 10, Math.max(10, coords.width - 60));
        });
        if (!paintedCandles) { reveal.reset(); modulation = null; paintFootprintInstanceCandles(ctx, args, instances, placements, 0); }
      }, (args) => {
        if (args.priceStyle === "footprint") return true;
        deactivate();
        return false;
      }, "footprint");
      return { ...layer, animating: () => reveal.animating, modulateBase: (args: RendererLayerArgs) => args.priceStyle === "footprint" ? modulation : null,
        mount(canvas: HTMLCanvasElement) { nativeCanvas = canvas; layer.mount(canvas); magnifier.mount(canvas); }, destroy() { deactivate(); magnifier.destroy(); nativeCanvas = undefined; grid.dispose(); updates.destroy(); layer.destroy(); } };
    },
  });
  registerChartType({
    id: "tpo",
    label: "TPO / Market Profile",
    basePainting: "none",
    settings: tpoSettings(),
  });
  registerNativeIndicator(tpoOverlayDescriptor());
  registerRendererLayer({ id: TPO_OVERLAY_ID, placement: "above-data", repaintOnCursor: true, create: () => {
    const token = Symbol("tpo-overlay"), notice = {};
    let cache = createTpoCache(), touchCache = createTpoTouchCache();
    let key: string | undefined, sourceCell: string | undefined;
    let context2d: CanvasRenderingContext2D | undefined;
    const repaint = () => { if (sourceCell) invalidateCanvasLayers(sourceCell, TPO_OVERLAY_ID); };
    const source = new TpoCandleSource(repaint);
    const executions = new TpoExecutionSource(tpoExecutionDependencies, repaint);
    const deactivate = () => {
      if (!sourceCell) return;
      sourceCell = undefined;
      if (key) { clearTpoSurface(key, token); key = undefined; }
      clearStudyNotice(notice); source.reset(); executions.reset();
      cache = createTpoCache(); touchCache = createTpoTouchCache();
      clearTpoRenderCache(context2d); context2d = undefined;
    };
    const layer = canvasLayer((ctx, args, cell) => {
      sourceCell = cell.id; context2d = ctx;
      if (key) clearTpoSurface(key, token);
      const channel = args.data as TpoOverlayChannel;
      key = `${cell.id}:${channel.id}`;
      const last = args.bars.at(-1), context = { symbol: cell.symbol, timeframe: cell.timeframe,
        epoch: useChartStore.getState().marketEpochs[cell.symbol] ?? 0, replay: cell.replay,
        seriesRange: last ? { first: args.bars[0].time, last: last.time, count: args.bars.length, high: last.high, low: last.low, open: last.open, close: last.close, volume: last.volume } : undefined };
      try {
        const style = resolveTpoOverlay(channel.values), state = useChartStore.getState();
        const read = source.read({ symbol: cell.symbol, timeframe: cell.timeframe, style, bars: args.bars,
          epoch: `${state.feedEpoch}:${context.epoch}`, replay: cell.replay, through: cell.replayThrough,
          simulation: state.feedMode === "simulation" || state.dataSources[`${cell.symbol}:${cell.timeframe}`] === "simulation", adjustDividends: state.adjustDividends });
        if (read.status !== "ready") {
          publishTpoSurface(key, token, { ...context, style, ...(read.status === "loading" ? { pending: read.message } : { error: read.message }) });
          ctx.fillStyle = args.theme.textColor; ctx.font = "11px sans-serif"; ctx.fillText(read.message, 8, args.bounds.top + 48, Math.max(10, args.coords.width - 16));
          clearStudyNotice(notice); return;
        }
        const ownArgs = { ...args, bars: read.value.bars }, sessions = cache.read(ownArgs.bars, style, cell.timeframe, cell.symbol, read.value.calendar);
        const touches = style.extensionUntilTouch ? touchCache.read(ownArgs.bars, sessions) : undefined;
        // Shared painter's hover uses TPO geometry, while the underlying chart
        // type and its candle painting remain owned by the host chart.
        const metrics = executions.read({ symbol: stripVenue(cell.symbol), timeframe: cell.timeframe, epoch: `${state.feedEpoch}:${context.epoch}`, replay: cell.replay, through: cell.replayThrough, sessions, bars: ownArgs.bars, style });
        const ladders = paintTpoOverlay(ctx, ownArgs, sessions, style, touches, metrics);
        publishTpoSurface(key, token, { ...context, sessions, style, touches, ladders, metrics, sourceBasis: read.value.basis, sourceCalendar: read.value.calendar });
        clearStudyNotice(notice);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid TPO data.";
        publishTpoSurface(key, token, { ...context, error: message });
        if (!routeStudyNotice(notice, cell, "Time Price Opportunity", message)) {
          ctx.fillStyle = args.theme.textColor; ctx.font = "11px sans-serif"; ctx.fillText(`TPO overlay: ${message}`, 8, args.bounds.top + 48, Math.max(10, args.coords.width - 16));
        }
      }
    }, (args, cell) => {
      const channel = args.data as TpoOverlayChannel | undefined;
      if (channel && channel.symbol === cell.symbol && channel.timeframe === cell.timeframe && channel.live === !cell.replay) return true;
      deactivate();
      return false;
    }, TPO_OVERLAY_ID);
    return { ...layer, destroy() { deactivate(); layer.destroy(); } };
  } });
  registerRendererLayer({
    id: "tpo",
    repaintOnCursor: true,
    create: () => {
      const token = Symbol("tpo");
      let cache = createTpoCache(), touchCache = createTpoTouchCache();
      let layerId: string | undefined;
      let context2d: CanvasRenderingContext2D | undefined;
      const repaint = () => { if (layerId) invalidateCanvasLayers(layerId, "tpo"); };
      const source = new TpoCandleSource(repaint);
      const executions = new TpoExecutionSource(tpoExecutionDependencies, repaint);
      const deactivate = () => {
        if (!layerId) return;
        clearDerivedIssue(layerId, token); clearTpoSurface(layerId, token); clearTpoMenuFrame(layerId, token);
        layerId = undefined;
        source.reset(); executions.reset();
        cache = createTpoCache(); touchCache = createTpoTouchCache();
        clearTpoRenderCache(context2d); context2d = undefined;
      };
      const layer = canvasLayer((ctx, args, cell) => {
        if (layerId) { clearTpoSurface(layerId, token); clearTpoMenuFrame(layerId, token); }
        layerId = cell.id; context2d = ctx;
        const owner = cell.id === "primary" ? useWorkspaceStore.getState().activeId : cell.id;
        runDerivedPaint(cell.id, token, { owner, symbol: cell.symbol, timeframe: cell.timeframe, type: "tpo" }, () => {
          const last = args.bars.at(-1);
          const context = { symbol: cell.symbol, timeframe: cell.timeframe, epoch: useChartStore.getState().marketEpochs[cell.symbol] ?? 0, replay: cell.replay,
            seriesRange: last ? { first: args.bars[0].time, last: last.time, count: args.bars.length, high: last.high, low: last.low, open: last.open, close: last.close, volume: last.volume } : undefined };
          try {
            const style = resolveTpo(args.settings), state = useChartStore.getState();
            const read = source.read({ symbol: cell.symbol, timeframe: cell.timeframe, style, bars: args.bars,
              epoch: `${state.feedEpoch}:${context.epoch}`, replay: cell.replay, through: cell.replayThrough,
              simulation: state.feedMode === "simulation" || state.dataSources[`${cell.symbol}:${cell.timeframe}`] === "simulation", adjustDividends: state.adjustDividends });
            if (read.status !== "ready") {
              publishTpoSurface(cell.id, token, { ...context, style, ...(read.status === "loading" ? { pending: read.message } : { error: read.message }) });
              ctx.fillStyle = args.theme.textColor; ctx.font = "11px sans-serif"; ctx.fillText(read.message, 8, args.bounds.top + 48, Math.max(10, args.coords.width - 16)); return;
            }
            const ownArgs = { ...args, bars: read.value.bars }, sessions = cache.read(ownArgs.bars, style, cell.timeframe, cell.symbol, read.value.calendar);
            const touches = style.extensionUntilTouch ? touchCache.read(ownArgs.bars, sessions) : undefined;
            publishTpoMenuFrame(cell.id, token, { args: ownArgs, sessions, style, symbol: cell.symbol, timeframe: cell.timeframe });
            const metrics = executions.read({ symbol: stripVenue(cell.symbol), timeframe: cell.timeframe, epoch: `${state.feedEpoch}:${context.epoch}`, replay: cell.replay, through: cell.replayThrough, sessions, bars: ownArgs.bars, style });
            const ladders = paintTpoSessions(ctx, ownArgs, sessions, style, touches, args.bars, metrics);
            publishTpoSurface(cell.id, token, { ...context, sessions, style, touches, ladders, metrics, sourceBasis: read.value.basis, sourceCalendar: read.value.calendar });
          } catch (error) { publishTpoSurface(cell.id, token, { ...context, error: error instanceof Error ? error.message : "Invalid TPO data." }); throw error; }
        });
      }, args => {
        if (args.priceStyle === "tpo") return true;
        deactivate();
        return false;
      }, "tpo");
      return { ...layer, destroy() { deactivate(); layer.destroy(); } };
    },
  });
  for (const [profileId, profileTitle] of [["af-session-profile", "Session Volume Profile"], ["af-rolling-profile", "Rolling Volume Profile"]]) registerRendererLayer({
    id: profileId,
    create: () => {
      let channel: VolumeProfileChannel | null | undefined, cellId: string | undefined;
      const token = Symbol("session-profile-layer");
      const noticeOwner = {};
      const repaint = () => { if (cellId) invalidateCanvasLayers(cellId); };
      const layer = canvasLayer((ctx, args, cell) => {
        if (cellId) clearSessionProfileSurface(cellId, token);
        if (channel !== args.data && channel?.repaint === repaint) channel.repaint = undefined;
        channel = args.data as VolumeProfileChannel | null | undefined; cellId = cell.id;
        if (channel) { channel.repaint = repaint; if (channel.current && channel.context && channel.context.live === !cell.replay && (!cell.replay || channel.context.replayThrough === cell.replayThrough)) {
          if (channel.context.symbol === cell.symbol && channel.context.timeframe === cell.timeframe && channel.context.epoch === (useChartStore.getState().marketEpochs[cell.symbol] ?? 0)
            && (profileId !== "af-rolling-profile" || channel.context.revision === archiveOptions.revision(cell.symbol))) {
          const pocExtensions=paintVolumeProfiles(ctx, args, channel.current, message => routeStudyNotice(noticeOwner, cell, profileTitle, message));
            publishSessionProfileSurface(cell.id, token, { context: channel.context, payload: {...channel.current,pocExtensions} });
          } else routeStudyNotice(noticeOwner, cell, profileTitle, "Waiting for the profile of the current market and source. No stale profile is displayed.");
        } else routeStudyNotice(noticeOwner, cell, profileTitle, "Waiting for the profile at the current source and Replay boundary. Load recorded executions for Replay; gaps remain unknown."); } else clearStudyNotice(noticeOwner);
      }, (args) => {
        if (args.data) return true;
        if (cellId) clearSessionProfileSurface(cellId, token);
        if (channel?.repaint === repaint) channel.repaint = undefined;
        channel = undefined;
        clearStudyNotice(noticeOwner);
        return false;
      });
      return { ...layer, destroy() { clearStudyNotice(noticeOwner); if (cellId) clearSessionProfileSurface(cellId, token); if (channel?.repaint === repaint) channel.repaint = undefined; layer.destroy(); } };
    },
  });
  registerNativeIndicator(rollingProfileDescriptor(studyTrades, (symbol, changed) => marketService.onTick(tick => {
    if (tick.symbol === stripVenue(symbol)) { studyTradeSource.observe(tick); changed(tick); }
  }), symbol => useChartStore.getState().marketEpochs[symbol] ?? 0, archiveOptions));
  registerNativeIndicator(sessionProfileDescriptor(studyTrades, (symbol, changed) =>
    marketService.onTick(tick => { if (tick.symbol === stripVenue(symbol)) { studyTradeSource.observe(tick); changed(tick); } }), sessionProfileJobs,
    symbol => useChartStore.getState().marketEpochs[symbol] ?? 0, archiveOptions));
  for (const [id, title] of [["af-cvd", "Cumulative Volume Delta"], ["af-volume-delta", "Volume Delta"]]) {
    registerRendererLayer({
      id,
      create: () => createStudyNoticeLayer(title, (ctx, args, message) => {
        ctx.fillStyle = args.theme.textColor; ctx.font = "10px sans-serif";
        const width = Math.max(10, args.coords.width - 24), lines: string[] = [];
        let line = "";
        for (const word of message.split(" ")) {
          const next = line ? `${line} ${word}` : word;
          if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
        }
        if (line) lines.push(line);
        const top = args.bounds.top + 14;
        lines.forEach((text, index) => ctx.fillText(text, 12, top + index * 12, width));
      }),
    });
  }
  registerNativeIndicator(cvdDescriptor(studyTrades, (symbol, changed) =>
    marketService.onTick(tick => { if (tick.symbol === stripVenue(symbol)) { studyTradeSource.observe(tick); changed(tick); } }), archiveOptions));
  registerNativeIndicator(cvdDescriptor(studyTrades, (symbol, changed) =>
    marketService.onTick(tick => { if (tick.symbol === stripVenue(symbol)) { studyTradeSource.observe(tick); changed(tick); } }), archiveOptions, true));
  registerOrderflowSignalPlugins({
    studyTrades,
    replayTrades,
    subscribeTicks: (symbol, changed) =>
      marketService.onTick(tick => {
        if (tick.symbol === symbol || tick.symbol === stripVenue(symbol)) {
          studyTradeSource.observe(tick);
          changed();
        }
      }),
  });
}
