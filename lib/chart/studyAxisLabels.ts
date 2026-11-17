import { seriesShownOn, type IndicatorModel, type RendererLayerArgs, type OHLCV } from "@luxalgo/vela";
import type { IndicatorInstance } from "@/types/trading";
type Scale = RendererLayerArgs["scale"];
interface Pane { id: string; kind: string; collapsed?: boolean; axisFormat?: string; scale: Scale; bounds: { top: number; height: number } }
export interface StudyAxisFrame {
  ctx: CanvasRenderingContext2D;
  scene: { bars: readonly OHLCV[]; showAxisLabels: boolean; showPriceLabel: boolean; showCountdown: boolean;
    indicators: ReadonlyMap<string, IndicatorModel>; panes: ReadonlyMap<string, Pane>; style: { fontSize: number };
    offsetOf(id: string): number; scaleFor(model: IndicatorModel, pane: Pane): Scale; ownScaleIndicatorsForPane(id: string): IndicatorModel[] };
  coords: Pick<RendererLayerArgs["coords"], "dpr" | "priceToY">;
  theme: RendererLayerArgs["theme"];
  dataW: number;
  panes: Pane[];
  axisX(column: number): number;
  format(value: number, scale: Scale, height: number, pane: Pane, own: boolean, model?: IndicatorModel): string;
}
export interface StudyAxisLabel {
  key: string; indicatorId: string; value: number; text: string; color: string;
  x: number; width: number; desiredY: number; y: number; top: number; bottom: number; columnKey: string;
}
export interface StudyAxisHost {
  read(): Array<{ indicator: IndicatorInstance; nativeId: string }>;
  subscribe(listener: () => void): () => void;
}
interface StudyAxisRenderer { setStudyAxisLabelPainter(painter: ((frame: StudyAxisFrame) => void) | null): void }

/** Current revealed chart slot only: never backfill a null/warm-up value or read a later Pine slot. */
export function studyAxisLabels(frame: StudyAxisFrame, policy: ReadonlyMap<string, IndicatorInstance>): StudyAxisLabel[] {
  const { scene, coords, panes } = frame, index = scene.bars.length - 1;
  if (!scene.showAxisLabels || index < 0) return [];
  const pricePane = panes.find(pane => pane.kind === "price"), result: StudyAxisLabel[] = [];
  for (const model of scene.indicators.values()) {
    const preference = policy.get(model.id);
    if (!preference || !preference.visible || preference.error || preference.valuesOnPriceScale === false) continue;
    const slot = index - scene.offsetOf(model.id); if (!Number.isInteger(slot) || slot < 0) continue;
    for (const series of model.series) {
      if (!seriesShownOn(series, "priceScale") || series.kind === "markers") continue;
      let value: number | undefined | null, color: string;
      if (series.kind === "candle" || series.kind === "bar") {
        const bar = series.bars[slot]; value = bar?.close;
        color = series.barColors?.[slot]?.color ?? (bar && bar.close >= bar.open ? series.style?.up ?? frame.theme.upColor : series.style?.down ?? frame.theme.downColor);
      } else if ("points" in series) {
        const point = series.points[slot]; value = point?.value;
        color = point?.color ?? series.style.color;
      } else continue;
      if (value === null || value === undefined || !Number.isFinite(value)) continue;
      const pane = series.overlay ? pricePane : scene.panes.get(model.paneId ?? series.paneId) ?? pricePane;
      if (!pane || pane.collapsed || pane.bounds.height < 18) continue;
      const scale = series.overlay ? pane.scale : scene.scaleFor(model, pane);
      const y = coords.priceToY(value, scale, pane.bounds);
      if (!Number.isFinite(y) || y < pane.bounds.top || y > pane.bounds.top + pane.bounds.height) continue;
      const ownIndex = model.ownScale && !series.overlay ? scene.ownScaleIndicatorsForPane(pane.id).findIndex(item => item.id === model.id) : -1;
      if (model.ownScale && !series.overlay && ownIndex < 0) continue;
      const column = ownIndex + 1, x = frame.axisX(column), nextX = frame.axisX(column + 1);
      const width = Math.min(nextX - x, frame.ctx.canvas.width / coords.dpr - x);
      if (!Number.isFinite(width) || width < 20) continue;
      const text = frame.format(value, scale, pane.bounds.height, pane, ownIndex >= 0, model);
      if (!text) continue;
      result.push({ key: `${model.id}:${series.id}`, indicatorId: model.id, value, color, text,
        desiredY: y, y, x, width, top: pane.bounds.top, bottom: pane.bounds.top + pane.bounds.height, columnKey: `${pane.id}:${column}` });
    }
  }
  return result;
}
/** Nearest free 18px slot; keep labels within their pane/column and reserve last-price/countdown chrome. */
export function placeStudyAxisLabels(frame: StudyAxisFrame, labels: readonly StudyAxisLabel[]): StudyAxisLabel[] {
  const occupied = new Map<string, Array<[number, number]>>(), placed: StudyAxisLabel[] = [];
  const pricePane = frame.panes.find(pane => pane.kind === "price"), last = frame.scene.bars.at(-1);
  if (pricePane && last && (frame.scene.showPriceLabel || frame.scene.showCountdown)) {
    const y = frame.coords.priceToY(last.close, pricePane.scale, pricePane.bounds);
    if (Number.isFinite(y)) occupied.set(`${pricePane.id}:0`, [[y - 11, y + (frame.scene.showPriceLabel && frame.scene.showCountdown ? 31 : 11)]]);
  }
  for (const label of [...labels].sort((a, b) => a.desiredY - b.desiredY || a.key.localeCompare(b.key))) {
    const taken = occupied.get(label.columnKey) ?? [], low = label.top + 9, high = label.bottom - 9;
    const candidates = [Math.max(low, Math.min(high, label.desiredY)), ...taken.flatMap(([from, to]) => [from - 10, to + 10])]
      .filter(y => y >= low && y <= high && taken.every(([from, to]) => y + 8 < from || y - 8 > to))
      .sort((a, b) => Math.abs(a - label.desiredY) - Math.abs(b - label.desiredY) || a - b);
    if (!candidates.length) continue;
    const y = candidates[0]; taken.push([y - 8, y + 8]); occupied.set(label.columnKey, taken); placed.push({ ...label, y });
  }
  return placed;
}
function ink(color: string): string {
  const hex = /^#([\da-f]{6}|[\da-f]{3})$/i.exec(color);
  const rgb = hex ? (hex[1].length === 3 ? [...hex[1]].map(value => value + value).join("") : hex[1]).match(/../g)!.map(value => parseInt(value, 16))
    : /^rgba?\(([^)]+)\)/i.exec(color)?.[1].split(/[,\s/]+/).slice(0, 3).map(Number);
  return rgb && rgb.length === 3 && rgb.every(Number.isFinite) && rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 160 ? "#131722" : "#ffffff";
}
export function paintStudyAxisLabels(frame: StudyAxisFrame, policy: ReadonlyMap<string, IndicatorInstance>): StudyAxisLabel[] {
  const labels = placeStudyAxisLabels(frame, studyAxisLabels(frame, policy)), { ctx } = frame;
  ctx.save();
  try {
    ctx.globalAlpha = 1; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.font = `${Math.max(9, Math.min(12, frame.scene.style.fontSize))}px ${frame.theme.fontFamily}`;
    for (const label of labels) {
      ctx.save();
      try {
        ctx.beginPath(); ctx.rect(label.x, label.top, label.width, label.bottom - label.top); ctx.clip();
        ctx.fillStyle = label.color; ctx.fillRect(label.x + 1, label.y - 8, label.width - 1, 16);
        if (Math.abs(label.y - label.desiredY) > 1) {
          ctx.strokeStyle = label.color; ctx.lineWidth = 1; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(label.x, label.desiredY); ctx.lineTo(label.x + 4, label.y); ctx.stroke();
        }
        ctx.fillStyle = ink(String(ctx.fillStyle)); ctx.fillText(label.text, label.x + 5, label.y, label.width - 9);
      } finally { ctx.restore(); }
    }
  } finally { ctx.restore(); }
  return labels;
}
/** Native chrome hook participates in ordinary frames AND screenshot composition; no indicator inputs/models are edited. */
export function bindStudyAxisLabels(renderer: unknown, host: StudyAxisHost): () => void {
  const target = renderer as StudyAxisRenderer;
  if (typeof target.setStudyAxisLabelPainter !== "function") throw new Error("The pinned Vela study-axis adapter is missing.");
  let disposed = false;
  const paint = (frame: StudyAxisFrame) => { if (!disposed) paintStudyAxisLabels(frame, new Map(host.read().map(value => [value.nativeId, value.indicator]))); };
  target.setStudyAxisLabelPainter(paint);
  const unsubscribe = host.subscribe(() => { if (!disposed) target.setStudyAxisLabelPainter(paint); });
  return () => { disposed = true; unsubscribe(); target.setStudyAxisLabelPainter(null); };
}
