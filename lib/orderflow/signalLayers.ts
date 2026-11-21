import {
  registerNativeIndicator,
  registerRendererLayer,
  type InputValue,
  type NativeIndicatorContext,
  type NativeIndicatorDescriptor,
  type RendererLayerArgs,
} from "@luxalgo/vela";
import type { OHLCV, Tick } from "@/types/trading";
import { canvasLayer, invalidateCanvasLayers } from "@/lib/chart/canvasLayer";
import { nativeReplayBoundary } from "@/lib/chart/replayClock";
import { stripVenue } from "@/lib/market/service";
import { intervalMs, isTickInterval, parseInterval } from "@/lib/market/intervals";
import { CvdAccumulator } from "./cvdModel";
import { defaultCvd } from "./cvdSettings";
import { detectDeltaDivergences } from "./deltaDivergence";
import { detectFootprintBarSignals, type FootprintBarSignal } from "./footprintSignals";
import { detectOhlcvProxySignals, estimateOhlcvDeltaBars } from "./ohlcvOrderflowProxy";
import { footprints, priceStep } from "./math";
import { FixedProfileCache } from "./fixedProfileModel";
import type { ReplayStudyInput } from "./studyTradeSource";
import { findVolumeNodes } from "./volumeNodes";

interface SignalLayerDeps {
  studyTrades: (symbol: string) => readonly Tick[];
  subscribeTicks: (symbol: string, changed: () => void) => () => void;
  replayTrades?: (symbol: string, timeframe: string, through: number | null) => ReplayStudyInput | undefined;
}

interface OverlayChannel<T> {
  symbol: string;
  timeframe: string;
  trades: readonly Tick[];
  options: T;
  live?: boolean;
  through?: number | null;
  repaint?: () => void;
}

interface PlacedRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const pill = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  fill: string,
  stroke: string,
  textColor = "#f8fafc",
  placed?: PlacedRect[],
  minY?: number,
  maxY?: number,
) => {
  ctx.font = "600 10px sans-serif";
  const padX = 5;
  const textWidth = typeof ctx.measureText === "function" ? ctx.measureText(text).width : text.length * 6;
  const w = Math.max(30, textWidth + padX * 2);
  const h = 15;
  let py = y;
  if (placed) {
    const overlaps = (cy: number) => {
      const rx1 = x - w / 2 - 2;
      const rx2 = x + w / 2 + 2;
      const ry1 = cy - h / 2 - 2;
      const ry2 = cy + h / 2 + 2;
      return placed.some((box) => rx1 < box.x2 && rx2 > box.x1 && ry1 < box.y2 && ry2 > box.y1);
    };
    if (overlaps(py)) {
      const lo = minY ?? -Infinity;
      const hi = maxY ?? Infinity;
      const mid = Number.isFinite(lo) && Number.isFinite(hi) ? (lo + hi) / 2 : py;
      const dir = py <= mid ? 1 : -1;
      let resolved: number | null = null;
      for (let stepIdx = 1; stepIdx <= 4; stepIdx++) {
        for (const sign of [dir, -dir]) {
          const candidate = y + sign * stepIdx * (h + 2);
          if (candidate >= lo && candidate <= hi && !overlaps(candidate)) {
            resolved = candidate;
            break;
          }
        }
        if (resolved !== null) break;
      }
      if (resolved === null) return;
      py = resolved;
    }
    placed.push({ x1: x - w / 2, y1: py - h / 2, x2: x + w / 2, y2: py + h / 2 });
  }
  const rx = Math.round(x - w / 2);
  const ry = Math.round(py - h / 2);
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.fillRect(rx, ry, w, h);
  ctx.strokeRect(rx + 0.5, ry + 0.5, w - 1, h - 1);
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.fillText(text, rx + w / 2, ry + 11);
};

function computeSignalStep(bars: readonly { high: number; low: number; close: number }[]): number {
  const sample = bars.slice(-24);
  const ranges = sample
    .map((b) => b.high - b.low)
    .filter((r) => Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b);
  const medianRange = ranges.length ? ranges[Math.floor(ranges.length / 2)] : 0;
  const lastClose = bars.at(-1)?.close ?? 1;
  const refPrice = Number.isFinite(lastClose) && lastClose > 0 ? lastClose : 1;
  const minTick = priceStep(refPrice);
  const raw = medianRange > 0 ? medianRange / 8 : Math.max(minTick, refPrice * 0.0005);
  const step = Math.max(minTick, raw);
  return Number.isFinite(step) && step > 0 ? Number(step.toPrecision(4)) : 1e-8;
}

const sameChannelContext = <T>(
  channel: OverlayChannel<T>,
  cell: { replay?: boolean; replayThrough?: number | null },
) => {
  const isLiveCell = !cell.replay;
  if (channel.live !== undefined && channel.live !== isLiveCell) return false;
  if (cell.replay && channel.through !== undefined && channel.through !== (cell.replayThrough ?? null)) return false;
  return true;
};

interface VolumeNodeOptions {
  rows?: number;
  showHvn?: boolean;
  showLvn?: boolean;
  hvnColor?: string;
  lvnColor?: string;
}

const hasVolumeNodes = ({ data, bars }: RendererLayerArgs): boolean => {
  const options = data as VolumeNodeOptions | null | undefined;
  return Boolean(options && bars.length && (options.showHvn !== false || options.showLvn !== false));
};

/**
 * Registers three LuxAlgo/Vela-compatible institutional Orderflow & Volume Profile signal layers:
 * 1. `af-volume-nodes`: High & Low Volume Nodes (HVN / LVN) overlaid on price action
 * 2. `af-orderflow-signals`: Absorption High/Low & Exhaustion High/Low prints (live tick tape or OHLCV proxy)
 * 3. `af-delta-divergence`: Automated Price vs. CVD / Est. Delta Bullish/Bearish Divergence lines
 */
export function registerOrderflowSignalPlugins({ studyTrades, subscribeTicks, replayTrades }: SignalLayerDeps): void {
  // 1. Volume Nodes (HVN / LVN)
  const nodesCache = new FixedProfileCache();
  registerNativeIndicator({
    type: "af-volume-nodes",
    title: "Volume Nodes (HVN / LVN)",
    shortTitle: "HVN/LVN",
    overlay: true,
    multiInstance: true,
    paneHint: "price",
    inputsSchema: () => [
      { key: "rows", title: "Profile Rows", type: "int", defval: 32, min: 10, max: 120, step: 2 },
      { key: "showHvn", title: "Show HVN (High Volume Nodes)", type: "bool", defval: true },
      { key: "showLvn", title: "Show LVN (Low Volume Nodes)", type: "bool", defval: true },
      { key: "hvnColor", title: "HVN Color", type: "color", defval: "#38bdf8" },
      { key: "lvnColor", title: "LVN Color", type: "color", defval: "#f59e0b" },
    ],
    defaultInputs: () => ({ rows: 32, showHvn: true, showLvn: true, hvnColor: "#38bdf8", lvnColor: "#f59e0b" }),
    create: () => {
      let ctx: NativeIndicatorContext | null = null;
      let active = false;
      let opts = { rows: 32, showHvn: true, showLvn: true, hvnColor: "#38bdf8", lvnColor: "#f59e0b" };
      const push = () => {
        if (active && ctx) ctx.pushData({ ...opts });
      };
      return {
        start(c, inputs) {
          ctx = c;
          active = true;
          opts = { ...opts, ...(inputs as Partial<typeof opts>) };
          c.emit({});
          push();
        },
        setInputs(inputs) {
          opts = { ...opts, ...(inputs as Partial<typeof opts>) };
          push();
        },
        onBars() {
          push();
        },
        onViewport() {},
        suspend() {
          active = false;
          ctx?.pushData(null);
        },
        resume() {
          active = true;
          push();
        },
        stop() {
          active = false;
          ctx?.pushData(null);
          ctx = null;
        },
      };
    },
  });

  registerRendererLayer({
    id: "af-volume-nodes",
    placement: "above-data",
    create: () =>
      canvasLayer((ctx: CanvasRenderingContext2D, args: RendererLayerArgs) => {
        if (!hasVolumeNodes(args)) return;
        const cfg = args.data as VolumeNodeOptions;
        const rowsCount = Math.max(10, Math.min(120, Math.round(cfg.rows ?? 32)));
        let res: ReturnType<typeof nodesCache.read> = null;
        try {
          res = nodesCache.read(args.bars as OHLCV[], {
            rows: rowsCount,
            valueAreaPct: 70,
            developing: false,
          });
        } catch {
          return;
        }
        if (!res) return;
        const nodes = res.profile.nodes ?? findVolumeNodes(res.profile.rows);
        const hvnColor = cfg.hvnColor ?? "#38bdf8";
        const lvnColor = cfg.lvnColor ?? "#f59e0b";
        const width = args.coords.width;

        const minNodeY = args.bounds.top + 9;
        const maxNodeY = args.bounds.top + args.bounds.height - 9;
        const placedNodes: PlacedRect[] = [];
        ctx.save();
        for (const node of nodes) {
          if (node.kind === "HVN" && cfg.showHvn === false) continue;
          if (node.kind === "LVN" && cfg.showLvn === false) continue;
          const y = args.coords.priceToY(node.price, args.scale, args.bounds);
          if (!Number.isFinite(y) || y < args.bounds.top + 8 || y > args.bounds.top + args.bounds.height - 8) continue;
          const color = node.kind === "HVN" ? hvnColor : lvnColor;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.setLineDash(node.kind === "HVN" ? [6, 4] : [3, 3]);
          ctx.beginPath();
          ctx.moveTo(0, Math.round(y) + 0.5);
          ctx.lineTo(Math.max(40, width - 54), Math.round(y) + 0.5);
          ctx.stroke();
          ctx.setLineDash([]);
          pill(ctx, Math.max(24, width - 27), y, node.kind, "rgba(15,23,42,0.88)", color, color, placedNodes, minNodeY, maxNodeY);
        }
        ctx.restore();
      }, hasVolumeNodes),
  });

  // Shared live trade subscription helper preserving full venue symbol identity & Replay fence
  const createTradeStudy = <T extends Record<string, InputValue>>(
    type: string,
    title: string,
    shortTitle: string,
    schema: NativeIndicatorDescriptor["inputsSchema"],
    defaults: T,
  ): NativeIndicatorDescriptor => ({
    type,
    title,
    shortTitle,
    overlay: true,
    multiInstance: true,
    paneHint: "price",
    inputsSchema: schema,
    defaultInputs: () => ({ ...defaults }),
    create: () => {
      let ctx: NativeIndicatorContext | null = null;
      let active = false;
      let opts: T = { ...defaults };
      let unsub: (() => void) | null = null;
      let tickTimer: ReturnType<typeof setTimeout> | null = null;
      const channel: OverlayChannel<T> = { symbol: "", timeframe: "", trades: [], options: opts };
      let pushedChannel: OverlayChannel<T> | null = null;
      const clearTickTimer = () => {
        if (tickTimer !== null) {
          clearTimeout(tickTimer);
          tickTimer = null;
        }
      };
      const emitChannel = () => {
        clearTickTimer();
        if (!active || !ctx) return;
        const repaint = pushedChannel?.repaint ?? channel.repaint;
        channel.symbol = ctx.symbol;
        channel.timeframe = ctx.timeframe;
        channel.live = ctx.live;
        if (ctx.live) {
          channel.through = null;
          channel.trades = studyTrades(ctx.symbol);
        } else {
          const boundary = nativeReplayBoundary(ctx);
          const replay = replayTrades?.(ctx.symbol, ctx.timeframe, boundary);
          channel.through = replay?.through ?? boundary ?? null;
          channel.trades = replay?.trades ?? [];
        }
        channel.options = { ...opts };
        channel.repaint = repaint;
        pushedChannel = { ...channel, repaint };
        ctx.pushData(pushedChannel);
        pushedChannel.repaint?.();
      };
      const scheduleChannelPush = () => {
        if (!active || !ctx?.live || tickTimer !== null) return;
        tickTimer = setTimeout(() => {
          tickTimer = null;
          emitChannel();
        }, 90);
      };
      return {
        start(c, inputs) {
          ctx = c;
          active = true;
          opts = { ...defaults, ...(inputs as Partial<T>) };
          unsub?.();
          unsub = subscribeTicks(c.symbol, scheduleChannelPush);
          c.emit({});
          emitChannel();
        },
        setInputs(inputs) {
          opts = { ...defaults, ...(inputs as Partial<T>) };
          emitChannel();
        },
        onBars() {
          emitChannel();
        },
        onViewport() {},
        suspend() {
          active = false;
          clearTickTimer();
          unsub?.();
          unsub = null;
          pushedChannel = null;
          ctx?.pushData(null);
        },
        resume() {
          if (!ctx) return;
          active = true;
          unsub?.();
          unsub = subscribeTicks(ctx.symbol, scheduleChannelPush);
          emitChannel();
        },
        stop() {
          active = false;
          clearTickTimer();
          unsub?.();
          unsub = null;
          pushedChannel = null;
          ctx?.pushData(null);
          ctx = null;
        },
      };
    },
  });

  // 2. Absorption & Exhaustion Footprint Signals (with OHLCV proxy fallback)
  registerNativeIndicator(
    createTradeStudy(
      "af-orderflow-signals",
      "Absorption & Exhaustion",
      "Abs/Exh",
      () => [
        { key: "showAbsorption", title: "Show Absorption Markers", type: "bool", defval: true },
        { key: "showExhaustion", title: "Show Exhaustion Prints", type: "bool", defval: true },
      ],
      { showAbsorption: true, showExhaustion: true },
    ),
  );

  registerRendererLayer({
    id: "af-orderflow-signals",
    placement: "above-data",
    create: () => {
      let cellId: string | undefined;
      let channel: OverlayChannel<{ showAbsorption?: boolean; showExhaustion?: boolean }> | null = null;
      let cachedKey = "";
      let cachedSignals: Array<{ time: number; price: number; upperPrice: number; kind: string; label: string }> = [];
      const repaint = () => {
        if (cellId) invalidateCanvasLayers(cellId);
      };
      return canvasLayer((ctx, args, cell) => {
        cellId = cell.id;
        channel = (args.data as OverlayChannel<{ showAbsorption?: boolean; showExhaustion?: boolean }> | null) ?? null;
        if (!channel || !args.bars.length || !sameChannelContext(channel, cell)) return;
        channel.repaint = repaint;

        const replayCutoff = cell.replay ? (cell.replayThrough ?? null) : undefined;
        const sourceTrades =
          replayCutoff === null
            ? []
            : replayCutoff !== undefined
              ? channel.trades.filter((t) => t.time < replayCutoff)
              : channel.trades;
        const hasLiveTrades = sourceTrades.length > 0;
        const firstTrade = sourceTrades[0];
        const lastTrade = sourceTrades.at(-1);
        const lastBar = args.bars.at(-1);
        const step = hasLiveTrades ? computeSignalStep(args.bars) : 0;
        const key = hasLiveTrades
          ? JSON.stringify([
              cell.symbol,
              cell.timeframe,
              Boolean(cell.replay),
              replayCutoff ?? null,
              sourceTrades.length,
              firstTrade?.id,
              lastTrade?.id,
              lastTrade?.time,
              step,
              args.bars.length,
              lastBar?.time,
              lastBar?.open,
              lastBar?.high,
              lastBar?.low,
              lastBar?.close,
              lastBar?.volume,
            ])
          : JSON.stringify([
              "proxy",
              cell.symbol,
              cell.timeframe,
              Boolean(cell.replay),
              replayCutoff ?? null,
              args.bars.length,
              args.bars[0]?.time,
              lastBar?.time,
              lastBar?.open,
              lastBar?.high,
              lastBar?.low,
              lastBar?.close,
              lastBar?.volume,
            ]);

        if (key !== cachedKey) {
          cachedKey = key;
          if (hasLiveTrades) {
            const fpBars = footprints(sourceTrades, cell.timeframe, step);
            const barMap = new Map(args.bars.map((b) => [b.time, b]));
            const bucketSpan = intervalMs(cell.timeframe) || 60_000;
            const out: FootprintBarSignal[] = [];
            for (const fp of fpBars) {
              const candle = barMap.get(fp.time) ?? args.bars.find((b) => Math.abs(b.time - fp.time) < bucketSpan / 2);
              for (const sig of detectFootprintBarSignals(fp, candle as OHLCV | undefined)) {
                out.push(sig);
              }
            }
            cachedSignals = out;
          } else {
            cachedSignals = detectOhlcvProxySignals(args.bars as OHLCV[]).map((sig) => ({
              time: sig.time,
              price: sig.price,
              upperPrice: sig.price,
              kind: sig.kind,
              label: sig.label,
            }));
          }
        }

        const minY = args.bounds.top + 10;
        const maxY = args.bounds.top + args.bounds.height - 10;
        const range = typeof args.coords.visibleTimeRange === "function" ? args.coords.visibleTimeRange() : null;
        const margin = Math.max(intervalMs(cell.timeframe) || 60_000, 60_000) * 2;
        const inView =
          range && Number.isFinite(range.from) && Number.isFinite(range.to)
            ? cachedSignals.filter((sig) => sig.time >= range.from - margin && sig.time <= range.to + margin)
            : cachedSignals.slice(-60);
        const visibleSignals = inView.length > 160 ? inView.slice(-160) : inView;
        const placedBadges: PlacedRect[] = [];
        ctx.save();
        for (const sig of visibleSignals) {
          const isAbs = sig.kind.startsWith("absorption");
          if (isAbs && channel.options.showAbsorption === false) continue;
          if (!isAbs && channel.options.showExhaustion === false) continue;
          const x = args.coords.timeToX(sig.time);
          if (!Number.isFinite(x) || x < -40 || x > args.coords.width + 40) continue;
          const isHigh = sig.kind.endsWith("high");
          const targetPrice = isHigh ? (sig.upperPrice || sig.price) : sig.price;
          const rawY = args.coords.priceToY(targetPrice, args.scale, args.bounds);
          if (!Number.isFinite(rawY)) continue;
          const badgeY = Math.max(minY, Math.min(maxY, isHigh ? rawY - 12 : rawY + 12));
          const stroke = isAbs
            ? (isHigh ? "#f43f5e" : "#10b981")
            : (isHigh ? "#f59e0b" : "#38bdf8");
          pill(ctx, x, badgeY, sig.label, "rgba(15,23,42,0.92)", stroke, stroke, placedBadges, minY, maxY);
        }
        ctx.restore();
      });
    },
  });

  // 3. Automated Delta Divergence (Price vs CVD / Est. Delta)
  registerNativeIndicator(
    createTradeStudy(
      "af-delta-divergence",
      "Delta Divergence (Price vs CVD)",
      "Delta Div",
      () => [
        { key: "pivotRadius", title: "Swing Pivot Radius", type: "int", defval: 2, min: 1, max: 6, step: 1 },
        { key: "bullColor", title: "Bullish Divergence", type: "color", defval: "#22c55e" },
        { key: "bearColor", title: "Bearish Divergence", type: "color", defval: "#ef4444" },
      ],
      { pivotRadius: 2, bullColor: "#22c55e", bearColor: "#ef4444" },
    ),
  );

  registerRendererLayer({
    id: "af-delta-divergence",
    placement: "above-data",
    create: () => {
      let cellId: string | undefined;
      let channel: OverlayChannel<{ pivotRadius?: number; bullColor?: string; bearColor?: string }> | null = null;
      let cachedKey = "";
      let cachedHasLive = false;
      let cachedDivergences: ReturnType<typeof detectDeltaDivergences> = [];
      const repaint = () => {
        if (cellId) invalidateCanvasLayers(cellId);
      };
      return canvasLayer((ctx, args, cell) => {
        cellId = cell.id;
        channel = (args.data as OverlayChannel<{ pivotRadius?: number; bullColor?: string; bearColor?: string }> | null) ?? null;
        if (!channel || args.bars.length < 7 || !sameChannelContext(channel, cell)) return;
        channel.repaint = repaint;

        const replayCutoff = cell.replay ? (cell.replayThrough ?? null) : undefined;
        const sourceTrades =
          replayCutoff === null
            ? []
            : replayCutoff !== undefined
              ? channel.trades.filter((t) => t.time < replayCutoff)
              : channel.trades;
        const canComputeCvd = !isTickInterval(cell.timeframe) && parseInterval(cell.timeframe)?.unit !== "M";
        const hasLiveTrades = sourceTrades.length > 0 && canComputeCvd;
        const radius = Math.max(1, Math.min(6, Math.round(channel.options.pivotRadius ?? 2)));
        const firstBar = args.bars[0];
        const lastBar = args.bars.at(-1);
        const firstTrade = sourceTrades[0];
        const lastTrade = sourceTrades.at(-1);
        const key = hasLiveTrades
          ? JSON.stringify([
              "live",
              cell.symbol,
              cell.timeframe,
              Boolean(cell.replay),
              replayCutoff ?? null,
              radius,
              sourceTrades.length,
              firstTrade?.id,
              firstTrade?.time,
              lastTrade?.id,
              lastTrade?.time,
              args.bars.length,
              firstBar?.time,
              lastBar?.time,
              lastBar?.open,
              lastBar?.high,
              lastBar?.low,
              lastBar?.close,
              lastBar?.volume,
            ])
          : JSON.stringify([
              "proxy",
              cell.symbol,
              cell.timeframe,
              Boolean(cell.replay),
              replayCutoff ?? null,
              radius,
              args.bars.length,
              firstBar?.time,
              lastBar?.time,
              lastBar?.open,
              lastBar?.high,
              lastBar?.low,
              lastBar?.close,
              lastBar?.volume,
            ]);

        if (key !== cachedKey) {
          cachedKey = key;
          cachedHasLive = hasLiveTrades;
          let deltaBars: Array<Pick<OHLCV, "time" | "high" | "low" | "close">> | null = null;
          if (hasLiveTrades) {
            try {
              const cvdSymbol = sourceTrades.find((t) => typeof t.symbol === "string" && t.symbol.length > 0)?.symbol ?? stripVenue(cell.symbol);
              // Continuous accumulation avoids spurious UTC month-boundary CVD resets firing false divergences.
              const cvd = new CvdAccumulator(cell.timeframe, { ...defaultCvd(), anchor: "All data" }, cvdSymbol);
              cvd.add(sourceTrades);
              deltaBars = cvd.candles(args.bars, "Cumulative delta", "Total");
            } catch {
              cachedHasLive = false;
              deltaBars = null;
            }
          }
          if (!deltaBars) {
            deltaBars = estimateOhlcvDeltaBars(args.bars as OHLCV[]);
          }
          cachedDivergences = detectDeltaDivergences(args.bars as OHLCV[], deltaBars, radius);
        }

        if (!cachedDivergences.length) return;

        const minY = args.bounds.top + 10;
        const maxY = args.bounds.top + args.bounds.height - 10;
        const range = typeof args.coords.visibleTimeRange === "function" ? args.coords.visibleTimeRange() : null;
        const margin = Math.max(intervalMs(cell.timeframe) || 60_000, 60_000) * 2;
        const inView =
          range && Number.isFinite(range.from) && Number.isFinite(range.to)
            ? cachedDivergences.filter(
                (div) =>
                  Math.max(div.fromTime, div.toTime) >= range.from - margin &&
                  Math.min(div.fromTime, div.toTime) <= range.to + margin,
              )
            : cachedDivergences.slice(-12);
        const visibleDivergences = inView.length > 40 ? inView.slice(-40) : inView;
        const placedBadges: PlacedRect[] = [];
        ctx.save();
        for (const div of visibleDivergences) {
          const x1 = args.coords.timeToX(div.fromTime);
          const x2 = args.coords.timeToX(div.toTime);
          const y1 = args.coords.priceToY(div.fromPrice, args.scale, args.bounds);
          const y2 = args.coords.priceToY(div.toPrice, args.scale, args.bounds);
          if (![x1, x2, y1, y2].every(Number.isFinite)) continue;
          if (Math.max(x1, x2) < -40 || Math.min(x1, x2) > args.coords.width + 40) continue;
          const color = div.kind === "bullish" ? (channel.options.bullColor ?? "#22c55e") : (channel.options.bearColor ?? "#ef4444");
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.8;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.setLineDash([]);
          const label = cachedHasLive ? div.label : `${div.label}*`;
          const badgeY = Math.max(minY, Math.min(maxY, div.kind === "bullish" ? y2 + 14 : y2 - 14));
          pill(ctx, x2, badgeY, label, "rgba(15,23,42,0.92)", color, color, placedBadges, minY, maxY);
        }
        ctx.restore();
      });
    },
  });
}
