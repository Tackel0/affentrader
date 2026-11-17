import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintRowHit } from "./footprintHover";
import { footprintNumber, footprintSignedNumber } from "./footprintFormat";
import { tpoColorRgba } from "./tpoTimeColors";

export function footprintPriceDigits(step: number): number {
  if (!(step > 0)) return 2;
  let digits = 0, value = step;
  while (digits < 8 && Math.abs(value - Math.round(value)) > 1e-9) { value *= 10; digits++; }
  return digits;
}
const dark = { panelBg: "rgba(18, 20, 25, 0.92)", panelBorder: "rgba(255, 255, 255, 0.08)", highlightBg: "rgba(180, 185, 197, 0.13)", ink: "#e6e8ef", labelInk: "rgba(230, 232, 239, 0.6)", separator: "rgba(255, 255, 255, 0.1)" };
const light = { panelBg: "rgba(255, 255, 255, 0.95)", panelBorder: "rgba(19, 23, 34, 0.14)", highlightBg: "rgba(41, 45, 53, 0.08)", ink: "#131722", labelInk: "rgba(19, 23, 34, 0.6)", separator: "rgba(19, 23, 34, 0.12)" };
export interface FootprintTooltipGeometry { x: number; y: number; width: number; height: number }
/** Reference-style raw row popup. The caller owns its pane and paint-state scope. */
export function paintFootprintTooltip(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, hit: FootprintRowHit, hint = true, rowHighlight = true): FootprintTooltipGeometry {
  const [r, g, b] = tpoColorRgba(args.theme.background ?? "#131722"), colors = .2126 * r + .7152 * g + .0722 * b >= 128 ? light : dark;
  const row = hit.bar.levels[hit.row], family = args.theme.fontFamily || "sans-serif", font = `12px ${family}`, bold = `600 12px ${family}`, small = `10px ${family}`;
  if (rowHighlight) { ctx.globalAlpha = 1; ctx.fillStyle = colors.highlightBg; ctx.fillRect(hit.rect.x, hit.rect.y, Math.max(1, hit.rect.width), Math.max(1, hit.rect.height)); }
  const measure = (text: string, heavy = false) => { ctx.font = heavy ? bold : font; return typeof ctx.measureText === "function" ? ctx.measureText(text).width : text.length * (heavy ? 7.2 : 6.6); };
  const digits = footprintPriceDigits(hit.view.step), price = `${hit.lower.toFixed(digits)} – ${hit.upper.toFixed(digits)}`;
  const bid = footprintNumber(row.sellVolume), ask = footprintNumber(row.buyVolume), cross = " × ", delta = row.buyVolume - row.sellVolume;
  const values = [{ label: "Bid × Ask", value: "", color: colors.ink }, { label: "Volume", value: footprintNumber(row.buyVolume + row.sellVolume), color: colors.ink }, { label: "Delta", value: footprintSignedNumber(delta), color: delta > 0 ? args.theme.upColor ?? "#089981" : delta < 0 ? args.theme.downColor ?? "#f23645" : colors.ink }];
  const sideWidth = measure(bid, true) + measure(cross) + measure(ask, true);
  let content = measure(price, true);
  for (const item of values) content = Math.max(content, measure(item.label) + 18 + (item.label === "Bid × Ask" ? sideWidth : measure(item.value, true)));
  const hintText = "⇧ Shift to magnify";
  if (hint) { ctx.font = small; content = Math.max(content, typeof ctx.measureText === "function" ? ctx.measureText(hintText).width : hintText.length * 5.5); }
  const width = Math.ceil(content + 20), height = Math.ceil(44 + 19 * values.length - 3 + Number(hint) * 14);
  let x = hit.rect.x + hit.rect.width + 10;
  if (x + width > args.coords.width - 10) x = hit.rect.x - 10 - width;
  x = Math.round(Math.max(10, Math.min(x, args.coords.width - width - 10)));
  const localY = hit.rect.y - args.bounds.top + hit.rect.height / 2 - height / 2;
  const y = args.bounds.top + Math.round(Math.max(10, Math.min(localY, args.bounds.height - height - 10)));
  const round = (left: number, top: number, w: number, h: number, stroke = false) => {
    if (typeof ctx.roundRect === "function" && typeof ctx.fill === "function") { ctx.beginPath(); ctx.roundRect(left, top, w, h, 8); if (stroke) ctx.stroke(); else ctx.fill(); }
    else if (stroke) ctx.strokeRect(left, top, w, h); else ctx.fillRect(left, top, w, h);
  };
  ctx.save(); ctx.fillStyle = colors.panelBg; round(x, y, width, height);
  ctx.strokeStyle = colors.panelBorder; ctx.lineWidth = 1; round(x + .5, y + .5, width - 1, height - 1, true);
  ctx.textBaseline = "middle"; ctx.font = bold; ctx.fillStyle = colors.ink; ctx.textAlign = "center"; ctx.fillText(price, x + width / 2, y + 16);
  const separatorY = args.bounds.top + Math.round(y - args.bounds.top + 30) + .5;
  ctx.strokeStyle = colors.separator; ctx.beginPath(); ctx.moveTo(x + 10, separatorY); ctx.lineTo(x + width - 10, separatorY); ctx.stroke();
  values.forEach((item, index) => {
    const textY = y + 44 + 19 * index;
    ctx.font = font; ctx.fillStyle = colors.labelInk; ctx.textAlign = "left"; ctx.fillText(item.label, x + 10, textY);
    ctx.font = bold; ctx.textAlign = "right";
    if (item.label === "Bid × Ask") {
      let right = x + width - 10; ctx.fillStyle = args.theme.upColor ?? "#089981"; ctx.fillText(ask, right, textY); right -= measure(ask, true);
      ctx.font = font; ctx.fillStyle = colors.labelInk; ctx.fillText(cross, right, textY); right -= measure(cross);
      ctx.font = bold; ctx.fillStyle = args.theme.downColor ?? "#f23645"; ctx.fillText(bid, right, textY);
    } else { ctx.fillStyle = item.color; ctx.fillText(item.value, x + width - 10, textY); }
  });
  if (hint) { ctx.font = small; ctx.fillStyle = colors.labelInk; ctx.textAlign = "center"; ctx.fillText(hintText, x + width / 2, y + 97); }
  ctx.restore(); ctx.globalAlpha = 1;
  return { x, y, width, height };
}
