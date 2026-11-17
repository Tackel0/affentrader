import type { OHLCV, RendererLayerArgs } from "@luxalgo/vela";
import type { TpoSession } from "./tpoModel";
import type { TpoPreferences } from "./tpoSettings";
import { FixedProfileCache, type FixedProfileResult } from "./fixedProfileModel";
import { layoutTpoPriceLabels, tpoPriceText } from "./tpoMarkerRenderer";
export interface TpoVolumeLadder { status: "ready" | "partial" | "unavailable" | "error"; profile: FixedProfileResult | null; missing: number; rejected: number; message: string }
export class TpoVolumeLadderCache {
  private caches = new Map<number, FixedProfileCache>();
  read(bars: readonly OHLCV[], sessions: readonly TpoSession[], style: TpoPreferences): ReadonlyMap<number, TpoVolumeLadder> {
    const result = new Map<number, TpoVolumeLadder>();
    if (!style.ladderVisible) { this.caches.clear(); return result; }
    const keep = new Set(sessions.map(s => s.start)); for (const key of this.caches.keys()) if (!keep.has(key)) this.caches.delete(key);
    for (const session of sessions) {
      const windows = session.members ?? [session], source = bars.filter(bar => windows.some(w => bar.time >= w.start && bar.time < w.end));
      let missing = 0, rejected = 0;
      const valid = source.filter(bar => {
        if (bar.volume === undefined) { missing++; return false; }
        if (![bar.volume, bar.open, bar.close, bar.low, bar.high].every(Number.isFinite) || bar.volume < 0 || bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close)) { rejected++; return false; }
        return true;
      }).sort((a, b) => a.time - b.time);
      const cache = this.caches.get(session.start) ?? new FixedProfileCache(); this.caches.set(session.start, cache);
      try {
        const profile = cache.read(valid, { rows: style.ladderRows ?? 24, valueAreaPct: style.ladderValueAreaPercent ?? 70, developing: false });
        result.set(session.start, { profile, missing, rejected, status: !profile ? "unavailable" : missing || rejected ? "partial" : "ready",
          message: !profile ? "No positive observed candle volume." : "OHLCV estimate: uniform allocation across candle high/low; no aggressor classification." });
      } catch (error) { result.set(session.start, { profile: null, missing, rejected, status: "error", message: error instanceof Error ? error.message : "Invalid ladder source." }); }
    }
    return result;
  }
}
export function tpoLadderPlacement(left: number, contentRight: number, style: TpoPreferences) {
  const width = Math.max(1, contentRight - left) * (style.ladderWidthPercent ?? 30) / 100;
  return { x: style.ladderPosition === "Left" ? left - width - 4 : contentRight + 4, width };
}
export function paintTpoVolumeLadder(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, ladder: TpoVolumeLadder | undefined, style: TpoPreferences, left: number, contentRight: number) {
  if (!style.ladderVisible || !ladder?.profile) return;
  const profile = ladder.profile.profile, { x, width } = tpoLadderPlacement(left, contentRight, style), { coords, bounds, scale } = args;
  if (x + width < 0 || x > coords.width || !(width > 0)) return;
  ctx.save(); try {
    for (let i = 0; i < profile.rows.length; i++) {
      const total = profile.rows[i].up + profile.rows[i].down; if (!(total > 0)) continue;
      const a = coords.priceToY(profile.edges[i], scale, bounds), b = coords.priceToY(profile.edges[i + 1], scale, bounds), top = Math.min(a, b);
      if (top > bounds.top + bounds.height || Math.max(a, b) < bounds.top) continue;
      const w = width * total / profile.maxTotal;
      ctx.fillStyle = i >= profile.vaFrom && i <= profile.vaTo ? style.ladderColor ?? "#2962ff" : style.ladderOutsideColor ?? "#787b86";
      ctx.globalAlpha = .65; ctx.fillRect(style.ladderPosition === "Left" ? x + width - w : x, top, w, Math.max(1, Math.abs(a - b) - .5));
    }
    ctx.globalAlpha = 1; ctx.font = "9px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const labels: { text: string; y: number }[] = [];
    const level = (price: number, text: string, color: string, show: boolean) => {
      if (!show) return; const y = coords.priceToY(price, scale, bounds); if (y < bounds.top || y > bounds.top + bounds.height) return;
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width, y); ctx.stroke();
      if (style.ladderLabelsVisible) labels.push({ text: `${text} ${tpoPriceText(price)}`, y });
    };
    level(profile.centers[profile.poc], "VPOC", style.ladderPocColor ?? "#ff9800", style.ladderPocVisible ?? true);
    level(profile.edges[profile.vaTo + 1], "VVAH", style.ladderVaColor ?? "#9598a1", style.ladderVaVisible ?? true);
    level(profile.edges[profile.vaFrom], "VVAL", style.ladderVaColor ?? "#9598a1", style.ladderVaVisible ?? true);
    ctx.fillStyle = args.theme.textColor;
    for (const label of layoutTpoPriceLabels(labels, bounds.top, bounds.height))
      ctx.fillText(label.text, Math.max(2, x), label.textY, Math.min(Math.max(width, 110), coords.width - Math.max(2, x) - 2));
    const top = Math.min(...profile.edges.map(price => coords.priceToY(price, scale, bounds)));
    if (top >= bounds.top + 12 && top < bounds.top + bounds.height) { ctx.fillStyle = args.theme.textColor; ctx.fillText("VP · OHLCV estimate", x, top - 9, Math.max(width, 110)); }
  } finally { ctx.restore(); }
}
