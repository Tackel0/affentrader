import type { InputSchema, InputValue, NativeIndicatorContext, NativeIndicatorDescriptor } from "@luxalgo/vela";
import type { Tick } from "@/types/trading";
import { nativeReplayBoundary } from "@/lib/chart/replayClock";
import { stripVenue } from "@/lib/market/service";
import { footprintSettings, resolveFootprint, type ResolvedFootprintPreferences } from "./footprint";
import { createFootprintGridSource, footprintGridNotice } from "./footprintGrid";
import type { PriceGridLoader } from "@/lib/market/priceGridMetadata";
import { FootprintHistory } from "./footprintHistory";
import type { StudyArchiveOptions } from "./studyTradeSource";
export type FootprintOverlayKind = "bar" | "visible";
export const FOOTPRINT_OVERLAY_IDS = { bar: "af-footprint-overlay", visible: "af-visible-footprint" } as const;
export const FOOTPRINT_OVERLAY_TITLES = { bar: "Footprint", visible: "Visible Range Footprint" } as const;
const text = (value: string | { defaultMessage: string }) => typeof value === "string" ? value : value.defaultMessage;
function rows(kind: FootprintOverlayKind) {
  return kind === "bar" ? footprintSettings().rows! : footprintSettings().subsections![0].rows;
}
const keyOf = (kind: FootprintOverlayKind, key: string) => kind === "visible" && key.startsWith("vr") ? key[2].toLowerCase() + key.slice(3) : key;
function normalized(kind: FootprintOverlayKind, values: Record<string, unknown>) {
  const result = { ...values };
  for (const row of rows(kind)) if (row.kind === "select") for (const option of row.options) {
    if (Array.isArray(option) && result[keyOf(kind, row.key)] === text(option[1])) result[keyOf(kind, row.key)] = option[0];
  }
  return result;
}
export function footprintOverlayInputs(kind: FootprintOverlayKind): InputSchema[] {
  const inputs: InputSchema[] = []; let group = "";
  const calculation = new Set(["position", "rowMode", "rowTicks", "rowSize", "rowHeight", "imbalanceRatio", "imbalancePercent", "imbalanceMinVolume", "ignoreZeroOpposite", "averageTradeSize", "widthPercent", "alignment"]);
  for (const row of rows(kind)) {
    if (row.kind === "heading") group = text(row.label);
    if (!("key" in row) || ["candleVisible", "vrEnabled"].includes(row.key)) continue;
    const key = keyOf(kind, row.key);
    if (row.kind === "number" || row.kind === "toggle" || row.kind === "select" || row.kind === "color") {
      const options = row.kind === "select" ? row.options.map(option => typeof option === "string" ? option : text(option[1])) : undefined;
      const defval = row.kind === "select" ? row.options.find(option => Array.isArray(option) && option[0] === row.defval) : undefined;
      inputs.push({ key, title: text(row.label), type: row.kind === "toggle" ? "bool" : row.kind === "color" ? "color" : row.kind === "select" ? "string" : ["rowHeight", "textSize", "imbalancePercent", "imbalanceWidth", "stackedRows", "unfinishedWidth", "pocWidth", "valueAreaWidth", "statisticsSize"].includes(key) ? "int" : "float",
        defval: Array.isArray(defval) ? text(defval[1]) : row.defval, group, ...(!calculation.has(key) ? { tab: "Style" } : {}),
        ...(row.kind === "number" ? { min: row.min, max: row.max, step: row.step } : {}), ...(options ? { options } : {}) });
      if ("colors" in row) for (const color of row.colors ?? []) inputs.push({ key: keyOf(kind, color.key), title: text(color.label), type: "color", defval: color.defval, tab: "Style", group });
    }
  }
  if (kind === "visible") inputs.unshift({ key: "alignment", title: "Alignment", type: "string", defval: "Right", options: ["Right", "Left"] });
  return inputs;
}
export function footprintOverlayInputVisible(kind: FootprintOverlayKind, key: string, values: Record<string, unknown>) {
  const row = rows(kind).find(row => "key" in row && keyOf(kind, row.key) === key);
  if (!row || !("when" in row) || !row.when) return true;
  const style = resolveFootprintOverlay(kind, values).style as unknown as Record<string, InputValue>;
  return ("key" in row.when ? [row.when] : row.when).every(condition => {
    const value = style[keyOf(kind, condition.key)];
    return condition.anyOf ? condition.anyOf.includes(value) : value === condition.equals;
  });
}
export function resolveFootprintOverlay(kind: FootprintOverlayKind, values: Record<string, unknown>) {
  const value = normalized(kind, values), style = { ...resolveFootprint(value), candleVisible: false };
  if (kind === "visible") { style.pocExtend = false; style.stackedVisible = false; style.unfinishedVisible = false; }
  return { style, alignment: value.alignment === "Left" || value.alignment === "left" ? "left" as const : "right" as const,
    widthPercent: typeof value.widthPercent === "number" && Number.isFinite(value.widthPercent) && value.widthPercent >= 5 && value.widthPercent <= 90 ? value.widthPercent : 30 };
}
export interface FootprintOverlayChannel {
  kind: FootprintOverlayKind; id: string; history?: FootprintHistory; style?: ResolvedFootprintPreferences; alignment: "left" | "right"; widthPercent: number;
  message: string; repaint?: () => void; identity?: { symbol: string; timeframe: string; live: boolean; through: number | null; revision: string | number };
  priceTick?: number; priceTickSource?: string;
}
export function footprintOverlayDescriptor(kind: FootprintOverlayKind, read: (symbol: string) => readonly Tick[], subscribe: (symbol: string, receive: (tick: Tick) => void) => () => void, archive: StudyArchiveOptions = {}, loadGrid?: PriceGridLoader): NativeIndicatorDescriptor {
  return { type: FOOTPRINT_OVERLAY_IDS[kind], title: FOOTPRINT_OVERLAY_TITLES[kind], shortTitle: kind === "bar" ? "Footprint" : "VR Footprint", overlay: true, paneHint: "price", multiInstance: true,
    inputsSchema: () => footprintOverlayInputs(kind), defaultInputs: () => Object.fromEntries(footprintOverlayInputs(kind).map(input => [input.key, input.defval])), create: () => {
      let context: NativeIndicatorContext | undefined, values: Record<string, InputValue> = {}, active = false, published = false, key = "", failure = "", generation = 0, listening = "";
      let off: (() => void) | undefined, offArchive: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
      const channel: FootprintOverlayChannel = { kind, id: "", alignment: "right", widthPercent: 30, message: "Waiting for classified executions." };
      const grid = loadGrid ? createFootprintGridSource(() => compute(true), loadGrid) : undefined;
      const detach = () => { generation++; off?.(); off = undefined; offArchive?.(); offArchive = undefined; if (timer !== undefined) clearTimeout(timer); timer = undefined; listening = ""; };
      const publish = (nativeFrame = false) => { if (!context || !active) return; if (!published || nativeFrame) { published = true; context.pushData(channel); } else channel.repaint?.(); };
      const attach = () => {
        if (!active || !context) return;
        const next = JSON.stringify([context.symbol, context.timeframe, context.live]); if (listening === next) return;
        detach(); listening = next; const token = generation;
        offArchive = archive.subscribe?.(context.symbol, () => { if (active && token === generation) compute(); });
        const sameMarket = (tickSymbol: string, ctxSymbol: string) => tickSymbol === ctxSymbol || tickSymbol === stripVenue(ctxSymbol);
        if (context.live) off = subscribe(context.symbol, tick => {
          if (!active || token !== generation || !context || !sameMarket(tick.symbol, context.symbol)) return;
          try { channel.history?.add([tick]); } catch (error) { failure = error instanceof Error ? error.message : "Invalid footprint data."; }
          if (timer === undefined) timer = setTimeout(() => { timer = undefined; if (token === generation) compute(); }, 50);
        });
      };
      const compute = (nativeFrame = false) => {
        if (!active || !context) return;
        try {
          const resolved = resolveFootprintOverlay(kind, values), replay = context.live ? undefined : archive.replay?.(context), revision = archive.revision?.(context.symbol) ?? 0;
          channel.id = context.id; channel.identity = { symbol: context.symbol, timeframe: context.timeframe, live: context.live, through: replay?.through ?? (context.live ? null : nativeReplayBoundary(context)), revision };
          if (!context.live && !replay) throw new Error("Replay needs a loaded classified execution archive at the completed-bar boundary.");
          const next = JSON.stringify([context.symbol, context.timeframe, context.live, replay?.through, revision]);
          const expectedSymbol = stripVenue(context.symbol);
          if (key !== next) { key = next; failure = ""; channel.history = new FootprintHistory(context.timeframe); channel.history.add((replay?.trades ?? read(context.symbol)).filter(tick => tick.symbol === context!.symbol || tick.symbol === expectedSymbol)); }
          if (failure) throw new Error(failure);
          channel.style = resolved.style; channel.alignment = resolved.alignment; channel.widthPercent = resolved.widthPercent;
          const coverage = channel.history!.coverage;
          const precision = grid?.read({ symbol: context.symbol, price: context.bars().at(-1)?.close, simulated: coverage.simulated,
            scope: JSON.stringify([context.timeframe, context.live, revision]), required: !(resolved.style.rowSize > 0) });
          channel.priceTick = precision?.tick; channel.priceTickSource = precision?.source;
          channel.message = `${coverage.simulated ? "SIMULATED · " : ""}Partial collected executions · ${coverage.trades} observations${coverage.dropped ? " · older candles evicted" : ""}; missing history remains unknown.${replay?.label ?? archive.label?.(context.symbol) ?? ""}`;
          channel.message += ` · ${precision ? footprintGridNotice(precision, !context.live) : resolved.style.rowSize > 0 ? "Explicit price row override" : "Waiting for verified venue price-grid metadata"}`;
          context.setStatus(precision?.pending && !channel.priceTick ? "loading" : context.live && coverage.trades && (resolved.style.rowSize > 0 || channel.priceTick) ? "live" : "idle");
        } catch (error) { failure = error instanceof Error ? error.message : "Invalid footprint data."; channel.history = undefined; channel.style = undefined; channel.priceTick = undefined; channel.priceTickSource = undefined; channel.message = `${FOOTPRINT_OVERLAY_TITLES[kind]} unavailable: ${failure}`; context.setStatus("idle"); }
        publish(nativeFrame); attach();
      };
      return { start(ctx, inputs) { detach(); grid?.reset(); context = ctx; values = inputs; active = true; published = false; key = ""; failure = ""; channel.history = undefined; channel.priceTick = undefined; ctx.emit({}); compute(); },
        onBars: compute, onViewport() {}, setInputs(inputs) { values = inputs; if (failure) key = ""; compute(true); },
        suspend() { active = false; detach(); grid?.dispose(); channel.history = undefined; channel.style = undefined; channel.priceTick = undefined; key = ""; published = false; context?.pushData(null); },
        resume() { active = true; grid?.reset(); compute(); }, stop() { active = false; detach(); grid?.dispose(); channel.history = undefined; channel.style = undefined; channel.priceTick = undefined; channel.repaint = undefined; published = false; context?.pushData(null); context = undefined; } };
    } };
}
