import { Drawing, registerDrawingType, getDrawingType, type DrawingTypeKey, type Projector, type SerializedDrawing, type VelaTheme, type SettingsSchema } from "@luxalgo/vela";
import { contextForCanvas } from "@/lib/chart/cellContext";
import { clearStudyNotice, drawingNoticeAlive, drawingNoticeOwner, routeStudyNotice } from "@/lib/chart/studyNotices";
import { executionRangeSource, watchExecutionRange } from "@/lib/orderflow/executionRangeSource";
import { defaultTails, resolveTails, type TailsSettings, type TailDrawing } from "@/lib/orderflow/volumeTails";
import { paintTailDrawing } from "@/lib/orderflow/volumeTailsRenderer";
import { FixedTailsCache } from "@/lib/orderflow/fixedTails";
import { ProfileTradeCollection } from "@/lib/orderflow/profileTradeCollection";
import type { Tick } from "@/types/trading";

// The pinned SDK's public registry accepts extensions; its type alias lists built-ins.
export const FIXED_TAILS_TYPE = "af-fixed-tails" as DrawingTypeKey;
interface DrawingProjector extends Projector { afCanvas?: HTMLCanvasElement; afRepaint?: () => void }
interface Retained { context: string; trades: ProfileTradeCollection; failure: string; size: number }
const retained = new Map<string, Retained>(); let retainedCount = 0;
function touch(key: string, entry: Retained) {
  if (retained.get(key) !== entry) return;
  retainedCount += entry.trades.size - entry.size; entry.size = entry.trades.size;
  retained.delete(key); retained.set(key, entry);
  while (retained.size > 64 || retainedCount > 250000) {
    const first = retained.keys().next().value!; retainedCount -= retained.get(first)!.size; retained.delete(first);
  }
}
export class FixedVolumeTails extends Drawing {
  readonly type = FIXED_TAILS_TYPE;
  tails = defaultTails(); followLatest = false;
  private cache = new FixedTailsCache(); private last: TailDrawing | null = null;
  private noticeOwner?: object;
  private retainedKey = ""; private retainedEntry?: Retained;
  private observe = (tick: Tick) => {
    const entry = this.retainedEntry; if (!entry || retained.get(this.retainedKey) !== entry || entry.failure) return;
    try { entry.trades.add([tick]); touch(this.retainedKey, entry); } catch (error) { entry.failure = error instanceof Error ? error.message : "Invalid collected execution."; }
  };
  constructor(init: Partial<SerializedDrawing> & { paneId: string }) { super({ ...init, props: undefined }); this.readProps(init.props ?? {}); }
  anchorSchema() { return { min: 1, max: 2, slots: [{ role: "start", free: "x" as const }, { role: "end", free: "x" as const }] }; }
  timeExtent() { return this.followLatest || this.anchors.length < 2 ? null : super.timeExtent(); }
  protected readProps(props: Record<string, unknown>) {
    this.tails = resolveTails(props.tails && typeof props.tails === "object" ? props.tails as Record<string, unknown> : {});
    if (props.followLatest !== undefined && typeof props.followLatest !== "boolean") throw new Error("Invalid Volume Tails open-end setting.");
    this.followLatest = props.followLatest === true;
  }
  protected writeProps() { return { tails: { ...this.tails }, followLatest: this.followLatest }; }
  schema(): SettingsSchema {
    return { fields: [
      { path: "tails.threshold", label: "Threshold %", kind: "number", min: .1, max: 100, step: .1, group: "behavior" },
      { path: "tails.resolution", label: "Resolution", kind: "number", min: 2, max: 500, step: 1, group: "behavior" },
      { path: "followLatest", label: "Open end (follow newest bar)", kind: "boolean", group: "behavior" },
      ...(["supply", "demand", "equilibrium"] as const).flatMap(side => {
        const title = side.charAt(0).toUpperCase() + side.slice(1);
        return [{ path: `tails.${side}Color`, label: `${title} color`, kind: "color" as const, group: "fill" as const },
          { path: `tails.${side}Area`, label: `${title} area`, kind: "boolean" as const, group: "fill" as const },
          { path: `tails.${side}Average`, label: `${title} average`, kind: "boolean" as const, group: "line" as const },
          { path: `tails.${side}Weighted`, label: `${title} weighted average`, kind: "boolean" as const, group: "line" as const }];
      }), { path: "locked", label: "Locked", kind: "boolean", group: "behavior" },
    ] };
  }
  /** No stale result survives a missing source or an unavailable Replay prefix. */
  compute(projector: Projector): { drawing: TailDrawing | null; message: string } {
    this.last = null;
    if (!this.anchors.length) return { drawing: null, message: "Choose the starting candle." };
    const native = projector as DrawingProjector, canvas = native.afCanvas, cell = canvas ? contextForCanvas(canvas) : undefined;
    watchExecutionRange(this, canvas, native.afRepaint, true, this.observe);
    try {
      const style = resolveTails(this.tails as unknown as Record<string, unknown>);
      const source = executionRangeSource(cell, projector.barsInRange?.(-Infinity, Infinity) ?? []);
      this.retainedKey = JSON.stringify([cell!.id, cell!.symbol, this.id]);
      let entry = retained.get(this.retainedKey);
      if (!entry || entry.context !== source.context) {
        if (entry) retainedCount -= entry.size;
        entry = { context: source.context, trades: new ProfileTradeCollection(), failure: "", size: 0 }; retained.set(this.retainedKey, entry);
      }
      this.retainedEntry = entry;
      if (entry.failure) throw new Error(entry.failure);
      try { entry.trades.add(source.execution.trades); } catch (error) { entry.failure = error instanceof Error ? error.message : "Invalid collected executions."; throw error; }
      touch(this.retainedKey, entry);
      this.last = this.cache.read(this.anchors, this.followLatest, source.bars, source.execution.timeframe, entry.trades.snapshot(), style, cell!.symbol, source.context, cell?.replay ? cell.replayThrough ?? undefined : undefined);
      return { drawing: this.last, message: this.last ? `${source.label} · ${this.last.observations} executions · volume ${this.last.total}${this.last.supply && !this.last.supply.reached || this.last.demand && !this.last.demand.reached ? " · Side volume below threshold" : ""}` : "No observed classified executions inside these anchors; missing history is unknown." };
    } catch (error) { return { drawing: null, message: `Fixed Volume Tails unavailable: ${error instanceof Error ? error.message : "Invalid source."}` }; }
  }
  private report(projector: DrawingProjector, message: string): boolean {
    const canvas = projector.afCanvas, cell = canvas ? contextForCanvas(canvas) : undefined;
    if (!canvas || !cell) { if (this.noticeOwner) clearStudyNotice(this.noticeOwner); return false; }
    this.noticeOwner = drawingNoticeOwner(cell.id, cell.symbol, this.id);
    return routeStudyNotice(this.noticeOwner, cell, "Fixed Range Volume Tails", message, drawingNoticeAlive(cell.symbol, this.id, () => canvas.isConnected && this.visible));
  }
  afPaint(ctx: CanvasRenderingContext2D, projector: Projector, theme: VelaTheme) {
    const { drawing, message } = this.compute(projector);
    if (drawing) paintTailDrawing(ctx, drawing, this.tails, { x: t => projector.xOf(t), y: p => projector.yOf(p, this.paneId) ?? NaN });
    const pane = projector.paneRect?.(this.paneId) ?? { top: 0, height: projector.height };
    ctx.save(); ctx.strokeStyle = this.style.lineColor; ctx.lineWidth = 1; ctx.globalAlpha = .7; ctx.setLineDash([4, 4]);
    for (const anchor of this.anchors) { const x = projector.xOf(anchor.time); ctx.beginPath(); ctx.moveTo(x, pane.top); ctx.lineTo(x, pane.top + pane.height); ctx.stroke(); }
    ctx.restore();
    if (!this.report(projector as DrawingProjector, message)) {
      ctx.save(); ctx.globalAlpha = 1; ctx.font = "10px sans-serif"; ctx.fillStyle = theme.textColor;
      ctx.fillText(message, 8, pane.top + pane.height - 10, Math.max(1, projector.width - 16)); ctx.restore();
    }
  }
  handlePoints(projector: Projector): Array<[number, number]> {
    const pane = projector.paneRect?.(this.paneId) ?? { top: 0, height: projector.height };
    return this.anchors.map(anchor => [projector.xOf(anchor.time), pane.top + pane.height / 2]);
  }
  hitHandle(x: number, y: number, projector: Projector, tolerance: number) {
    const pane = projector.paneRect?.(this.paneId) ?? { top: 0, height: projector.height };
    return y < pane.top || y > pane.top + pane.height ? -1 : this.handlePoints(projector).findIndex(p => Math.abs(p[0] - x) <= tolerance + 3);
  }
  hitTest(x: number, y: number, projector: Projector, tolerance: number) {
    const pane = projector.paneRect?.(this.paneId) ?? { top: 0, height: projector.height };
    if (y < pane.top - tolerance || y > pane.top + pane.height + tolerance) return false;
    if (this.anchors.some(anchor => Math.abs(projector.xOf(anchor.time) - x) <= tolerance)) return true;
    if (!this.last || x < projector.xOf(this.last.start) || x > projector.xOf(this.last.end)) return false;
    return [this.last.supply, this.last.demand].some(tail => {
      if (!tail) return false; const a = projector.yOf(tail.low, this.paneId), b = projector.yOf(tail.high, this.paneId);
      return a !== null && b !== null && y >= Math.min(a, b) - tolerance && y <= Math.max(a, b) + tolerance;
    });
  }
  bounds(projector: Projector) {
    const pane = projector.paneRect?.(this.paneId) ?? { top: 0, height: projector.height };
    if (!this.anchors.length) return null;
    const x = Math.min(...this.anchors.map(a => projector.xOf(a.time))), right = this.followLatest || this.anchors.length === 1 ? projector.width : Math.max(...this.anchors.map(a => projector.xOf(a.time)));
    return { x, y: pane.top, w: Math.max(1, right - x), h: pane.height };
  }
  priceRange() { return this.last ? { min: this.last.min, max: this.last.max } : null; }
}
export function registerFixedTails() {
  if (getDrawingType(FIXED_TAILS_TYPE)) return;
  registerDrawingType({ type: FIXED_TAILS_TYPE, group: "measurements", label: "Fixed Range Volume Tails", placementHint: "Click start and end candles. Enter after the start leaves the end open.",
    icon: getDrawingType("fixedrangevp")?.icon ?? "", defaultStyle: { lineColor: "#787b86", lineWidth: 1, lineStyle: "dashed" }, create: init => new FixedVolumeTails(init) });
}
