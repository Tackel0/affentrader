"use client";
import {
  registerChartType,
  registerRendererLayer,
  type RendererLayerArgs,
} from "@luxalgo/vela";
import type { OHLCV } from "@/types/trading";
import { canvasLayer, visibleSlice } from "./canvasLayer";
import { CHART_TYPES, DEFAULT_CHART_TYPE_SETTINGS } from "./chartTypes";
import {
  assignSlots,
  boxSize,
  kagi,
  lineBreak,
  pointFigure,
  rangeBars,
  renko,
  type Brick,
  type KagiSegment,
  type PointFigureColumn,
} from "./transforms";
import { candleLayerSettings, paintPluginCandles } from "./candleLayers";
import { derivedSettingsForCell } from "./derivedSettings";
import { cachedDerivedValue as cached, derivedBarKey as barKey, clearDerivedCache } from "./derivedCache";
import { clearDerivedIssue, runDerivedPaint } from "./derivedRenderState";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

type Painter = (
  ctx: CanvasRenderingContext2D,
  args: RendererLayerArgs,
  cellId: string,
) => void;

function bodyWidth(args: RendererLayerArgs, scale = 0.72): number {
  return Math.max(1, args.coords.bodySpacing() * scale);
}
function visible(args: RendererLayerArgs): OHLCV[] {
  const range = args.coords.visibleTimeRange();
  const [from, to] = visibleSlice(args.bars, range.from, range.to);
  return args.bars.slice(from, to) as OHLCV[];
}

function trace(
  ctx: CanvasRenderingContext2D,
  args: RendererLayerArgs,
  bars: OHLCV[],
  step: boolean,
) {
  const { coords, scale, bounds } = args;
  ctx.beginPath();
  bars.forEach((bar, i) => {
    const x = coords.timeToX(bar.time);
    const y = coords.priceToY(bar.close, scale, bounds);
    if (i === 0) ctx.moveTo(x, y);
    else if (step) {
      const previousY = coords.priceToY(bars[i - 1].close, scale, bounds);
      ctx.lineTo(x, previousY);
      ctx.lineTo(x, y);
    } else ctx.lineTo(x, y);
  });
}

const lineLike =
  (mode: "markers" | "step" | "hlc"): Painter =>
  (ctx, args) => {
    const { coords, scale, bounds, theme } = args;
    const bars = visible(args);
    if (bars.length < 1) return;
    const accent = "#2962ff";
    if (mode === "hlc") {
      ctx.beginPath();
      bars.forEach((bar, i) => {
        const x = coords.timeToX(bar.time);
        const y = coords.priceToY(bar.high, scale, bounds);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      for (let i = bars.length - 1; i >= 0; i--)
        ctx.lineTo(
          coords.timeToX(bars[i].time),
          coords.priceToY(bars[i].low, scale, bounds),
        );
      ctx.closePath();
      ctx.fillStyle = `${accent}26`;
      ctx.fill();
    }
    trace(ctx, args, bars, mode === "step");
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
    if (mode === "markers") {
      const radius = Math.min(4, Math.max(1.5, coords.pxPerBar() * 0.25));
      ctx.fillStyle = theme.background;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      for (const bar of bars) {
        ctx.beginPath();
        ctx.arc(
          coords.timeToX(bar.time),
          coords.priceToY(bar.close, scale, bounds),
          radius,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.stroke();
      }
    }
  };

const columns: Painter = (ctx, args) => {
  const { coords, scale, bounds, theme } = args;
  const bars = visible(args);
  const all = args.bars as OHLCV[];
  const first = all.indexOf(bars[0]);
  const width = bodyWidth(args, 0.8);
  const floor = bounds.top + bounds.height;
  bars.forEach((bar, i) => {
    const previous = all[first + i - 1];
    ctx.fillStyle =
      bar.close >= (previous?.close ?? bar.open) ? theme.upColor : theme.downColor;
    const y = coords.priceToY(bar.close, scale, bounds);
    ctx.fillRect(coords.timeToX(bar.time) - width / 2, y, width, floor - y);
  });
};

const highLow: Painter = (ctx, args) => {
  const { coords, scale, bounds, theme } = args;
  const width = bodyWidth(args, 0.8);
  for (const bar of visible(args)) {
    ctx.fillStyle = bar.close >= bar.open ? theme.upColor : theme.downColor;
    const top = coords.priceToY(bar.high, scale, bounds);
    const bottom = coords.priceToY(bar.low, scale, bounds);
    ctx.fillRect(
      coords.timeToX(bar.time) - width / 2,
      top,
      width,
      Math.max(1, bottom - top),
    );
  }
};

/** x position of a slot index along the bar axis, extrapolating past either end. */
function slotX(args: RendererLayerArgs, slot: number): number {
  const bars = args.bars;
  if (!bars.length) return 0;
  const clamped = Math.max(0, Math.min(bars.length - 1, slot));
  return (
    args.coords.timeToX(bars[clamped].time) +
    (slot - clamped) * args.coords.pxPerBar()
  );
}

function paintBricks(
  ctx: CanvasRenderingContext2D,
  args: RendererLayerArgs,
  bricks: Brick[],
  slots: number[],
  wick: boolean,
) {
  const { coords, scale, bounds, theme } = args;
  const width = Math.max(3, coords.pxPerBar() * 0.82);
  bricks.forEach((brick, i) => {
    const x = slotX(args, slots[i]);
    if (x < -width || x > coords.width + width) return;
    const color = brick.up ? theme.upColor : theme.downColor;
    const top = coords.priceToY(Math.max(brick.open, brick.close), scale, bounds);
    const bottom = coords.priceToY(Math.min(brick.open, brick.close), scale, bounds);
    ctx.fillStyle = color;
    ctx.fillRect(x - width / 2, top, width, Math.max(1, bottom - top));
    if (wick) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, coords.priceToY(brick.high, scale, bounds));
      ctx.lineTo(Math.round(x) + 0.5, coords.priceToY(brick.low, scale, bounds));
      ctx.stroke();
    }
  });
}

const settings = (cellId: string) => derivedSettingsForCell(cellId) ?? DEFAULT_CHART_TYPE_SETTINGS;

const renkoPainter: Painter = (ctx, args, cellId) => {
  const config = settings(cellId).renko;
  const size = boxSize(args.bars as OHLCV[], config);
  const { bricks, slots } = cached(
    `renko:${cellId}`,
    `${barKey(args.bars)}:${size}`,
    () => {
      const bricks = renko(args.bars as OHLCV[], size);
      return {
        bricks,
        slots: assignSlots(bricks.map((b) => b.source), args.bars.length - 1),
      };
    },
  );
  paintBricks(ctx, args, bricks, slots, false);
};

const lineBreakPainter: Painter = (ctx, args, cellId) => {
  const lines = Math.max(1, settings(cellId).linebreak.lines);
  const { bricks, slots } = cached(
    `linebreak:${cellId}`,
    `${barKey(args.bars)}:${lines}`,
    () => {
      const bricks = lineBreak(args.bars as OHLCV[], lines);
      return {
        bricks,
        slots: assignSlots(bricks.map((b) => b.source), args.bars.length - 1),
      };
    },
  );
  paintBricks(ctx, args, bricks, slots, false);
};

const rangePainter: Painter = (ctx, args, cellId) => {
  const size = boxSize(args.bars as OHLCV[], settings(cellId).range);
  const { bricks, slots } = cached(
    `range:${cellId}`,
    `${barKey(args.bars)}:${size}`,
    () => {
      const bricks = rangeBars(args.bars as OHLCV[], size);
      return {
        bricks,
        slots: assignSlots(bricks.map((b) => b.source), args.bars.length - 1),
      };
    },
  );
  paintBricks(ctx, args, bricks, slots, true);
};

const kagiPainter: Painter = (ctx, args, cellId) => {
  const { coords, scale, bounds, theme } = args;
  const reversal = boxSize(args.bars as OHLCV[], settings(cellId).kagi);
  const { segments, slots } = cached(
    `kagi:${cellId}`,
    `${barKey(args.bars)}:${reversal}`,
    () => {
      const segments: KagiSegment[] = kagi(args.bars as OHLCV[], reversal);
      return {
        segments,
        slots: assignSlots(segments.map((s) => s.source), args.bars.length - 1),
      };
    },
  );
  ctx.lineCap = "square";
  segments.forEach((segment, i) => {
    const x = slotX(args, slots[i]);
    const y1 = coords.priceToY(segment.from, scale, bounds);
    const y2 = coords.priceToY(segment.to, scale, bounds);
    ctx.strokeStyle = segment.thick ? theme.upColor : theme.downColor;
    ctx.lineWidth = segment.thick ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
    ctx.stroke();
    const next = segments[i + 1];
    if (next) {
      const nextX = slotX(args, slots[i + 1]);
      ctx.beginPath();
      ctx.moveTo(x, y2);
      ctx.lineTo(nextX, y2);
      ctx.stroke();
    }
  });
};

const pointFigurePainter: Painter = (ctx, args, cellId) => {
  const { coords, scale, bounds, theme } = args;
  const config = settings(cellId).pointfigure;
  const box = boxSize(args.bars as OHLCV[], config.sizing);
  const { columns: cols, slots } = cached(
    `pf:${cellId}`,
    `${barKey(args.bars)}:${box}:${config.reversal}`,
    () => {
      const columns: PointFigureColumn[] = pointFigure(
        args.bars as OHLCV[],
        box,
        config.reversal,
      );
      return {
        columns,
        slots: assignSlots(columns.map((c) => c.source), args.bars.length - 1),
      };
    },
  );
  const width = Math.max(8, coords.pxPerBar() * 0.82);
  cols.forEach((column, i) => {
    const x = slotX(args, slots[i]);
    if (x < -width || x > coords.width + width) return;
    ctx.strokeStyle = column.up ? theme.upColor : theme.downColor;
    ctx.lineWidth = 1.4;
    for (const price of column.boxes) {
      const top = coords.priceToY(price + box, scale, bounds);
      const bottom = coords.priceToY(price, scale, bounds);
      const height = bottom - top;
      if (height < 1) continue;
      const size = Math.min(width, height) * 0.8;
      const cy = (top + bottom) / 2;
      ctx.beginPath();
      if (column.up) {
        ctx.moveTo(x - size / 2, cy - size / 2);
        ctx.lineTo(x + size / 2, cy + size / 2);
        ctx.moveTo(x + size / 2, cy - size / 2);
        ctx.lineTo(x - size / 2, cy + size / 2);
      } else ctx.ellipse(x, cy, size / 2, size / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
};

const painters: Record<string, Painter> = {
  hollow: (ctx, args) => paintPluginCandles(ctx, args, "hollow"),
  volumecandles: (ctx, args) => paintPluginCandles(ctx, args, "volumecandles"),
  linemarkers: lineLike("markers"),
  stepline: lineLike("step"),
  hlcarea: lineLike("hlc"),
  columns,
  highlow: highLow,
  renko: renkoPainter,
  linebreak: lineBreakPainter,
  kagi: kagiPainter,
  range: rangePainter,
  pointfigure: pointFigurePainter,
};

/** Register every non-native price style as a Vela chart type plus its layer. */
export function registerChartStyles() {
  for (const info of CHART_TYPES) {
    const painter = painters[info.id];
    if (!painter) continue;
    registerChartType({
      id: info.id,
      label: info.label,
      basePainting: "none",
      ...(info.id === "hollow" || info.id === "volumecandles" ? { settings: candleLayerSettings(info.id) } : {}),
    });
    registerRendererLayer({
      id: info.id,
      create: () => {
        const token = Symbol(info.id);
        let layerId: string | undefined;
        const layer = canvasLayer((ctx, args, cell) => {
          layerId = cell.id;
          runDerivedPaint(cell.id, token, { owner: cell.id === "primary" ? useWorkspaceStore.getState().activeId : cell.id,
            symbol: cell.symbol, timeframe: cell.timeframe, type: info.id }, () => painter(ctx, args, cell.id));
        }, args => args.priceStyle === info.id && args.bars.length > 0);
        return { ...layer, destroy: () => { layer.destroy(); if (layerId) { clearDerivedIssue(layerId, token); clearDerivedCache(layerId); } } };
      },
    });
  }
}


