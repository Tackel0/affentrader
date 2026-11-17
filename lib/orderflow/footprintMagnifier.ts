import type { RendererLayerArgs } from "@luxalgo/vela";
import type { FootprintBar } from "@/types/trading";
import { nextBucket } from "@/lib/market/intervals";
import { footprintBarGeometry, paintFootprintBar } from "./footprint";
import type { FootprintRowHit } from "./footprintHover";
import { footprintPriceDigits } from "./footprintTooltip";
import { footprintTextTokens, footprintValueKind } from "./footprintText";
import { tpoColorRgba } from "./tpoTimeColors";
const clamp = (n: number, min: number, max: number) => n < min ? min : n > max ? max : n;
export interface FootprintMagnifierSlot { bar: FootprintBar; left: number; right: number; axis: number; time: number | null }
export function footprintMagnifierWindow(args: RendererLayerArgs, hit: FootprintRowHit, replay?: { timeframe: string; through: number }) {
  const loaded = new Set(args.bars.map(bar => bar.time));
  const slots = hit.view.bars.filter(bar => loaded.has(bar.time) && (!replay || nextBucket(replay.timeframe, bar.time) <= replay.through)).flatMap(bar => {
    const g = footprintBarGeometry(args, bar.time, hit.view.placement);
    return g.center + g.half < 0 || g.center - g.half > args.coords.width || !(g.width > 0) ? [] : [{ bar, left: g.center - g.half, right: g.center + g.half, axis: g.center, time: hit.view.id === "vr" ? null : bar.time }];
  }).sort((a, b) => a.left - b.left);
  const index = slots.findIndex(slot => slot.bar === hit.bar || slot.bar.time === hit.bar.time), from = Math.max(0, index - 1);
  return { slots: index < 0 ? [] : slots.slice(from, Math.min(slots.length, index + 2)), hoveredIndex: index - from };
}
export function footprintMagnifierPosition(x0: number, x1: number, centerY: number, width: number, height: number, plotWidth: number, plotHeight: number) {
  const roomRight = plotWidth - 14 - (x1 + 44), roomLeft = x0 - 44 - 14;
  const side = width <= roomRight || width > roomLeft && roomRight >= roomLeft ? "right" : "left";
  const left = Math.round(clamp(side === "right" ? x1 + 44 : x0 - 44 - width, 14, Math.max(14, plotWidth - width - 14)));
  return { left, top: Math.round(clamp(centerY - height / 2, 14, Math.max(14, plotHeight - height - 14))), side, clear: side === "right" ? left >= x1 : left + width <= x0 };
}
const dark = { panelBg: "rgba(14, 16, 20, 0.98)", panelBorder: "rgba(255, 255, 255, 0.1)", highlightBg: "rgba(180, 185, 197, 0.13)", ink: "#e6e8ef", labelInk: "rgba(230, 232, 239, 0.62)", separator: "rgba(255, 255, 255, 0.1)", leader: "rgba(230, 232, 239, 0.45)" };
const light = { panelBg: "rgba(255, 255, 255, 0.98)", panelBorder: "rgba(19, 23, 34, 0.16)", highlightBg: "rgba(41, 45, 53, 0.08)", ink: "#131722", labelInk: "rgba(19, 23, 34, 0.62)", separator: "rgba(19, 23, 34, 0.12)", leader: "rgba(19, 23, 34, 0.45)" };
export function paintFootprintMagnifier(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, hit: FootprintRowHit, window = footprintMagnifierWindow(args, hit)) {
  if (!window.slots.length) return null;
  const paneTop = args.bounds.top, localTop = hit.rect.y - paneTop, localBottom = localTop + hit.rect.height;
  const rowHeight = Math.max(1, hit.rect.height), verticalScale = clamp(38 / rowHeight, 1.6, 40), enlargedRow = rowHeight * verticalScale, bodyHeight = Math.min(8 * enlargedRow, .6 * args.bounds.height);
  const family = args.theme.fontFamily || "sans-serif", font = `11px ${family}`, bold = `600 11px ${family}`, textSize = clamp(Math.round(.42 * enlargedRow), 11, 20), style = hit.view.style;
  let neededScale = 0; ctx.font = `${textSize}px ${family}`;
  if (typeof ctx.measureText === "function") for (const slot of window.slots) for (const row of slot.bar.levels) {
    if (row.filtered) continue;
    const kind = footprintValueKind(style.volumeMode, style.cellValues), half = kind === "delta" && style.volumeMode === "delta", negative = row.buyVolume - row.sellVolume < 0;
    const area = { left: half && !negative ? slot.axis : slot.left, right: half && negative ? slot.axis : slot.right, axis: slot.axis };
    for (const token of footprintTextTokens(row, style.volumeMode, style.cellValues, area, "left")) { const width = token.right - token.left; if (width > 0) neededScale = Math.max(neededScale, (ctx.measureText(token.text).width + 7) / width); }
  }
  const digits = footprintPriceDigits(hit.view.step); ctx.font = bold;
  const priceWidth = Math.ceil((typeof ctx.measureText === "function" ? ctx.measureText(hit.upper.toFixed(digits)).width : 11 * hit.upper.toFixed(digits).length * .6) + 14) + 16;
  const hovered = window.slots[window.hoveredIndex], available = Math.max(80, Math.max(args.coords.width - 14 - (hovered.right + 44), hovered.left - 44 - 14) - priceWidth);
  const span = (slots: readonly FootprintMagnifierSlot[]) => slots.at(-1)!.right - slots[0].left;
  const scaleFor = (slots: readonly FootprintMagnifierSlot[]) => Math.max(neededScale, Math.min(verticalScale, 10, available / span(slots)));
  let slots = window.slots, hoveredIndex = window.hoveredIndex, horizontalScale = scaleFor(slots);
  if (slots.length > 1 && span(slots) * horizontalScale > available) { slots = [hovered]; hoveredIndex = 0; horizontalScale = scaleFor(slots); }
  const bodyWidth = Math.min(span(slots) * horizontalScale, available), width = Math.ceil(bodyWidth + priceWidth), height = Math.ceil(bodyHeight + 36), centerY = (localTop + localBottom) / 2;
  const trial = footprintMagnifierPosition(hit.rect.x, hit.rect.x + hit.rect.width, centerY, width, height, args.coords.width, args.bounds.height);
  const shift = trial.top + height / 2 - centerY, below = Math.abs(shift) > 16 ? shift > 0 : centerY < args.bounds.height / 2, anchorY = centerY + (below ? 16 : -16);
  const position = footprintMagnifierPosition(hit.rect.x, hit.rect.x + hit.rect.width, anchorY, width, height, args.coords.width, args.bounds.height);
  const x = position.left, y = position.top, left = x + 8, top = y + 8, focus = slots[hoveredIndex], fits = span(slots) * horizontalScale <= bodyWidth;
  const origin = fits ? slots[0].left : (focus.left + focus.right) / 2, destination = fits ? left : left + bodyWidth / 2;
  const focusedY = clamp(anchorY, top + Math.min(enlargedRow, bodyHeight) / 2, top + bodyHeight - Math.min(enlargedRow, bodyHeight) / 2);
  const mapX = (value: number) => destination + (value - origin) * horizontalScale, mapY = (value: number) => focusedY + (value - centerY) * verticalScale;
  const [r, g, b] = tpoColorRgba(args.theme.background ?? "#131722"), colors = .2126 * r + .7152 * g + .0722 * b >= 128 ? light : dark, slotWidth = Math.max(1, hit.rect.width);
  ctx.globalAlpha = 1; ctx.fillStyle = colors.highlightBg; ctx.fillRect(hit.rect.x, hit.rect.y, slotWidth, rowHeight);
  ctx.strokeStyle = colors.ink; ctx.lineWidth = 1; ctx.strokeRect(Math.round(hit.rect.x) + .5, paneTop + Math.round(localTop) + .5, Math.max(0, Math.round(slotWidth) - 1), Math.max(0, Math.round(rowHeight) - 1));
  if (position.clear) {
    const from = position.side === "right" ? hit.rect.x + hit.rect.width : hit.rect.x, to = position.side === "right" ? x : x + width, room = Math.max(0, Math.abs(to - from) - 12), elbow = from + (position.side === "right" ? 1 : -1) * Math.min(Math.abs(focusedY - centerY), room);
    ctx.strokeStyle = colors.leader; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(from, paneTop + centerY); ctx.lineTo(elbow, paneTop + focusedY); ctx.lineTo(to, paneTop + focusedY); ctx.stroke();
    if (typeof ctx.arc === "function") { ctx.beginPath(); ctx.arc(from, paneTop + centerY, 3, 0, 2 * Math.PI); ctx.fillStyle = colors.ink; ctx.fill(); ctx.strokeStyle = colors.panelBg; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  const box = (border = false) => { if (typeof ctx.roundRect === "function" && typeof ctx.fill === "function") { ctx.beginPath(); ctx.roundRect(x + (border ? .5 : 0), paneTop + y + (border ? .5 : 0), width - Number(border), height - Number(border), 8); if (border) ctx.stroke(); else ctx.fill(); } else if (border) ctx.strokeRect(x + .5, paneTop + y + .5, width - 1, height - 1); else ctx.fillRect(x, paneTop + y, width, height); };
  ctx.save(); ctx.fillStyle = colors.panelBg; box(); ctx.strokeStyle = colors.panelBorder; ctx.lineWidth = 1; box(true);
  ctx.save(); ctx.beginPath(); ctx.rect(left, paneTop + top, bodyWidth, bodyHeight); ctx.clip();
  const overrides: Record<string, unknown> = { timeToX: (time: number) => mapX(footprintBarGeometry(args, time, hit.view.placement).center), priceToY: (price: number) => paneTop + mapY(args.coords.priceToY(price, args.scale, args.bounds) - paneTop) };
  const coords = new Proxy(args.coords, { get(target, key) { if (typeof key === "string" && Object.hasOwn(overrides, key)) return overrides[key]; const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } });
  const ownArgs: RendererLayerArgs = { ...args, cursor: null, coords, bounds: { ...args.bounds, top: paneTop + top, height: bodyHeight } }, ownStyle = { ...style, candleVisible: false, statisticsVisible: false };
  for (const slot of slots) paintFootprintBar(ctx, ownArgs, slot.bar, undefined, hit.view.step, ownStyle, { width: (slot.right - slot.left) * horizontalScale, offset: 0, within: true }, undefined, textSize);
  ctx.globalAlpha = 1; ctx.strokeStyle = colors.ink; ctx.lineWidth = 1; ctx.strokeRect(Math.round(mapX(hit.rect.x)) + .5, paneTop + Math.round(mapY(localTop)) + .5, Math.round(slotWidth * horizontalScale) - 1, Math.round(enlargedRow) - 1); ctx.restore();
  ctx.textBaseline = "middle"; ctx.textAlign = "right";
  const rowRange = Math.min(64, Math.max(16, Math.ceil(bodyHeight / Math.max(6, enlargedRow))));
  for (let row = -rowRange; row <= rowRange; row++) { const price = hit.lower + row * hit.view.step, middle = mapY((args.coords.priceToY(price, args.scale, args.bounds) + args.coords.priceToY(price + hit.view.step, args.scale, args.bounds)) / 2 - paneTop); if (middle < top + 5.5 || middle > top + bodyHeight - 5.5) continue; ctx.font = row === 0 ? bold : font; ctx.fillStyle = row === 0 ? colors.ink : colors.labelInk; ctx.fillText(price.toFixed(digits), x + width - 8, paneTop + middle); }
  const separatorY = paneTop + Math.round(top + bodyHeight) + .5; ctx.strokeStyle = colors.separator; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 8, separatorY); ctx.lineTo(x + width - 8, separatorY); ctx.stroke(); ctx.textAlign = "center";
  const minuteLabels = slots.filter(slot => slot.time !== null).map(slot => { const d = new Date(slot.time!); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; });
  const subMinute = new Set(minuteLabels).size < minuteLabels.length;
  slots.forEach((slot, index) => { if (slot.time === null) return; const date = new Date(slot.time), base = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`, time = subMinute ? `${base}:${String(date.getUTCSeconds()).padStart(2, "0")}` : base; ctx.font = index === hoveredIndex ? bold : font; ctx.fillStyle = index === hoveredIndex ? colors.ink : colors.labelInk; ctx.fillText(time, clamp(mapX(slot.axis), left + 16, left + bodyWidth - 16), paneTop + top + bodyHeight + 10); });
  ctx.restore(); ctx.globalAlpha = 1;
  return { x, y: paneTop + y, width, height, bodyWidth, bodyHeight, textSize, verticalScale, horizontalScale, profiles: slots.length };
}
