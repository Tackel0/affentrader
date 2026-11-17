import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar, OHLCV } from "@/types/trading";
import type { ResolvedFootprintPreferences } from "./footprint";
import { footprintValueArea } from "./footprintValueArea";
import { detectFootprintBarSignals } from "./footprintSignals";
import { tpoColorRgba } from "./tpoTimeColors";

export function footprintPocColor(color: string, background: string): string {
  const [r, g, b] = tpoColorRgba(background);
  return (color === "#ffffff" || color === "#b2b5be") && .2126 * r + .7152 * g + .0722 * b >= 128 ? "#131722" : color;
}

/** Structure overlays are painted after histogram cells and their numbers. */
export function paintFootprintStructure(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, bar: FootprintBar, step: number, style: ResolvedFootprintPreferences, left: number, right: number, opacity: number, candle?: Pick<OHLCV, "open" | "high" | "low" | "close">): void {
  const width = right - left, lines = width >= 10, yOf = (price: number) => args.coords.priceToY(price, args.scale, args.bounds);
  const area = style.valueAreaVisible ? footprintValueArea(bar, step, style.valueAreaPercent, style.averageTradeSize) : null;
  const background = args.theme.background ?? "#131722";
  if (area) {
    const high = yOf(area.high), low = yOf(area.low);
    if (Number.isFinite(high) && Number.isFinite(low)) {
      ctx.globalAlpha = opacity;
      if (tpoColorRgba(style.valueAreaBackground)[3] > 0) { ctx.fillStyle = style.valueAreaBackground; ctx.fillRect(left, Math.min(high, low), width, Math.abs(high - low)); }
      if (lines) {
        const [r, g, b] = tpoColorRgba(background);
        ctx.strokeStyle = style.valueAreaColor === "#b2b5be" && .2126 * r + .7152 * g + .0722 * b >= 128 ? "#5d606b" : style.valueAreaColor;
        ctx.lineWidth = style.valueAreaWidth;
        for (const y of [high, low]) { ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); }
      }
    }
  }

  const poc = style.pocVisible && lines ? bar.levels.find(row => !row.filtered && row.price === bar.poc) : undefined;
  if (poc) {
    const a = yOf(poc.price), b = yOf(poc.upperPrice ?? poc.price + step);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const inset = style.pocWidth / 2, rowHeight = Math.max(1, Math.abs(a - b) - 1);
      ctx.globalAlpha = .62 * opacity; ctx.strokeStyle = footprintPocColor(style.pocColor, background); ctx.lineWidth = style.pocWidth;
      ctx.strokeRect(left + inset, Math.min(a, b) + inset, width - style.pocWidth, rowHeight - style.pocWidth);
    }
  }

  if (lines && (style.absorptionVisible || style.exhaustionVisible)) {
    const signals = detectFootprintBarSignals(bar, candle).filter((signal) =>
      signal.kind.startsWith("absorption") ? style.absorptionVisible : style.exhaustionVisible,
    );
    const [r, g, bl] = tpoColorRgba(background);
    const backdrop = .2126 * r + .7152 * g + .0722 * bl >= 128 ? "rgba(255,255,255,0.9)" : "rgba(15,23,42,0.88)";
    const placedY: number[] = [];
    for (const signal of signals) {
      const a = yOf(signal.price), b = yOf(signal.upperPrice ?? signal.price + step);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const color = signal.kind.startsWith("absorption") ? style.absorptionColor : style.exhaustionColor;
      const top = Math.min(a, b), height = Math.max(2, Math.abs(a - b) - 1);
      ctx.save();
      ctx.globalAlpha = 0.85 * opacity;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(left + 0.5, top + 0.5, Math.max(1, width - 1), height);
      if (width >= 34 && height >= 10) {
        let labelY = top + height / 2;
        if (placedY.some((py) => Math.abs(py - labelY) < 11)) {
          const candidate = labelY < args.bounds.top + args.bounds.height / 2 ? labelY + 11 : labelY - 11;
          if (candidate >= args.bounds.top + 6 && candidate <= args.bounds.top + args.bounds.height - 6) labelY = candidate;
        }
        placedY.push(labelY);
        ctx.font = "600 8px ui-monospace, monospace";
        const textWidth = typeof ctx.measureText === "function" ? ctx.measureText(signal.label).width : signal.label.length * 5;
        const padX = 2;
        if (textWidth + padX * 2 + 2 <= width) {
          ctx.fillStyle = backdrop;
          ctx.fillRect(right - textWidth - padX * 2 - 1, labelY - 5, textWidth + padX * 2, 10);
          ctx.fillStyle = color;
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          ctx.fillText(signal.label, right - 3, labelY);
        }
      }
      ctx.restore();
    }
  }

  ctx.globalAlpha = opacity;
}
