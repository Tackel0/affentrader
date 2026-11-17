import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "@/types/trading";
import type { ResolvedFootprintPreferences } from "./footprint";
import { footprintSideCount } from "./footprintCounts";
import { footprintNumber, footprintSignedNumber } from "./footprintFormat";
import { executionPriceGrid } from "./priceGrid";
import { tpoColorRgba } from "./tpoTimeColors";

export const FOOTPRINT_STAT_TOGGLES = ["statVolume", "statBuy", "statSell", "statBuyPct", "statSellPct", "statDelta", "statDeltaPct", "statTradeCount", "statBidCount", "statAskCount"] as const;
export type FootprintStatToggle = typeof FOOTPRINT_STAT_TOGGLES[number];
export interface FootprintStatPreferences {
  statisticsPosition?: "above" | "below"; statisticsSize?: number; statisticsColor?: string; statisticsBackground?: string;
  statVolume?: boolean; statBuy?: boolean; statSell?: boolean; statBuyPct?: boolean; statSellPct?: boolean;
  statDelta?: boolean; statDeltaPct?: boolean; statTradeCount?: boolean; statBidCount?: boolean; statAskCount?: boolean;
}
export const defaultFootprintStatistics = (): Required<FootprintStatPreferences> => ({ statisticsPosition: "below", statisticsSize: 8, statisticsColor: "#d1d4dc", statisticsBackground: "rgba(45,47,54,0.95)",
  statVolume: true, statBuy: false, statSell: false, statBuyPct: false, statSellPct: false, statDelta: true, statDeltaPct: true, statTradeCount: false, statBidCount: false, statAskCount: false });
export interface FootprintStatistics { buy: number; sell: number; total: number; delta: number; buyPercent: number | null; sellPercent: number | null; deltaPercent: number | null; buyCount: number | null; sellCount: number | null; tradeCount: number | null }
/** Underlying counts, never aggregate-message counts. One unknown side keeps its
 * side total and combined total unavailable while preserving the known side. */
export function footprintStatistics(bar: FootprintBar): FootprintStatistics {
  let buy = 0, sell = 0, buyCount: number | null = 0, sellCount: number | null = 0;
  const add = (previous: number | null, count: number | null) => previous === null || count === null || !Number.isSafeInteger(previous + count) ? null : previous + count;
  for (const row of bar.levels) {
    if (![row.buyVolume, row.sellVolume].every(value => Number.isFinite(value) && value >= 0)) throw new RangeError("Footprint statistics contain invalid volume.");
    buy += row.buyVolume; sell += row.sellVolume;
    buyCount = add(buyCount, footprintSideCount(row, "buy")); sellCount = add(sellCount, footprintSideCount(row, "sell"));
  }
  const total = buy + sell, delta = buy - sell;
  if (![buy, sell, total, delta].every(Number.isFinite)) throw new RangeError("Footprint statistics exceed supported precision.");
  return { buy, sell, total, delta, buyPercent: total > 0 ? buy / total * 100 : null, sellPercent: total > 0 ? sell / total * 100 : null,
    deltaPercent: total > 0 ? delta / total * 100 : null, buyCount, sellCount, tradeCount: add(buyCount, sellCount) };
}
export interface FootprintStatisticRow { key: FootprintStatToggle; label: string; text: string; tone: "neutral" | "buy" | "sell" }
export function footprintStatisticRows(stats: FootprintStatistics, style: Required<FootprintStatPreferences>): FootprintStatisticRow[] {
  const rows: FootprintStatisticRow[] = [], percent = (value: number | null) => value === null ? "—" : `${value.toFixed(0)}%`;
  const push = (key: FootprintStatToggle, label: string, text: string, tone: FootprintStatisticRow["tone"] = "neutral") => rows.push({ key, label, text, tone });
  const tone = stats.delta > 0 ? "buy" : stats.delta < 0 ? "sell" : "neutral";
  const sides = new Set<string>();
  for (const key of FOOTPRINT_STAT_TOGGLES) {
    if (!style[key]) continue;
    switch (key) {
      case "statVolume": push(key, "Volume", footprintNumber(stats.total)); break;
      case "statBuy": case "statBuyPct":
        if (!sides.has("buy")) { sides.add("buy"); push("statBuy", "Buy", `${footprintNumber(stats.buy)}${style.statBuyPct && stats.buyPercent !== null ? ` (${percent(stats.buyPercent)})` : ""}`, "buy"); } break;
      case "statSell": case "statSellPct":
        if (!sides.has("sell")) { sides.add("sell"); push("statSell", "Sell", `${footprintNumber(stats.sell)}${style.statSellPct && stats.sellPercent !== null ? ` (${percent(stats.sellPercent)})` : ""}`, "sell"); } break;
      case "statDelta": push(key, "Delta", footprintSignedNumber(stats.delta), tone); break;
      case "statDeltaPct": push(key, "Delta %", percent(stats.deltaPercent), tone); break;
      case "statTradeCount": push(key, "Trades", stats.tradeCount === null ? "—" : footprintNumber(stats.tradeCount)); break;
      case "statBidCount": push(key, "Bid trades", stats.sellCount === null ? "—" : footprintNumber(stats.sellCount), "sell"); break;
      case "statAskCount": push(key, "Ask trades", stats.buyCount === null ? "—" : footprintNumber(stats.buyCount), "buy"); break;
    }
  }
  return rows;
}
/** Table anchors follow the footprint's observed row extent on either price-axis
 * direction. The host clips portions outside its price pane. */
export function paintFootprintStatistics(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, bar: FootprintBar, step: number, style: ResolvedFootprintPreferences, center: number, width: number, opacity = 1) {
  // Measure the actual projected slot edges, as the row painter does.
  const slotLeft = center - width / 2, slotRight = center + width / 2;
  width = slotRight - slotLeft;
  if (!style.statisticsVisible || !bar.levels.length || width < 22 || opacity < .6) return;
  const rows = footprintStatisticRows(footprintStatistics(bar), style); if (!rows.length) return;
  const size = Math.round(Math.max(style.statisticsSize, Math.min(style.statisticsSize + 3, width * .055))), rowHeight = size + 3;
  const height = rows.length * rowHeight + 6, left = Math.round(slotLeft), boxWidth = Math.floor(width);
  const grid = executionPriceGrid(step), last = bar.levels.at(-1)!, upper = last.upperPrice ?? grid.row(last.rowIndex ?? grid.index(last.price)).upper;
  const a = args.coords.priceToY(bar.levels[0].price, args.scale, args.bounds), b = args.coords.priceToY(upper, args.scale, args.bounds);
  const top = style.statisticsPosition === "above" ? Math.min(a, b) - 4 - height : Math.max(a, b) + 4;
  if (top + height < args.bounds.top || top > args.bounds.top + args.bounds.height) return;
  const [r,g,blue] = tpoColorRgba(args.theme.background ?? "#131722"), light = .2126*r + .7152*g + .0722*blue >= 128;
  const ink = light && style.statisticsColor === "#d1d4dc" ? "#2a2e39" : style.statisticsColor;
  const background = light && style.statisticsBackground === "rgba(45,47,54,0.95)" ? "rgba(240,243,250,0.95)" : style.statisticsBackground;
  ctx.save(); ctx.globalAlpha = opacity; ctx.fillStyle = background;
  if (typeof ctx.roundRect === "function" && typeof ctx.fill === "function") { ctx.beginPath(); ctx.roundRect(left, top, boxWidth, height, 3); ctx.fill(); }
  else ctx.fillRect(left, top, boxWidth, height);
  ctx.font = `${size >= style.statisticsSize + 2 ? "bold " : ""}${size}px ${args.theme.fontFamily || "ui-monospace, monospace"}`; ctx.textBaseline = "middle";
  const measure = (text: string) => typeof ctx.measureText === "function" ? ctx.measureText(text).width : text.length * size * .55;
  const labels = rows.every(row => measure(row.label) + 8 + measure(row.text) <= boxWidth - 8);
  rows.forEach((row,index) => {
    const y = top + 3 + index * rowHeight + rowHeight / 2, color = row.tone === "buy" ? args.theme.upColor ?? "#089981" : row.tone === "sell" ? args.theme.downColor ?? "#f23645" : ink;
    if (labels) { ctx.textAlign = "left"; ctx.fillStyle = ink; ctx.fillText(row.label,left+4,y); ctx.textAlign = "right"; ctx.fillStyle = color; ctx.fillText(row.text,left+boxWidth-4,y); }
    else { ctx.textAlign = "center"; ctx.fillStyle = color; ctx.fillText(row.text,left+boxWidth/2,y); }
  });
  ctx.restore();
}
