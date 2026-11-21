import type { DataWindowReadout, DataWindowGroup, DataWindowRow, Vela } from "@luxalgo/vela";
import { readFootprintSurface, readFootprintOverlaySurfaces, type FootprintReadout } from "@/lib/orderflow/footprintReadout";
import { readSessionProfileSurfaces, type SessionProfileReadout } from "@/lib/orderflow/sessionProfileReadout";
import { readVisibleProfileSurfaces, type VisibleProfileReadout } from "@/lib/orderflow/visibleProfileReadout";
import { readTpoSurface, readTpoOverlaySurfaces, type TpoReadout, type TpoSeriesRange } from "@/lib/orderflow/tpoReadout";
import { depthHeatmapReadout } from "@/lib/orderflow/depthHeatmapReadout";
export interface IdentifiedReadoutGroup extends DataWindowGroup { id?: string; legendRows?: DataWindowRow[] }
export type ChartReadout = Omit<DataWindowReadout, "groups"> & { groups: IdentifiedReadoutGroup[]; barTime?: number; seriesRange?: TpoSeriesRange };
export interface DataWindowContext {
  symbol: string;
  timeframe: string;
  zone: string;
  replay: boolean;
  replayThrough?: number | null;
  recovering: boolean;
  error: string | null;
  indicatorIds?: Record<string, string>;
  chartType?: string;
  marketEpoch?: number;
  profileSourceStamp?: string;
  visibleProfileStyles?: Record<string, string>;
  depthSource?: string;
}
export interface DataWindowView extends DataWindowContext {
  status: "ready" | "loading" | "recovering" | "unavailable" | "error";
  readout: ChartReadout | null;
  footprint?: FootprintReadout;
  sessionProfiles?: SessionProfileReadout[];
  visibleProfiles?: VisibleProfileReadout[];
  tpo?: TpoReadout;
  tpoOverlays?: ReturnType<typeof readTpoOverlaySurfaces>;
  footprintOverlays?: ReturnType<typeof readFootprintOverlaySurfaces>;
  depth?: ReturnType<typeof depthHeatmapReadout>;
}
export interface DataWindowHost {
  read(): DataWindowContext;
  subscribe(listener: () => void): () => void;
}

/** Observe the renderer's actual readout, including its revealed Replay series and pane formatting. */
export function bindDataWindow(chart: Pick<Vela, "renderer" | "on" | "market"> & Partial<Pick<Vela, "getVisibleRange">>, host: DataWindowHost, publish: (view: DataWindowView) => void): () => void {
  let disposed = false, loading = false, queued = false, signature = "";
  let frame: number | null = null;
  const depthCursorScope = (context: DataWindowContext) => JSON.stringify([
    context.symbol, context.timeframe, context.marketEpoch, context.depthSource, context.replay,
    context.replay ? context.replayThrough : null,
  ]);
  let hover: { time: number; price: number; scope: string } | null = null;
  const refresh = () => {
    if (disposed) return;
    const context = host.read();
    if (hover && hover.scope !== depthCursorScope(context)) hover = null;
    const status = context.error ? "error" : loading || chart.market.symbol !== context.symbol || chart.market.timeframe !== context.timeframe ? "loading"
      : context.recovering && !context.replay ? "recovering" : "ready";
    const observed = (status === "ready" ? chart.renderer.dataWindowReadout() : null) as ChartReadout | null;
    const native = observed && (observed.ohlc || observed.groups.some(group => group.rows.length || group.legendRows?.length)) ? observed : null;
    const readout = native ? { ...native, ohlc: native.ohlc ? { ...native.ohlc } : null,
      groups: native.groups.map(group => ({ ...group, rows: group.rows.map(row => ({ ...row })),
        ...(group.legendRows ? { legendRows: group.legendRows.map(row => ({ ...row })) } : {}) })) } : null;
    const view: DataWindowView = { ...context, status: status === "ready" && !readout ? "unavailable" : status, readout,
      ...(context.chartType === "footprint" && readout && status === "ready" ? { footprint: readFootprintSurface("primary",
        { ...context, epoch: context.marketEpoch ?? 0, sourceStamp: context.profileSourceStamp }, readout.barTime) } : {}) };
    if (readout && status === "ready") view.sessionProfiles = readSessionProfileSurfaces("primary",
      { ...context, epoch: context.marketEpoch ?? 0 }, readout.barTime, Object.values(context.indicatorIds ?? {}));
    if (readout && status === "ready") view.visibleProfiles = readVisibleProfileSurfaces("primary",
      { ...context, epoch: context.marketEpoch ?? 0, sourceStamp: context.profileSourceStamp, styles: context.visibleProfileStyles, viewport: chart.getVisibleRange?.() }, Object.values(context.indicatorIds ?? {}));
    if (readout && status === "ready" && context.chartType === "tpo") view.tpo = readTpoSurface("primary", { ...context, epoch: context.marketEpoch ?? 0, seriesRange: readout.seriesRange }, readout.barTime);
    if (readout && status === "ready") view.tpoOverlays = readTpoOverlaySurfaces("primary", { ...context, epoch: context.marketEpoch ?? 0, seriesRange: readout.seriesRange }, readout.barTime, Object.values(context.indicatorIds ?? {}));
    if (readout && status === "ready") view.footprintOverlays = readFootprintOverlaySurfaces("primary", { ...context, epoch: context.marketEpoch ?? 0, sourceStamp: context.profileSourceStamp }, readout.barTime, Object.values(context.indicatorIds ?? {}));
    if (readout && status === "ready" && hover && hover.time === readout.barTime && context.depthSource) {
      view.depth = depthHeatmapReadout("primary", {
        symbol: context.symbol, timeframe: context.timeframe, live: !context.replay,
        source: context.depthSource, replayThrough: context.replay ? context.replayThrough ?? null : null,
      }, hover.time, hover.price);
    }
    const next = JSON.stringify(view);
    if (next !== signature) { signature = next; publish(view); }
  };
  const schedule = () => {
    if (disposed || queued) return;
    queued = true;
    const run = () => { frame = null; queued = false; refresh(); };
    if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(run);
    else queueMicrotask(run);
  };
  const off = [host.subscribe(schedule), chart.renderer.onCrosshairMove(event => {
    const context = host.read();
    const time = event?.ohlc?.time ?? event?.time ?? null;
    hover = !loading && chart.market.symbol === context.symbol && chart.market.timeframe === context.timeframe
      && event?.paneKind === "price" && time !== null && event.price !== null
      ? { time, price: event.price, scope: depthCursorScope(context) }
      : null;
    schedule();
  }), chart.renderer.onConfigChanged(schedule),
    chart.on("load:start", () => { loading = true; hover = null; schedule(); }), chart.on("load:end", () => { loading = false; schedule(); })];
  for (const event of ["bar", "market:changed", "history:complete", "context:changed", "indicator:added", "indicator:removed", "pane:changed", "replay:start", "replay:step", "replay:tick", "replay:end"] as const)
    off.push(chart.on(event, schedule));
  // Native plot updates can settle after the bar event, without a scripting-engine event.
  const timer = setInterval(() => { if (!queued) refresh(); }, 250);
  refresh();
  return () => {
    disposed = true;
    if (frame !== null) cancelAnimationFrame(frame);
    clearInterval(timer);
    off.forEach(dispose => dispose());
  };
}

/** Link values only by stable native handle id; duplicate titles and series order are irrelevant. */
export function indicatorLegendValues(view: DataWindowView | null): Record<string, DataWindowRow[]> {
  if (view?.status !== "ready" || !view.readout) return Object.create(null);
  const groups = new Map(view.readout.groups.filter(group => group.id).map(group => [group.id, group]));
  return Object.assign(Object.create(null), Object.fromEntries(Object.entries(view.indicatorIds ?? {}).flatMap(([id, nativeId]) => {
    const rows = groups.get(nativeId)?.legendRows;
    return rows?.length ? [[id, rows]] : [];
  })));
}

/** One native binding regardless of how many host surfaces consume the readout. */
export function createChartReadoutStore(subscribeChart: (listener: (chart: Pick<Vela, "renderer" | "on" | "market"> | null) => void) => () => void, host: DataWindowHost) {
  let snapshot: DataWindowView | null = null, detach: (() => void) | undefined, detachChart: (() => void) | undefined;
  let legendView: DataWindowView | null = null;
  let legendRows: Record<string, DataWindowRow[]> = Object.create(null);
  let epoch = 0;
  const listeners = new Set<() => void>();
  const publish = (view: DataWindowView | null) => { snapshot = view; listeners.forEach(listener => listener()); };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: (): DataWindowView | null => null,
    getLegendRows(id: string): readonly DataWindowRow[] | undefined {
      if (legendView !== snapshot) {
        const next = indicatorLegendValues(snapshot);
        for (const [key, rows] of Object.entries(next)) {
          const previous = legendRows[key];
          if (previous?.length === rows.length && rows.every((row, i) =>
            row.label === previous[i].label && row.value === previous[i].value && row.color === previous[i].color)) next[key] = previous;
        }
        legendRows = next;
        legendView = snapshot;
      }
      return legendRows[id];
    },
    subscribe(listener: () => void) {
      const notify = () => listener();
      listeners.add(notify);
      const generation = listeners.size === 1 ? ++epoch : epoch;
      if (listeners.size === 1) detachChart = subscribeChart(chart => {
        if (generation !== epoch || !listeners.size) return;
        detach?.(); detach = undefined; publish(null);
        if (chart) detach = bindDataWindow(chart, host, publish);
      });
      return () => {
        if (!listeners.delete(notify)) return;
        if (!listeners.size) {
          epoch++; detachChart?.(); detach?.(); detachChart = detach = undefined; snapshot = null;
          legendView = null; legendRows = Object.create(null);
        }
      };
    },
  };
}
