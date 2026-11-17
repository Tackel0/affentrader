import { getDrawingType, registerDrawingType, type Drawing, type Projector } from "@luxalgo/vela";
import { FixedProfileCache, type FixedProfileResult } from "@/lib/orderflow/fixedProfileModel";
import { BackgroundProfile } from "@/lib/orderflow/backgroundProfile";
import { contextForCanvas } from "@/lib/chart/cellContext";
import { ExecutionRangeProfileCache } from "@/lib/orderflow/executionRangeProfile";
import { executionRangeSource, watchExecutionRange, type RangeVolumeSource } from "@/lib/orderflow/executionRangeSource";
import { clearStudyNotice, drawingNoticeAlive, drawingNoticeOwner, routeStudyNotice } from "@/lib/chart/studyNotices";

interface BackgroundProjector extends Projector { afCanvas?: HTMLCanvasElement; afRepaint?: () => void }

interface NativeFixedProfile extends Drawing {
  volumeSource: RangeVolumeSource;
  frvp: { rows: number; valueAreaPct: number; showDevelopingPoc: boolean; showDevelopingVa: boolean };
  cachedRange: { min: number; max: number } | null;
  frvpNotice?: string;
  afReportNotice?: (message?: string) => boolean;
  afNoticeOwner?: object;
  compute(projector: Projector): FixedProfileResult | null;
  layout(projector: Projector): { profile: FixedProfileResult["profile"]; yEdges: number[]; pocY: number | null; vahY: number | null; valY: number | null } | null;
}
const REGISTERED = Symbol.for("affentrader.fixed-profile-construction.v1");
// Drawing instances can be rehydrated by the renderer. Bound retained source copies
// across all live instances instead of letting every historical drawing pin 50k bars.
const caches = new Map<Drawing, { cache: FixedProfileCache; bars: number }>();
const executionCaches = new Map<Drawing, { cache: ExecutionRangeProfileCache; count: number }>();
let retainedExecutions = 0;
function executionCache(drawing: Drawing, count: number) {
  const entry = executionCaches.get(drawing) ?? { cache: new ExecutionRangeProfileCache(), count: 0 };
  retainedExecutions += count - entry.count; entry.count = count; executionCaches.delete(drawing); executionCaches.set(drawing, entry);
  while (executionCaches.size > 64 || retainedExecutions > 250000) { const first = executionCaches.keys().next().value!; retainedExecutions -= executionCaches.get(first)!.count; executionCaches.delete(first); }
  return entry.cache;
}
let retainedBars = 0;
function cache(drawing: Drawing, bars: number) {
  const existing = caches.get(drawing) ?? { cache: new FixedProfileCache(), bars: 0 };
  retainedBars += bars - existing.bars; existing.bars = bars;
  caches.delete(drawing); caches.set(drawing, existing);
  while (caches.size > 64 || retainedBars > 250000) {
    const oldest = caches.keys().next().value!;
    retainedBars -= caches.get(oldest)!.bars; caches.delete(oldest);
  }
  return existing.cache;
}
export function registerFixedProfileConstruction(): void {
  const entry = getDrawingType("fixedrangevp"); if (!entry) throw new Error("Native Fixed Range Volume Profile is unavailable.");
  if (Reflect.get(entry.create, REGISTERED)) return;
  const create: typeof entry.create = init => {
    const drawing = entry.create(init) as NativeFixedProfile;
    const background = new BackgroundProfile();
    const serialize = drawing.serialize.bind(drawing), applyProps = drawing.applyProps.bind(drawing), schema = drawing.schema.bind(drawing), priceRange = drawing.priceRange.bind(drawing);
    drawing.volumeSource = init.props?.volumeSource === "Classified executions" ? "Classified executions" : "OHLCV estimate";
    drawing.priceRange = () => drawing.volumeSource === "Classified executions" ? drawing.cachedRange : priceRange();
    drawing.serialize = () => { const doc = serialize(); return { ...doc, props: { ...doc.props, volumeSource: drawing.volumeSource } }; };
    drawing.applyProps = props => { applyProps(props); if (props.volumeSource === "Classified executions" || props.volumeSource === "OHLCV estimate") drawing.volumeSource = props.volumeSource; };
    drawing.schema = () => ({ ...schema(), fields: [...schema().fields, { path: "volumeSource", label: "Volume source", kind: "select", group: "behavior", options: [{ value: "OHLCV estimate", label: "OHLCV estimate" }, { value: "Classified executions", label: "Classified executions" }] }] });
    const options = () => ({ rows: drawing.frvp.rows, valueAreaPct: drawing.frvp.valueAreaPct,
      developing: drawing.frvp.showDevelopingPoc || drawing.frvp.showDevelopingVa });
    drawing.compute = projector => {
      drawing.cachedRange = null; drawing.frvpNotice = "";
      const [a, b] = drawing.anchors; if (!a || !b) return null;
      try {
        const bars = projector.barsInRange?.(Math.min(a.time, b.time), Math.max(a.time, b.time)) ?? [];
        const asyncProjector = projector as BackgroundProjector;
        const { afCanvas: canvas, afRepaint: repaint } = asyncProjector;
        const cell = canvas ? contextForCanvas(canvas) : undefined;
        if (canvas && cell) { drawing.afNoticeOwner = drawingNoticeOwner(cell.id, cell.symbol, drawing.id); drawing.afReportNotice = message => routeStudyNotice(drawing.afNoticeOwner!, cell, "Fixed Range Volume Profile", message ?? "", drawingNoticeAlive(cell.symbol, drawing.id, () => canvas.isConnected && drawing.visible)); }
        else { drawing.afReportNotice = undefined; if (drawing.afNoticeOwner) clearStudyNotice(drawing.afNoticeOwner); }
        watchExecutionRange(drawing, canvas, repaint, drawing.volumeSource === "Classified executions");
        if (drawing.volumeSource === "Classified executions") {
          const source = executionRangeSource(canvas ? contextForCanvas(canvas) : undefined, bars), settings = options();
          const selection = () => JSON.stringify([drawing.anchors, drawing.volumeSource, source.context]);
          const pending = canvas && repaint && (source.execution.trades.length > 10000 || settings.developing && source.bars.length > 200) ? background.read(source.bars, settings, selection(), () => {
            if (!canvas.isConnected || drawing.volumeSource !== "Classified executions") return null;
            try { const [a, b] = drawing.anchors; if (!a || !b) return null; const current = executionRangeSource(contextForCanvas(canvas), projector.barsInRange?.(Math.min(a.time, b.time), Math.max(a.time, b.time)) ?? []);
              return { bars: current.bars, options: options(), context: JSON.stringify([drawing.anchors, drawing.volumeSource, current.context]), execution: current.execution }; } catch { return null; }
          }, repaint, source.execution) : null;
          if (pending?.notice) { drawing.frvpNotice = pending.notice; return null; }
          const result = pending ? pending.result : executionCache(drawing, source.execution.trades.length).read(source.bars, settings, source.execution.trades, source.execution.timeframe);
          drawing.frvpNotice = result ? `Classified executions · ${source.label} · ${result.executions} trades · buys ${result.buys} · sells ${result.sells} · delta ${result.delta}` : "No observed classified executions in this range. Missing history is unknown.";
          if (result) drawing.cachedRange = { min: result.profile.edges[0], max: result.profile.edges.at(-1)! };
          return result;
        }
        const selection = () => JSON.stringify([drawing.anchors, canvas ? contextForCanvas(canvas) : null]);
        const settings = options();
        // Tiny ranges and capacity errors remain immediate; large prefix grids use the same math in a worker.
        const async = settings.developing && bars.length > 200 && bars.length <= 5000 && canvas && repaint;
        const pending = async ? background.read(bars, settings, selection(), () => {
          if (!canvas.isConnected) return null;
          const [start, end] = drawing.anchors; if (!start || !end) return null;
          return { bars: projector.barsInRange?.(Math.min(start.time, end.time), Math.max(start.time, end.time)) ?? [], options: options(), context: selection() };
        }, repaint) : null;
        if (pending?.notice) { drawing.frvpNotice = pending.notice; return null; }
        const result = pending ? pending.result : cache(drawing, Math.min(bars.length, 50000)).read(bars, settings);
        drawing.frvpNotice = result ? `OHLCV estimate · ${result.bars} loaded bars · volume ${Number(result.total.toPrecision(7))}${result.rejected ? ` · ${result.rejected} invalid bars excluded` : ""}` : "No loaded volume in this range.";
        if (result) drawing.cachedRange = { min: result.profile.edges[0], max: result.profile.edges.at(-1)! };
        return result;
      } catch (error) { drawing.frvpNotice = `Fixed profile unavailable: ${error instanceof Error ? error.message : "Invalid data."}`; return null; }
    };
    const layout = drawing.layout.bind(drawing);
    drawing.layout = projector => {
      const result = layout(projector); if (!result) return null;
      const { profile } = result, project = (price: number) => projector.yOf(price, drawing.paneId);
      const edges = profile.edges.map(project); if (edges.some(edge => edge == null)) return null;
      return { ...result, yEdges: edges as number[], pocY: project(profile.centers[profile.poc]), vahY: project(profile.edges[profile.vaTo + 1]), valY: project(profile.edges[profile.vaFrom]) };
    };
    return drawing;
  };
  Object.defineProperty(create, REGISTERED, { value: true }); registerDrawingType({ ...entry, create });
}
