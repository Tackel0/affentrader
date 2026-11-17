import type { RendererLayerArgs } from "@luxalgo/vela";
import type { VolumeProfileModel } from "./volumeProfileModel";
import type { VolumeProfilePreferences } from "./volumeProfileSettings";
import { createProfilePocExtensionCache, type ProfilePocExtensions } from "./profilePocExtensions";

export interface VolumeProfilePayload { model?: VolumeProfileModel; style: VolumeProfilePreferences; message?: string; pending?: boolean; sourceLabel?: string; kind?: "rolling"; summary?: string; maximumWidth?: number; hoursBasis?: string; pocExtensions?: ProfilePocExtensions }
/** Stable SDK channel; trade-only updates invalidate its own canvas rather than every native price layer. */
export interface VolumeProfileContext { id: string; symbol: string; timeframe: string; epoch: number; live: boolean; replayThrough?: number; revision?: string | number; kind?: "rolling" }
export interface VolumeProfileChannel { current?: VolumeProfilePayload; context?: VolumeProfileContext; repaint?: () => void }
const priceLabel = (price: number) => price !== 0 && (Math.abs(price) < 1e-6 || Math.abs(price) >= 1e15)
  ? price.toExponential() : price.toLocaleString("en-US", { maximumSignificantDigits: 17 });
const audits = new WeakMap<object, string>();
const extensionCaches = new WeakMap<object, ReturnType<typeof createProfilePocExtensionCache>>();
export function paintVolumeProfiles(ctx: CanvasRenderingContext2D, args: RendererLayerArgs, payload: VolumeProfilePayload, report?: (message: string) => boolean) {
  const { coords, bounds, scale, theme } = args, { style, model } = payload;
  let extensions: ProfilePocExtensions = new Map();
  if (model && style.showPoc && style.extendPoc && payload.kind !== "rolling") {
    let cache=extensionCaches.get(ctx);if(!cache){cache=createProfilePocExtensionCache();extensionCaches.set(ctx,cache);}
    extensions=cache.read(args.bars,model.sessions);
  }
  ctx.save(); ctx.font = "10px ui-monospace, monospace"; ctx.textBaseline = "middle";
  if (model) for (const session of model.sessions) {
    const start = (style.sessionPeriod ?? "Day") !== "Day" && payload.kind !== "rolling" ? Math.max(session.start, session.firstTrade) : session.start;
    const left = coords.timeToX(start) + 3, right = coords.timeToX(session.end) - 3;
    if (right < 0 || left > coords.width || right <= left) continue;
    const observedRight = payload.kind === "rolling" ? right : session.end > (model.lastTrade ?? -Infinity) ? coords.timeToX(session.lastTrade) + 3 : right;
    const profileRight = Math.max(left + 1, Math.min(right, observedRight));
    const anchor = style.placement === "Session start" ? left : profileRight;
    const direction = style.placement === "Session start" ? 1 : -1;
    const width = Math.min(payload.maximumWidth ?? 220, (profileRight - left) * style.widthPercent / 100);
    const maximum = Math.max(...session.rows.map(row => style.volumeMode === "Delta" ? Math.abs(row.buy - row.sell) : row.total));
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("svp-frame-audit")) {
      const report = { placement: style.placement, histogram: style.showHistogram, left, right, observedRight, anchor, width, maximum,
        rows: session.rows.length, first: session.rows.find(row => row.total > 0), lastTrade: session.lastTrade, sourceLast: model.lastTrade };
      const signature = JSON.stringify([style.placement, style.showHistogram, Math.round(left), Math.round(right), Math.round(anchor), Math.round(width)]);
      if (audits.get(ctx) !== signature) { audits.set(ctx, signature); console.debug("[svp-frame-audit]", JSON.stringify(report)); }
    }
    session.rows.forEach((row, index) => {
      if (!row.total || !style.showHistogram || maximum === 0) return;
      const a = coords.priceToY(row.price, scale, bounds), b = coords.priceToY(session.rowGrid?.[index]?.upper ?? row.price + session.step, scale, bounds);
      const top = Math.min(a, b), height = Math.max(1, Math.abs(a - b) - .5);
      if (top > bounds.top + bounds.height || top + height < bounds.top) return;
      const inArea = index >= session.valueArea.low && index <= session.valueArea.high;
      const buy = inArea && style.showValueArea ? style.buyColor : style.outsideBuyColor;
      const sell = inArea && style.showValueArea ? style.sellColor : style.outsideSellColor;
      const rect = (offset: number, amount: number, color: string) => {
        if (amount <= 0) return;
        ctx.fillStyle = color; ctx.globalAlpha = .65;
        const start = anchor + direction * offset; ctx.fillRect(direction > 0 ? start : start - amount, top, amount, height);
      };
      if (style.volumeMode === "Buy/Sell") {
        const first = width * row.buy / maximum; rect(0, first, buy); rect(first, width * row.sell / maximum, sell);
      } else if (style.volumeMode === "Total") rect(0, width * row.total / maximum, buy);
      else rect(0, width * Math.abs(row.buy - row.sell) / maximum, row.buy >= row.sell ? buy : sell);
    });
    ctx.globalAlpha = 1;
    const labels: Array<{ y: number; color: string; text: string }> = [];
    const line = (price: number, color: string, title: string, thickness = 1) => {
      const y = coords.priceToY(price, scale, bounds); ctx.strokeStyle = color; ctx.lineWidth = thickness;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      if (style.showLabels && y >= bounds.top + 10 && y <= bounds.top + bounds.height - 10) {
        labels.push({ y: y - 7, color, text: `${title} ${priceLabel(price)}` });
      }
    };
    if (style.showPoc) line(session.rowGrid?.[session.valueArea.poc]?.center ?? session.rows[session.valueArea.poc].price + session.step / 2, style.pocColor, "POC", 1.5);
    if (style.showValueArea) {
      line(session.rows[session.valueArea.low].price, style.valueLineColor, "VAL");
      line(session.rowGrid?.[session.valueArea.high]?.upper ?? session.rows[session.valueArea.high].price + session.step, style.valueLineColor, "VAH");
    }
    if (style.showNodes && session.nodes?.length) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      for (const node of session.nodes.slice(0, 6)) {
        const y = coords.priceToY(node.price + session.step / 2, scale, bounds);
        if (!Number.isFinite(y) || y < bounds.top + 8 || y > bounds.top + bounds.height - 8) continue;
        const color = node.kind === "HVN" ? "#38bdf8" : "#f59e0b";
        ctx.strokeStyle = color;
        ctx.globalAlpha = node.kind === "HVN" ? .55 : .65;
        ctx.beginPath();
        ctx.moveTo(left, Math.round(y) + .5);
        ctx.lineTo(right, Math.round(y) + .5);
        ctx.stroke();
        if (style.showLabels) labels.push({ y: y - 7, color, text: `${node.kind} ${priceLabel(node.price + session.step / 2)}` });
      }
      ctx.restore();
    }
    if (payload.kind !== "rolling" && session.developing?.length && (style.showDevelopingPoc || style.showDevelopingValueArea)) {
      const points = session.developing;
      // Bound the last step by the revealed chart, including its newest candle.
      const lastBar = args.bars.at(-1), previousBar = args.bars.at(-2);
      const chartEnd = lastBar ? lastBar.time + (previousBar ? lastBar.time - previousBar.time : 0) : session.lastTrade;
      const end = coords.timeToX(Math.min(session.end, chartEnd));
      ctx.save(); ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
      const steps = (key: "poc" | "val" | "vah", color: string, alpha: number) => {
        ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.beginPath();
        points.forEach((point, index) => {
          const x = coords.timeToX(point.time), y = Math.round(coords.priceToY(point[key], scale, bounds)) + .5;
          if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          ctx.lineTo(Math.max(x, index + 1 < points.length ? coords.timeToX(points[index + 1].time) : end), y);
        });
        ctx.stroke();
      };
      if (style.showDevelopingPoc) steps("poc", style.pocColor, .85);
      if (style.showDevelopingValueArea) { steps("vah", style.valueLineColor, .6); steps("val", style.valueLineColor, .6); }
      ctx.restore();
    }
    labels.sort((a, b) => a.y - b.y);
    for (let i = 0; i < labels.length; i++) labels[i].y = Math.max(bounds.top + 8, labels[i].y, i ? labels[i - 1].y + 12 : 0);
    for (let i = labels.length - 1; i >= 0; i--) labels[i].y = Math.min(labels[i].y, i < labels.length - 1 ? labels[i + 1].y - 12 : bounds.top + bounds.height - 8);
    for (const label of labels) {
      ctx.fillStyle = label.color; ctx.textAlign = "left"; const x = Math.max(4, left + 3);
      ctx.fillText(label.text, x, label.y, Math.max(1, Math.min(right, coords.width) - x - 4));
    }
  }
  for (const extension of extensions.values()) {
    const from=Math.max(0,coords.timeToX(extension.from)),to=extension.touched===null?coords.width:Math.min(coords.width,coords.timeToX(extension.touched));
    if(to<=from||from>=coords.width)continue;
    const y=coords.priceToY(extension.price,scale,bounds);if(y<bounds.top||y>bounds.top+bounds.height)continue;
    ctx.strokeStyle=style.pocColor;ctx.lineWidth=1;ctx.globalAlpha=.6;
    ctx.beginPath();ctx.moveTo(from,Math.round(y)+.5);ctx.lineTo(to,Math.round(y)+.5);ctx.stroke();ctx.globalAlpha=1;
  }
  const summary = payload.message || payload.summary || (model ? `SVP · ${model.source === "simulation" ? "SIMULATED · " : ""}${model.retained} collected trades · partial history${payload.pending ? " · updating" : ""}. ${payload.sourceLabel ?? "Recording gaps remain unknown."}` : "Waiting for collected session executions.");
  if (report?.(summary)) { ctx.restore(); return extensions; }
  ctx.globalAlpha = 1; ctx.textAlign = "left";
  ctx.fillStyle = theme.background ?? "#131722";
  ctx.fillRect(8, bounds.top + bounds.height - (payload.message ? 57 : 29), Math.max(1, coords.width - 16), payload.message ? 57 : 29);
  ctx.fillStyle = theme.textColor;
  if (payload.message) {
    const words = payload.message.split(" "); let line = "", y = bounds.top + bounds.height - 45;
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > coords.width - 24 && line) { ctx.fillText(line, 12, y); y += 13; line = word; } else line = next;
    }
    if (line) ctx.fillText(line, 12, y, Math.max(1, coords.width - 24));
  } else if (model) {
    const stamp = (time: number) => new Date(time).toISOString().slice(5, 16).replace("T", " ");
    const note = payload.summary ?? `SVP · ${payload.sourceLabel?.startsWith("REPLAY") ? "REPLAY recorded" : model.source === "simulation" ? "SIMULATED" : "collected"} · ${model.retained.toLocaleString("en-US")} trades · partial history${payload.pending ? " · updating" : ""}`;
    ctx.fillText(note, 12, bounds.top + bounds.height - 20, Math.max(1, coords.width - 24));
    if (model.firstTrade !== null && model.lastTrade !== null) ctx.fillText(`${stamp(model.firstTrade)}–${stamp(model.lastTrade)} UTC${model.discarded ? ` · ${model.discarded} excluded` : ""}${payload.sourceLabel ? " · includes archive; gaps possible" : ""}`, 12, bounds.top + bounds.height - 7, Math.max(1, coords.width - 24));
  }
  ctx.restore();
  return extensions;
}
