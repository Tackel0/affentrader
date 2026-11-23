"use client";
import {currentPriceAlertDraft} from "@/lib/alerts/priceDraft";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createStore } from "zustand/vanilla";
import type {
  Vela,
  IndicatorHandle,
  OHLCV,
  NativeIndicatorContext,
  LineLikeSeries,
} from "@luxalgo/vela";
import { marketService } from "@/lib/market/service";
import { MAX_HISTORY_BARS } from "@/lib/market/klines";
import { useChartStore } from "@/stores/useChartStore";
import { useAlertStore } from "@/stores/useAlertStore";
import { INDICATORS } from "@/lib/indicators/catalog";
import { nativeIndicatorInputs as makeInputs } from "@/lib/indicators/nativeInputs";
import { bindPineEngine } from "@/lib/indicators/engineOptions";
import {installTradingSettings} from "@/lib/chart/tradingSettings";
import {rangePlan,navigationDepth,dateWindow,recentWindow} from "@/lib/chart/ranges";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { bindDrawingDocuments } from "@/lib/drawings/documentBinding";
import { bindReplayCommands } from "@/lib/chart/replayCommands";
import { usePaperStore } from "@/stores/usePaperStore";
import { chartTheme } from "@/lib/chart/theme";
import {captureChartSnapshot} from "@/lib/chart/snapshot";
import {bindSnapshotChart,captureVisibleLayout,snapshotSource} from "@/lib/chart/snapshotRegistry";
import {describeSymbol} from "@/lib/symbols";
import { bindCellContext, requestChartPaint } from "@/lib/chart/cellContext";
import { bindReplayClock, completedReplayBoundary } from "@/lib/chart/replayClock";
import { currentWorkspaceReplay, workspaceReplay } from "@/lib/chart/workspaceReplay";
import { chartDataCsv } from "@/lib/chart/chartDataCsv";
import { isChartControl, priceScaleGesture } from "@/lib/chart/controls";
import { applyTimezone } from "@/lib/chart/timezone";
import { footprintBarCount, footprintWindow } from "@/lib/orderflow/layout";
import { bindDrawingPreferences, nativeDrawingTool } from "@/lib/drawings/preferences";
import { invalidateCanvasLayers } from "@/lib/chart/canvasLayer";
import { bindPriceScale, priceScaleHost } from "@/lib/chart/priceScale";
import { bindStudyAxisLabels } from "@/lib/chart/studyAxisLabels";
import { bindNativeChartType, chartTypeHost } from "@/lib/chart/nativeChartType";
import { bindNativeLayoutMode } from "@/lib/chart/nativeLayoutMode";
import { bindDerivedSettingsPaint } from "@/lib/chart/derivedSettings";
import { bindSeriesPreferences, seriesPreferencesHost } from "@/lib/chart/seriesBinding";
import { bindTpoSessionMenu } from "@/lib/orderflow/tpoSessionMenu";
import { bindFootprintMenu } from "@/lib/orderflow/footprintMenu";
import { bindChartAppearance, chartAppearanceHost } from "@/lib/chart/appearanceBinding";
import { bindChartView, chartViewHost } from "@/lib/chart/viewBinding";
import { indicatorExecutionSignature } from "@/lib/indicators/presentation";
import { trackChartFeed } from "@/lib/chart/feedSettlement";
import { frameRecentView } from "@/lib/chart/recentNavigation";
import { tpoWindow } from "@/lib/orderflow/tpoModel";
import { intervalMs, isTickInterval } from "@/lib/market/intervals";
import { bindLinkedCrosshair, publishLinkedCrosshair } from "@/lib/chart/crosshairLink";
import { bindLinkedViewport } from "@/lib/chart/viewportLink";
export const indicatorHandles = new Map<string, IndicatorHandle>();
let primaryChart: Vela | null = null;
const primaryListeners = new Set<(chart: Vela | null) => void>();
function publishPrimaryChart(chart: Vela | null) {
  primaryChart = chart;
  primaryListeners.forEach(listener => listener(chart));
}
export function subscribePrimaryChart(listener: (chart: Vela | null) => void) {
  primaryListeners.add(listener);
  listener(primaryChart);
  return () => { primaryListeners.delete(listener); };
}
/** The active workspace chart, for panels that act on its drawings. */
export function getPrimaryChart(): Vela | null {
  return primaryChart;
}
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production")
  (window as unknown as Record<string, unknown>).__afChart = getPrimaryChart;
export function useVelaChart(container: RefObject<HTMLDivElement | null>) {
  const [chart, setChart] = useState<Vela | null>(null);
  const [loading, setLoading] = useState(true);
  const [readout] = useState(() => createStore<{ hovered: OHLCV | null; replayBar: OHLCV | null }>()(() => ({ hovered: null, replayBar: null })));
  const hoverFrame = useRef<number | null>(null);
  const clearHover = () => {
    if (hoverFrame.current !== null) cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = null;
    if (readout.getState().hovered) readout.setState({ hovered: null });
  };
  const setReplayBar = (replayBar: OHLCV | null) => {
    if (readout.getState().replayBar !== replayBar) readout.setState({ replayBar });
  };
  const symbol = useChartStore((s) => s.symbol),
    timeframe = useChartStore((s) => s.timeframe),
    chartType = useChartStore((s) => s.chartType),
    drawing = useChartStore((s) => s.drawing),
    indicators = useChartStore((s) => s.indicators),
    command = useChartStore((s) => s.command),
    feedEpoch = useChartStore((s) => s.feedEpoch);
  const signatures = useRef(new Map<string, string>());
  const identity = useRef<{ symbol: string; timeframe: string } | null>(null);
  const restoringDrawings = useRef(false), marketChange = useRef(0);
  const first = useRef(true);
  const constructedEpoch = useRef<number | null>(null);
  const navigationSerial=useRef(0);
  const replaySerial=useRef(0);
  const explicitRange=useRef<{symbol:string;timeframe:string}|null>(null);
  const nativeHistory=useRef<{chart:Vela;oldestTime:number;barsLoaded:number;reason:string}|null>(null);
  const feeds = useRef(new WeakMap<Vela, ReturnType<typeof trackChartFeed>>());
  const isPhoneChartViewport = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(max-width: 768px) and (pointer: coarse), (max-width: 1024px) and (max-height: 520px) and (pointer: coarse)").matches;
  const navigateRecent = async (target: Vela, serial: number) => {
    const state = useChartStore.getState(), epoch = state.feedEpoch, revision = marketChange.current,
      owner = useWorkspaceStore.getState().activeId, replayRevision = replaySerial.current;
    const valid = () => navigationSerial.current === serial && marketChange.current === revision && getPrimaryChart() === target &&
      replaySerial.current === replayRevision && useWorkspaceStore.getState().activeId === owner &&
      useChartStore.getState().symbol === state.symbol && useChartStore.getState().timeframe === state.timeframe && useChartStore.getState().feedEpoch === epoch;
    setLoading(true);
    try {
      if (!target.replay.state.active && (target.market.symbol !== state.symbol || target.market.timeframe !== state.timeframe))
        await target.setMarket({ symbol: state.symbol, timeframe: state.timeframe, bars: isPhoneChartViewport() ? 300 : 600 });
      const framed = await frameRecentView(target, { valid,
        settled: market => feeds.current.get(target)?.settled(market) ?? Promise.resolve(false),
        read: () => { const current = useChartStore.getState(); return { bars: current.candles, timeframe: current.timeframe,
          chartType: current.chartType, width: container.current?.clientWidth ?? 0, symbol: current.symbol, tpo: current.seriesPreferences?.tpo }; } });
      if (framed) explicitRange.current = null;
    } catch (error) { if (valid()) state.toast("View reset failed", String(error), "error"); }
    finally { if (valid()) setLoading(false); }
  };
  useEffect(() => {
    let disposed = false;
    let instance: Vela | null = null;
    let terminatePine: (() => void) | undefined;
    const off: (() => void)[] = [];
    const initialize = async () => {
      try {
        setLoading(true);
        clearHover();
        setReplayBar(null);
        explicitRange.current=null;
        const [vela, plugins, fibonacci] = await Promise.all([
          import("@luxalgo/vela"),
          import("@/lib/orderflow/velaPlugins"),
          import("@/lib/drawings/fibonacciPlugin"),
        ]);
        if (disposed || !container.current) return;
        plugins.registerOrderflowPlugins();
        fibonacci.registerFibonacciConstruction();
        off.push(
          bindCellContext(container.current, () => ({
            id: "primary",
            symbol: useChartStore.getState().symbol,
            timeframe: useChartStore.getState().timeframe,
            replay: instance?.replay.state.active ?? false,
            replayThrough: instance ? completedReplayBoundary(instance.replay.state, useChartStore.getState().timeframe) : null,
          }), () => requestChartPaint(instance)),
        );
        off.push(bindDerivedSettingsPaint("primary"));
        const state = useChartStore.getState();
        restoringDrawings.current = true;
        identity.current = { symbol: state.symbol, timeframe: state.timeframe };
        constructedEpoch.current = state.feedEpoch;
        const trackedFeed = trackChartFeed(marketService.velaFeed);
        off.push(trackedFeed.close);
        const phoneChart = isPhoneChartViewport();
        instance = new vela.Vela(
          container.current,
          {
            symbol: state.symbol,
            timeframe: state.timeframe,
            bars: phoneChart ? 300 : 600,
            live: true,
            drawings: { toolbar: false },
            volume: false,
            priceStyle: state.chartType,
            logScale: state.logarithmic,
            theme: chartTheme(useWorkspaceStore.getState().theme),
            animations: phoneChart ? { intro: false, zoom: 0, pan: 0 } : { intro: false, zoom: 100, pan: 80 },
            currentPriceLine: true,
          },
          { dataFeed: trackedFeed.feed },
        );
        feeds.current.set(instance, trackedFeed);
        off.push(bindReplayClock(instance));
        terminatePine = bindPineEngine(instance);
        instance.renderer.set({ attribution: true, indicatorTitles: false });
        off.push(instance.on("history:complete",report=>{if(instance&&!disposed)nativeHistory.current={chart:instance,...report};}));
        off.push(bindPriceScale(instance, container.current, priceScaleHost(useWorkspaceStore.getState().activeId)));
        off.push(bindStudyAxisLabels(instance.renderer, {
          read: () => useChartStore.getState().indicators.flatMap(indicator => {
            const handle = indicatorHandles.get(indicator.id); return handle ? [{ indicator, nativeId: handle.id }] : [];
          }),
          subscribe: listener => useChartStore.subscribe((state, previous) => { if (state.indicators !== previous.indicators) listener(); }),
        }));
        instance.renderer.applyConfig({
          layout: { fontSize: 12 },
          crosshair: {
            color: "#9598a1",
            style: "dashed",
            width: 1,
            opacity: 0.65,
          },
        });
        installTradingSettings(instance);
        off.push(bindChartView(instance.renderer, chartViewHost(useWorkspaceStore.getState().activeId)));
        off.push(bindChartAppearance(instance, chartAppearanceHost(useWorkspaceStore.getState().activeId)));
        off.push(bindSeriesPreferences(instance.renderer, seriesPreferencesHost(useWorkspaceStore.getState().activeId)));
        off.push(bindTpoSessionMenu(container.current, instance.renderer, "primary"));
        off.push(bindFootprintMenu(container.current, instance.renderer, "primary"));
        off.push(bindNativeLayoutMode(instance.renderer));
        off.push(bindNativeChartType(instance, chartTypeHost(useWorkspaceStore.getState().activeId)));
        const syncReplay = () => {
          if (!instance) return;
          const shared = currentWorkspaceReplay();
          const state = shared?.replay.state ?? instance.replay.state;
          const bounds = shared?.replay.bounds ?? instance.replay.bounds;
          useWorkspaceStore.getState().setReplay({
            ...state,
            first: bounds?.first ?? null,
            last: bounds?.last ?? null,
          });
          if (!state.active) setReplayBar(null);
        };
        off.push(instance.on("replay:start",({cursorTime})=>{
          navigationSerial.current++;
          clearHover();
          syncReplay();
        }));
        off.push(instance.on("replay:end", ({ reason }) => {
          clearHover();
          if (!disposed && instance && (reason === "stopped" || reason === "finished"))
            void navigateRecent(instance, ++navigationSerial.current);
        }));
        for (const event of [
          "replay:step",
          "replay:play",
          "replay:pause",
          "replay:end",
          "load:end",
        ] as const)
          off.push(instance.on(event, syncReplay));
        off.push(
          instance.on("bar", (bar) => {
            if (instance?.replay.state.active) {
              setReplayBar(bar);
              if (getPrimaryChart() === instance && !currentWorkspaceReplay()?.starting) usePaperStore.getState().bar(useChartStore.getState().symbol, {
                time: bar.time,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
              });
            }
          }),
        );
        off.push(bindLinkedViewport(instance, "primary"));
        const sourceId = crypto.randomUUID();
        off.push(
          instance.renderer.onCrosshairMove((event) => {
            if (hoverFrame.current !== null) cancelAnimationFrame(hoverFrame.current);
            const market = instance?.market;
            const symbol = market?.symbol, timeframe = market?.timeframe;
            const { time, price, paneKind } = event;
            const hovered = event.ohlc && time !== null ? { ...event.ohlc, time } : null;
            hoverFrame.current = requestAnimationFrame(() => {
              hoverFrame.current = null;
              const state = useChartStore.getState();
              if (disposed || !instance || state.symbol !== symbol || state.timeframe !== timeframe ||
                instance.market.symbol !== symbol || instance.market.timeframe !== timeframe) return;
              if (readout.getState().hovered !== hovered) readout.setState({ hovered });
              publishLinkedCrosshair(time !== null && price !== null
                ? { time, price: paneKind === "study" ? null : price, source: sourceId, symbol }
                : null);
            });
          }),
        );
        off.push(bindLinkedCrosshair(instance, sourceId));
        off.push(bindDrawingDocuments(instance, {
          enabled: () => !restoringDrawings.current,
          read: () => { const current = useChartStore.getState(); return current.drawings[identity.current?.symbol ?? current.symbol]; },
          write: document => {
            const current = useChartStore.getState();
            current.set({ drawingsVersion: current.drawingsVersion + 1,
              drawings: { ...current.drawings, [identity.current?.symbol ?? current.symbol]: document } });
          },
          selected: ids => useChartStore.getState().set({ selectedDrawings: ids }),
        }));
        off.push(
          instance.on("drawing:tool", (e) => {
            if (restoringDrawings.current) return;
            const state = useChartStore.getState();
            const group = e.type ? vela.defaultToolbar().groups.find(g => g.tools.some(tool => tool.type === e.type)) : undefined;
            const remember = group && e.type && state.drawingPreferences.lastTools[group.id] !== e.type;
            if (nativeDrawingTool(state.drawing) !== e.type || remember)
              state.set({ drawing: e.type ?? "cursor", ...(remember ? { drawingPreferences: {
                ...state.drawingPreferences, lastTools: { ...state.drawingPreferences.lastTools, [group!.id]: e.type! },
              } } : {}) });
          }),
        );
        off.push(
          instance.on("indicator:error", (e) => {
            const id = [...indicatorHandles].find(
              ([, h]) => h.id === e.id,
            )?.[0];
            if (id)
              useChartStore
                .getState()
                .updateIndicator(id, { error: e.error.message });
          }),
        );
        const host = container.current;
        const scaleGesture = priceScaleGesture();
        const scaleClick = (event: MouseEvent) => {
          if (event.type === "dblclick" || event.detail > 1) { scaleGesture.cancel(); return; }
          const rect = host.getBoundingClientRect();
          if (event.clientX - rect.left < rect.width - 78) { scaleGesture.cancel(); return; }
          // Vela puts its own Auto/Log buttons over the bottom of the price scale; let them work.
          if (isChartControl(event.target)) { scaleGesture.cancel(); return; }
          const price = plugins.priceAtPoint(event.clientY - rect.top);
          if (price !== null && price > 0) {
            if (event.type === "contextmenu" || event.shiftKey) { event.preventDefault(); event.stopPropagation(); }
            const scope = useChartStore.getState();
            scaleGesture.handle(event, () => {
            const current = useChartStore.getState();
            if (current.symbol !== scope.symbol || current.timeframe !== scope.timeframe) return;
            if (event.shiftKey) {
              // Shift-click the price scale to stage a limit order at that price.
              usePaperStore.getState().setTicket({
                type: "limit",
                price: Number(price.toPrecision(8)),
              });
              useChartStore.getState().set({ bottomOpen: true, bottomTab: "trading" });
              return;
            }
            useChartStore
              .getState()
              .set({ alertDraft: currentPriceAlertDraft(Number(price.toPrecision(8))) });
            });
          }
        };
        host.addEventListener("click", scaleClick, true);
        host.addEventListener("contextmenu", scaleClick, true);
        host.addEventListener("dblclick", scaleClick, true);
        off.push(() => {
          scaleGesture.cancel();
          host.removeEventListener("dblclick", scaleClick, true);
          host.removeEventListener("click", scaleClick, true);
          host.removeEventListener("contextmenu", scaleClick, true);
        });
        off.push(useAlertStore.subscribe(() => invalidateCanvasLayers("primary")));
        first.current = true;
        await instance.ready();
        if (disposed) return;
        const catalog = await instance.availableNativeIndicators();
        const extras = catalog
          .filter(
            (c) =>
              !INDICATORS.some((d) => d.nativeId === c.type || d.id === c.type) &&
              !c.type.startsWith("af-"),
          )
          .map((c) => ({
            id: c.type,
            name: c.title,
            shortName: c.title,
            description: "Native Vela study",
            category: "Trend" as const,
            kind: "native" as const,
            nativeId: c.type,
            defaults:
              (vela.getNativeIndicator(c.type)?.defaultInputs() as Record<
                string,
                string | number | boolean
              >) ?? {},
          }));
        useChartStore
          .getState()
          .set({ nativeCatalog: extras, chartError: null });
        await instance.ready();
        if (disposed) return;
        const saved = useChartStore.getState().drawings[state.symbol];
        if (saved) instance.drawings.fromJSON(saved);
        restoringDrawings.current = false;
        const current = useChartStore.getState();
        current.set({ drawingsVersion: current.drawingsVersion + 1 });
        off.push(bindDrawingPreferences(instance, {
          read: () => useChartStore.getState().drawingPreferences,
          write: drawingPreferences => useChartStore.getState().set({ drawingPreferences }),
          subscribe: listener => useChartStore.subscribe((state, previous) => {
            if (state.drawingPreferences !== previous.drawingPreferences) listener(state.drawingPreferences);
          }),
        }));
        off.push(bindSnapshotChart(container.current!,{renderer:instance.renderer,read:()=>{
          const state=useChartStore.getState(),market=instance!.market;
          if(market.symbol!==state.symbol||market.timeframe!==state.timeframe)throw new Error("The active chart changed. Retry the snapshot.");
          const about=describeSymbol(state.symbol);return{symbol:state.symbol,title:`${about.title} · ${about.venue}`,timeframe:state.timeframe,source:snapshotSource(state.dataSources[`${state.symbol}:${state.timeframe}`],instance!.replay.state.active,Boolean(about.delayed))};
        }}));
        const shared = await workspaceReplay(); if (disposed) return;
        const joined = shared.register(useWorkspaceStore.getState().activeId, instance);
        off.push(joined.dispose, shared.subscribe(syncReplay));
        off.push(shared.controller.on("replay:start", () => {
          const state = useChartStore.getState(), cursor = shared.replay.state.cursorTime;
          usePaperStore.getState().startReplay(state.dataSources[`${state.symbol}:${state.timeframe}`] === "simulation");
          const bar = cursor === null ? undefined : state.candles.findLast(bar => bar.time <= cursor);
          if (bar) { setReplayBar(bar); usePaperStore.getState().bar(state.symbol, bar); }
        }));
        await joined.ready; if (disposed) return;
        publishPrimaryChart(instance);
        setChart(instance);
        syncReplay();
        setLoading(false);
      } catch (error) {
        if (!disposed) {
          restoringDrawings.current = false;
          useChartStore.getState().set({ chartError: String(error) });
          setLoading(false);
        }
      }
    };
    void initialize();
    return () => {
      disposed = true;
      clearHover();
      navigationSerial.current++;
      replaySerial.current++;
      nativeHistory.current=null;
      off.forEach((fn) => fn());
      try { instance?.destroy(); } finally { terminatePine?.(); }
      indicatorHandles.clear();
      signatures.current.clear();
      if (primaryChart === instance) publishPrimaryChart(null);
      setChart(null);
    };
  // Vela's depth-only setMarket path preserves existing bars. A new feed generation
  // needs a new native session so market and synthetic history cannot be spliced.
  }, [container,feedEpoch]);
  const timezone = useChartStore((s) => s.timezone);
  useEffect(() => {
    if (chart) applyTimezone(chart, timezone, symbol);
  }, [chart, timezone, symbol]);
  useEffect(() => {
    if (!chart) return;
    const shared = currentWorkspaceReplay(); if (!shared) return;
    return bindReplayCommands({ get market() { return chart.market; }, historyComplete: () => shared.historyComplete(), replay: shared.replay }, {
      pending: () => useWorkspaceStore.getState().replayCommand,
      claim(command) {
        if (useWorkspaceStore.getState().replayCommand !== command) return false;
        useWorkspaceStore.setState({ replayCommand: null }); return true;
      },
      subscribe: listener => useWorkspaceStore.subscribe(listener),
      advance: () => ++replaySerial.current,
      current: revision => replaySerial.current === revision && getPrimaryChart() === chart,
      environment() { const state = useChartStore.getState(); return { symbol: state.symbol, timeframe: state.timeframe,
        epoch: state.feedEpoch, owner: useWorkspaceStore.getState().activeId, bars: state.candles }; },
      present(bar) { const cursor = shared.replay.state.cursorTime; clearHover(); setReplayBar(cursor === null ? bar : useChartStore.getState().candles.findLast(value => value.time <= cursor) ?? null); },
      error: error => useChartStore.getState().toast("Replay failed", String(error), "error"),
    });
  }, [chart]);
  useEffect(() => {
    if (!chart) return;
    if(constructedEpoch.current!==feedEpoch)return;
    if(chart.market.symbol===symbol&&chart.market.timeframe===timeframe){first.current=false;identity.current={symbol,timeframe};return;}
    if (first.current) {
      first.current = false;
      if (
        chart.market.symbol === symbol &&
        chart.market.timeframe === timeframe &&
        constructedEpoch.current === feedEpoch
      )
        return;
    }
    let cancelled = false;
    const next = { symbol, timeframe };
    const sameMarket =
      chart.market.symbol === symbol && chart.market.timeframe === timeframe;
    const currentDepth = chart.market.bars ?? 600;
    const historyDepth = sameMarket
      ? currentDepth >= MAX_HISTORY_BARS
        ? MAX_HISTORY_BARS - 1
        : currentDepth + 1
      : 600;
    const committedDrawings = !restoringDrawings.current;
    restoringDrawings.current = true;
    const change = ++marketChange.current;
    if (identity.current?.symbol !== symbol) {
      const old = identity.current?.symbol;
      const state = useChartStore.getState();
      if (old && committedDrawings) state.set({
        drawings: { ...state.drawings, [old]: chart.drawings.toJSON() },
      });
      chart.drawings.fromJSON({ version: 1, drawings: [] });
    }
    identity.current = next;
    setLoading(true);
    clearHover();
    setReplayBar(null);
    useChartStore.getState().set({ chartError: null });
    void chart
      .setMarket({ symbol, timeframe, bars: historyDepth })
      .then(() => {
        if (!cancelled) {
          const saved = useChartStore.getState().drawings[symbol];
          chart.drawings.fromJSON(saved ?? { version: 1, drawings: [] });
          const state = useChartStore.getState();
          state.set({ drawingsVersion: state.drawingsVersion + 1, selectedDrawings: [] });
          if (useChartStore.getState().chartType === "footprint")
            focusFootprint(chart, container.current?.clientWidth ?? 0);
          else if (!sameMarket) {
            const bars = useChartStore.getState().candles;
            const from = (bars.at(-150) ?? bars[0])?.time;
            const to = bars.at(-1)?.time;
            if (from !== undefined && to !== undefined)
              chart.setVisibleRange({ from, to });
          }
          setLoading(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          chart.drawings.fromJSON(useChartStore.getState().drawings[symbol] ?? { version: 1, drawings: [] });
          setLoading(false);
          useChartStore.getState().set({ chartError: String(error) });
        }
      }).finally(() => {
        if (change === marketChange.current) restoringDrawings.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [chart, symbol, timeframe, feedEpoch]);
  useEffect(() => {
    if (!chart) return;
    chart.renderer.set("priceStyle", chartType);
    if (chartType === "footprint" && !(explicitRange.current?.symbol===symbol&&explicitRange.current.timeframe===timeframe)) focusFootprint(chart, container.current?.clientWidth ?? 0);
    if (chartType === "tpo" && !(explicitRange.current?.symbol===symbol&&explicitRange.current.timeframe===timeframe)) {
      const current = useChartStore.getState(), cursor = chart.replay.state.active ? chart.replay.state.cursorTime ?? -1 : undefined;
      const bars = cursor === undefined ? current.candles : current.candles.filter(bar => bar.time <= cursor);
      const window = tpoWindow(bars, current.seriesPreferences?.tpo, current.symbol); if (window) chart.setVisibleRange(window);
    }
    const block = useChartStore.getState().seriesPreferences?.tpo?.blockMinutes ?? "30";
    if (chartType === "tpo" && !isTickInterval(timeframe) && intervalMs(timeframe) > Number(block) * 60000) {
      const finer = block === "5" ? "1m" : block === "15" ? "5m" : block === "60" ? "30m" : "15m";
      useChartStore.getState().set({ timeframe: finer });
      useChartStore
        .getState()
        .toast(
          "TPO interval",
          `Using ${finer} bars to build ${block}-minute time-price opportunities.`,
        );
    }
  }, [chart, chartType, timeframe]);
  useEffect(() => {
    if (chart) {
      if (chart.drawings.getTool() !== nativeDrawingTool(drawing)) chart.drawings.setTool(nativeDrawingTool(drawing));
      chart.renderer.focus();
    }
  }, [chart, drawing]);
  useEffect(() => {
    if (!chart) return;
    let disposed = false;
    const sync = async () => {
      const vela = await import("@luxalgo/vela");
      if (disposed) return;
      for (const handle of chart.indicators()) {
        const owner = [...indicatorHandles].find(([, h]) => h.id === handle.id)?.[0];
        if (owner && indicators.some((i) => i.id === owner)) continue;
        const target = indicators.find(
          (i) =>
            i.id === handle.id ||
            handle.nativeType === `af-styled-${i.id}` ||
            ([...INDICATORS, ...useChartStore.getState().nativeCatalog].find(
              (d) => d.id === i.definitionId,
            )?.nativeId === handle.nativeType &&
              handle.nativeType !== undefined),
        );
        if (!target) {
          handle.remove();
          continue;
        }
        const mapped = indicatorHandles.get(target.id);
        if (!mapped) indicatorHandles.set(target.id, handle);
        else if (mapped.id !== handle.id) handle.remove();
      }
      for (const [id, h] of indicatorHandles)
        if (!indicators.some((i) => i.id === id)) {
          h.remove();
          indicatorHandles.delete(id);
          signatures.current.delete(id);
        }
      for (const indicator of indicators) {
        const signature = indicatorExecutionSignature(indicator);
        if (signatures.current.get(indicator.id) === signature) continue;
        const definition = [
          ...INDICATORS,
          ...useChartStore.getState().nativeCatalog,
        ].find((d) => d.id === indicator.definitionId);
        const source = indicator.script ?? definition?.script;
        let handle = indicatorHandles.get(indicator.id);
        try {
          if (!handle) {
            if (source)
              handle = chart.addIndicator(source, {
                id: indicator.id,
                title: indicator.name,
                inputs: indicator.inputs,
              });
            else if (definition?.nativeId) {
              const descriptor = vela.getNativeIndicator(definition.nativeId);
              if (!descriptor)
                throw new Error(
                  `Study ${definition.nativeId} unavailable in installed Vela`,
                );
              const styledType = `af-styled-${indicator.id}`;
              if (
                !definition.nativeId.startsWith("af-") &&
                !["volume", "vpvr"].includes(definition.nativeId)
              ) {
                vela.registerNativeIndicator(
                  Object.assign(Object.create(descriptor), {
                    type: styledType,
                    create: () => {
                      const native = descriptor.create();
                      const originalStart = native.start.bind(native);
                      native.start = (ctx, inputs) => {
                        const wrapped: NativeIndicatorContext = {
                          ...ctx,
                          emit: (out) => {
                            const style = useChartStore
                              .getState()
                              .indicators.find((i) => i.id === indicator.id);
                            ctx.emit({
                              ...out,
                              series: out.series?.map((s) =>
                                s.kind !== "candle" &&
                                s.kind !== "bar" &&
                                s.kind !== "markers"
                                  ? ({
                                      ...s,
                                      style: {
                                        ...(s as LineLikeSeries).style,
                                        width: style?.lineWidth ?? 2,
                                      },
                                    } as LineLikeSeries)
                                  : s,
                              ),
                            });
                          },
                        };
                        originalStart(wrapped, inputs);
                      };
                      return native;
                    },
                  }),
                );
                handle = chart.addNativeIndicator(styledType, {
                  inputs: makeInputs(indicator),
                });
              } else
                handle = chart.addNativeIndicator(definition.nativeId, {
                  inputs: makeInputs(indicator),
                });
            } else continue;
            indicatorHandles.set(indicator.id, handle);
            handle.on("ready", () => {
              if (
                useChartStore
                  .getState()
                  .indicators.find((i) => i.id === indicator.id)?.error
              )
                useChartStore
                  .getState()
                  .updateIndicator(indicator.id, { error: undefined });
            });
            handle.on("error", ({ error }) =>
              useChartStore
                .getState()
                .updateIndicator(indicator.id, { error: error.message }),
            );
          } else {
            if (source && handle.source !== source)
              void handle.updateCode(source);
            handle.setInputs(source ? indicator.inputs : makeInputs(indicator));
          }
          handle.setVisible(indicator.visible);
          signatures.current.set(indicator.id, signature);
        } catch (error) {
          useChartStore
            .getState()
            .updateIndicator(indicator.id, { error: String(error) });
          signatures.current.set(indicator.id, signature);
        }
      }
    };
    void sync();
    return () => {
      disposed = true;
    };
  }, [chart, indicators]);
  useEffect(() => {
    if (!chart || !command) return;
    useChartStore.getState().set({ command: null });
    const serial=["range","goto","recent","fit"].includes(command.kind)?++navigationSerial.current:navigationSerial.current;
    if (["range", "goto", "recent", "fit"].includes(command.kind)) setLoading(false);
    if (command.kind === "range") {
      const state=useChartStore.getState(),plan=rangePlan(command.value!,Date.now(),state.chartType),epoch=state.feedEpoch,revision=marketChange.current;
      const valid=()=>marketChange.current===revision&&navigationSerial.current===serial&&getPrimaryChart()===chart&&useChartStore.getState().symbol===state.symbol&&useChartStore.getState().feedEpoch===epoch&&[state.timeframe,plan.timeframe].includes(useChartStore.getState().timeframe);
      const execute = async () => {
        setLoading(true);
        await chart.setMarket({symbol:state.symbol,timeframe:plan.timeframe,bars:plan.count});
        await chart.historyComplete();if(!valid())return;
        const report=nativeHistory.current;
        explicitRange.current={symbol:state.symbol,timeframe:plan.timeframe};
        state.set({timeframe:plan.timeframe,candles:marketService.barsFor(state.symbol,plan.timeframe)});
        if(!report||report.chart!==chart||!report.barsLoaded)throw new Error("No history is available for this market and interval.");
        if(plan.from===undefined)chart.setVisibleRangePreset("ALL");
        else {
          chart.setVisibleRange({from:Math.max(plan.from,report.oldestTime),to:plan.to});
          if(report.oldestTime>plan.from)state.toast("Partial history",`This market has available bars from ${new Date(report.oldestTime).toISOString().slice(0,10)} at ${plan.timeframe}.`,"info");
        }
      };
      void execute().catch((error) => {
        if(valid())useChartStore.getState().toast("Range load failed",String(error),"error");
      }).finally(()=>{if(valid())setLoading(false);});
    } else if (command.kind === "goto") {
      const state=useChartStore.getState(),epoch=state.feedEpoch,revision=marketChange.current;
      const valid=()=>marketChange.current===revision&&navigationSerial.current===serial&&getPrimaryChart()===chart&&useChartStore.getState().symbol===state.symbol&&useChartStore.getState().timeframe===state.timeframe&&useChartStore.getState().feedEpoch===epoch;
      const execute=async()=>{
        const time=command.time??NaN,window=dateWindow(time,command.to,state.timeframe),replay=chart.replay.state;
        if(replay.active){if(time<(chart.replay.bounds?.first??0)||time>(replay.cursorTime??0)||command.to!==undefined&&command.to>(replay.cursorTime??0))throw new Error("Choose a date already revealed in Replay, or exit Replay first.");chart.setVisibleRange({from:window.from,to:Math.min(window.to,replay.cursorTime!)});return;}
        setLoading(true);await chart.historyComplete();if(!valid())return;
        let report=nativeHistory.current;
        if(!report||report.chart!==chart||report.oldestTime>time){
          const count=navigationDepth(time,state.timeframe);await chart.setMarket({symbol:state.symbol,timeframe:state.timeframe,bars:Math.max(chart.market.bars??0,count)});await chart.historyComplete();if(!valid())return;report=nativeHistory.current;
        }
        if(!report||report.chart!==chart||!report.barsLoaded||report.oldestTime>time)throw new Error("This date is outside the market's available history at this interval. Choose a larger interval or a more recent date.");
        chart.setVisibleRange({from:Math.max(window.from,report.oldestTime),to:window.to});
      };
      void execute().catch(error=>{if(valid())state.toast("Date unavailable",String(error),"error");}).finally(()=>{if(valid())setLoading(false);});
    } else if(command.kind==="recent"){
      void navigateRecent(chart, serial);
    } else if (command.kind === "undo") chart.drawings.undo();
    else if (command.kind === "redo") chart.drawings.redo();
    else if (command.kind === "clear")
      chart.drawings.fromJSON({ version: 1, drawings: [] });
    else if (command.kind === "fit") chart.setVisibleRangePreset("ALL");
    else if (command.kind === "settings") chart.renderer.openSettings();
    else if (command.kind === "snapshot") {
      try{
        const state=useChartStore.getState(),palette=chartTheme(useWorkspaceStore.getState().theme),about=describeSymbol(symbol),grid=container.current?.closest<HTMLElement>(".chart-grid");
        if(command.snapshotScope!=="chart"&&grid&&grid.querySelectorAll("[data-cell-id]").length>1){state.set({snapshot:captureVisibleLayout(grid,{background:palette.background,textColor:palette.textColor})});}
        else{const source=snapshotSource(state.dataSources[`${symbol}:${timeframe}`],chart.replay.state.active,Boolean(about.delayed));state.set({snapshot:{...captureChartSnapshot(chart.renderer,{symbol,timeframe,title:`${about.title} · ${about.venue}`,source,cssWidth:container.current?.clientWidth??0,background:palette.background,textColor:palette.textColor}),scope:command.snapshotScope??"chart",chartCount:1}});}
      }catch(error){useChartStore.getState().toast("Snapshot failed",error instanceof Error?error.message:String(error),"error");}
    } else if (command.kind === "csv") {
      const state = useChartStore.getState();
      const replay = chart.replay.state;
      const bars = replay.active
        ? state.candles.filter((b) => b.time <= (replay.cursorTime ?? 0))
        : state.candles;
      const csv = chartDataCsv(bars, state.symbol, state.timeframe, state.dataSources[`${state.symbol}:${state.timeframe}`]);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${state.symbol}-${state.timeframe}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (["undo", "redo", "clear"].includes(command.kind)) {
      const state = useChartStore.getState();
      state.set({
        drawings: {
          ...state.drawings,
          [state.symbol]: chart.drawings.toJSON(),
        },
      });
    }
  }, [chart, command]);
  return { chart, loading, readout };
}
function focusFootprint(chart: Vela, width: number) {
  const state=useChartStore.getState();
  const window=footprintWindow(state.candles,state.timeframe,footprintBarCount(width),chart.replay.state.active?chart.replay.state.cursorTime??-1:undefined);
  if(window)chart.setVisibleRange(window);
}


