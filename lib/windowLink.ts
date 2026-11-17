import { findIndicator } from "@/lib/indicators/catalog";
import { isValidInterval, normalizeInterval } from "@/lib/market/intervals";
import { isSymbolId } from "@/lib/symbolId";
import { isLinkGroup, type LinkGroup } from "@/stores/useLinkStore";
import type { BottomTab, ChartType } from "@/types/trading";

const VALID_CHART_TYPES = new Set<ChartType>([
  "candles", "bars", "hollow", "volumecandles", "line", "linemarkers",
  "stepline", "area", "hlcarea", "baseline", "columns", "highlow",
  "heikinashi", "renko", "linebreak", "kagi", "range", "pointfigure",
  "footprint", "tpo",
]);

const VALID_BOTTOM_TABS = new Set<BottomTab>([
  "overview", "pine", "strategy", "orderflow", "trading", "dom",
  "portfolio", "screener", "news", "calendar", "heatmap", "terminal",
]);

export interface WorkspaceLinkAction {
  symbol?: string;
  timeframe?: string;
  chartType?: ChartType;
  bottomOpen?: boolean;
  bottomTab?: BottomTab;
  addIndicators?: string[];
  toast?: { title: string; message: string; tone?: "info" | "success" | "error" };
}

export type LinkMessage =
  | { type: "state"; from: string; group: LinkGroup; symbol: string; timeframe: string }
  | { type: "crosshair"; from: string; group: LinkGroup; point: { time: number; price: number | null; symbol?: string } | null }
  | ({ type: "workspace"; from: string; group: LinkGroup } & WorkspaceLinkAction);

/** Everything arriving on the channel is untrusted input from another tab: validate it fully. */
export function parseLinkMessage(data: unknown): LinkMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (typeof m.from !== "string" || m.from.length > 32 || !isLinkGroup(m.group) || m.group === "off") return null;
  if (m.type === "state") {
    if (typeof m.symbol !== "string" || !isSymbolId(m.symbol)) return null;
    if (typeof m.timeframe !== "string" || !isValidInterval(m.timeframe)) return null;
    return { type: "state", from: m.from, group: m.group, symbol: m.symbol, timeframe: normalizeInterval(m.timeframe) };
  }
  if (m.type === "crosshair") {
    if (m.point === null) return { type: "crosshair", from: m.from, group: m.group, point: null };
    const p = m.point as Record<string, unknown> | undefined;
    if (!p || typeof p.time !== "number" || !Number.isFinite(p.time)) return null;
    if (p.price !== null && (typeof p.price !== "number" || !Number.isFinite(p.price))) return null;
    return {
      type: "crosshair",
      from: m.from,
      group: m.group,
      point: {
        time: p.time,
        price: p.price as number | null,
        symbol: typeof p.symbol === "string" && isSymbolId(p.symbol) ? p.symbol : undefined,
      },
    };
  }
  if (m.type === "workspace") {
    const out: { type: "workspace"; from: string; group: LinkGroup } & WorkspaceLinkAction = {
      type: "workspace",
      from: m.from,
      group: m.group,
    };
    let hasAction = false;
    if (m.symbol !== undefined) {
      if (typeof m.symbol !== "string" || !isSymbolId(m.symbol)) return null;
      out.symbol = m.symbol;
      hasAction = true;
    }
    if (m.timeframe !== undefined) {
      if (typeof m.timeframe !== "string" || !isValidInterval(m.timeframe)) return null;
      out.timeframe = normalizeInterval(m.timeframe);
      hasAction = true;
    }
    if (m.chartType !== undefined) {
      if (typeof m.chartType !== "string" || !VALID_CHART_TYPES.has(m.chartType as ChartType)) return null;
      out.chartType = m.chartType as ChartType;
      hasAction = true;
    }
    if (m.bottomOpen !== undefined) {
      if (typeof m.bottomOpen !== "boolean") return null;
      out.bottomOpen = m.bottomOpen;
      hasAction = true;
    }
    if (m.bottomTab !== undefined) {
      if (typeof m.bottomTab !== "string" || !VALID_BOTTOM_TABS.has(m.bottomTab as BottomTab)) return null;
      out.bottomTab = m.bottomTab as BottomTab;
      hasAction = true;
    }
    if (m.addIndicators !== undefined) {
      if (!Array.isArray(m.addIndicators) || m.addIndicators.length > 10) return null;
      const validIds: string[] = [];
      for (const id of m.addIndicators) {
        if (typeof id !== "string" || !findIndicator(id)) return null;
        validIds.push(id);
      }
      out.addIndicators = validIds;
      hasAction = true;
    }
    if (m.toast !== undefined) {
      if (!m.toast || typeof m.toast !== "object") return null;
      const t = m.toast as Record<string, unknown>;
      if (typeof t.title !== "string" || typeof t.message !== "string") return null;
      const tone = t.tone === "success" || t.tone === "error" || t.tone === "info" ? t.tone : "info";
      out.toast = { title: t.title.slice(0, 80), message: t.message.slice(0, 240), tone };
    }
    return hasAction ? out : null;
  }
  return null;
}
