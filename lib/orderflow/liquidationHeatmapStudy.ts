import { registerNativeIndicator, registerRendererLayer, type NativeIndicatorContext, type NativeIndicatorDescriptor, type RendererLayerArgs } from "@luxalgo/vela";
import { canvasLayer } from "@/lib/chart/canvasLayer";
import { clearStudyNotice, routeStudyNotice } from "@/lib/chart/studyNotices";
import { parseInterval } from "@/lib/market/intervals";
import { useChartStore } from "@/stores/useChartStore";
import {
  buildLiquidationHeatmap, completedLiquidationBars, defaultLiquidationHeatmap, LIQUIDATION_HEATMAP,
  LIQUIDATION_LEVERAGES, liquidationHeatmapSettings, liquidationReference,
} from "./liquidationHeatmap";

const title = "Liquidation Levels Heatmap";
const defaults = defaultLiquidationHeatmap;
const transformedStyles = new Set(["heikinashi", "renko", "linebreak", "kagi", "range", "pointfigure"]);
type Settings = typeof defaults;
type Model = ReturnType<typeof buildLiquidationHeatmap>;
interface HeatmapChannel {
  symbol: string;
  timeframe: string;
  settings: Settings;
}

const descriptor: NativeIndicatorDescriptor = {
  type: LIQUIDATION_HEATMAP, title, shortTitle: "Liq estimate", overlay: true, paneHint: "price", multiInstance: false,
  defaultInputs: () => ({ ...defaults }),
  inputsSchema: () => [
    { key: "leverages", title: "Hypothetical leverages", type: "string", defval: defaults.leverages, options: Object.keys(LIQUIDATION_LEVERAGES) },
    { key: "maintenancePercent", title: "Maintenance margin (%)", type: "float", defval: defaults.maintenancePercent, min: 0, max: 0.75, step: 0.05 },
    { key: "lookback", title: "Completed candles", type: "int", defval: defaults.lookback, min: 30, max: 360 },
    { key: "rowPercent", title: "Price row size (%)", type: "float", defval: defaults.rowPercent, min: 0.1, max: 1, step: 0.05 },
    { key: "opacity", title: "Opacity (%)", type: "int", defval: defaults.opacity, min: 10, max: 85, tab: "Style" },
    { key: "longColor", title: "Long liquidation color", type: "color", defval: defaults.longColor, tab: "Style" },
    { key: "shortColor", title: "Short liquidation color", type: "color", defval: defaults.shortColor, tab: "Style" },
  ],
  create() {
    let context: NativeIndicatorContext | undefined;
    let settings = defaults;
    let visible = false;
    const publish = () => {
      if (context && visible) {
        const { symbol, timeframe } = context;
        context.pushData({ symbol, timeframe, settings } satisfies HeatmapChannel);
      }
    };
    return {
      start(ctx, inputs) { context = ctx; settings = liquidationHeatmapSettings(inputs); visible = true; ctx.emit({}); publish(); },
      onBars() {},
      onViewport() {},
      setInputs(inputs) { settings = liquidationHeatmapSettings(inputs); publish(); },
      suspend() { visible = false; context?.pushData(null); },
      resume() { visible = true; publish(); },
      stop() { visible = false; context?.pushData(null); context = undefined; },
    };
  },
};

function paintBands(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, model: Model, settings: Settings) {
  const { coords, scale, bounds } = args;
  const intensity = Math.log1p(model.maxWeight * 10);
  const rows = new Map<number, readonly [number, number]>();
  const columns = new Map<number, number>();
  const xFor = (time: number) => {
    const cached = columns.get(time);
    if (cached !== undefined) return cached;
    const x = Math.max(0, Math.min(coords.width, coords.timeToX(time)));
    columns.set(time, x);
    return x;
  };
  for (const band of model.bands) {
    const left = xFor(band.from);
    const right = band.to === null ? coords.width : xFor(band.to);
    if (!(right > left)) continue;
    let pixels = rows.get(band.row);
    if (!pixels) {
      const first = coords.priceToY(Math.exp((band.row - 0.5) * model.logStep), scale, bounds);
      const second = coords.priceToY(Math.exp((band.row + 0.5) * model.logStep), scale, bounds);
      pixels = [Math.min(first, second), Math.max(first, second)];
      rows.set(band.row, pixels);
    }
    const [top, bottom] = pixels;
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom < bounds.top || top > bounds.top + bounds.height) continue;
    ctx.fillStyle = band.side === "long" ? settings.longColor : settings.shortColor;
    ctx.globalAlpha = settings.opacity / 100 * Math.log1p(band.weight * 10) / intensity;
    ctx.fillRect(left, top, right - left, Math.max(1, bottom - top));
  }
}

function paintLegend(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, settings: Settings, reference: string) {
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const label = reference === "Spot reference" ? "Liq est. · Spot" : "Liq est. · Perp";
  const width = Math.ceil(ctx.measureText(label).width) + 100;
  if (args.coords.width < width + 8 || args.bounds.height < 88) return;
  const x = args.coords.width - width - 5;
  const y = args.bounds.top + 42;
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = args.theme.background;
  ctx.fillRect(x, y, width, 22);
  ctx.globalAlpha = 1;
  ctx.fillStyle = args.theme.textColor;
  ctx.fillText(label, x + 5, y + 11);
  ctx.fillText("Long", x + width - 76, y + 11);
  ctx.fillText("Short", x + width - 35, y + 11);
  ctx.fillStyle = settings.longColor;
  ctx.fillRect(x + width - 87, y + 7, 8, 8);
  ctx.fillStyle = settings.shortColor;
  ctx.fillRect(x + width - 46, y + 7, 8, 8);
}

export function registerLiquidationHeatmap() {
  registerNativeIndicator(descriptor);
  registerRendererLayer({
    id: LIQUIDATION_HEATMAP, placement: "below-data", create() {
      const owner = {};
      let cache: { channel: HeatmapChannel; bars: RendererLayerArgs["bars"]; end: number; last: RendererLayerArgs["bars"][number] | undefined; model: Model } | undefined;
      let model: Model | undefined;
      let reference: ReturnType<typeof liquidationReference> = null;
      let fallback = "";
      const layer = canvasLayer((ctx, args) => {
        if (model?.bands.length && cache && reference) {
          paintBands(ctx, args, model, cache.channel.settings);
          paintLegend(ctx, args, cache.channel.settings, reference);
        }
        if (fallback) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = args.theme.textColor;
          ctx.font = "11px sans-serif";
          ctx.fillText(fallback, 6, args.bounds.top + args.bounds.height - 32, Math.max(1, args.coords.width - 12));
        }
      }, (args, cell) => {
        const channel = args.data as HeatmapChannel | null | undefined;
        model = undefined;
        fallback = "";
        if (!channel || channel.symbol !== cell.symbol || channel.timeframe !== cell.timeframe) {
          cache = undefined;
          clearStudyNotice(owner);
          return false;
        }
        reference = liquidationReference(cell.symbol);
        const state = useChartStore.getState();
        const interval = parseInterval(cell.timeframe);
        let message: string;
        if (!reference) message = "Choose a supported crypto spot chart or a Hyperliquid or Bybit perpetual.";
        else if (state.feedMode === "simulation" || state.dataSources[`${cell.symbol}:${cell.timeframe}`] === "simulation") message = "Liquidation estimates are unavailable for simulated candles.";
        else if (!interval || interval.unit === "T" || transformedStyles.has(args.priceStyle)) message = "Liquidation estimates require a time-based chart with regular OHLCV.";
        else {
          const through = cell.replay ? cell.replayThrough ?? -Infinity : Date.now();
          const end = completedLiquidationBars(args.bars, cell.timeframe, through);
          const last = args.bars[end - 1];
          if (cache?.channel !== channel || cache.bars !== args.bars || cache.end !== end || cache.last !== last) {
            cache = { channel, bars: args.bars, end, last, model: buildLiquidationHeatmap(args.bars, end, cell.timeframe, channel.settings) };
          }
          model = cache.model;
          message = model.bands.length
            ? `${reference} · OHLCV estimates for ${channel.settings.leverages}. Brighter rows show more modeled volume. Actual positions and liquidations are unknown.`
            : "Waiting for completed market candles with volume.";
        }
        if (!model) cache = undefined;
        if (!routeStudyNotice(owner, cell, title, message)) fallback = message;
        return Boolean(model?.bands.length || fallback);
      });
      return { ...layer, destroy() { clearStudyNotice(owner); layer.destroy(); } };
    },
  });
}
