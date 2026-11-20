"use client";
import { ChartCoverage } from "./ChartCoverage";
import {WorkingOrderControls} from "./OrderModification";
import {ChartOrderEditor} from "./ChartOrderEditor";
import {ChartPositionBar} from "./PositionActions";
import {ChartTrading} from "./ChartTrading";
import {CandleRecoveryStatus} from "./CandleRecoveryStatus";
import { DerivedChartIssue } from "./DerivedChartIssue";
import {installTradingSettings} from "@/lib/chart/tradingSettings";
import { bindNativeChartType, chartTypeHost } from "@/lib/chart/nativeChartType";
import { bindNativeLayoutMode } from "@/lib/chart/nativeLayoutMode";
import { bindDerivedSettingsPaint } from "@/lib/chart/derivedSettings";
import { bindSeriesPreferences, seriesPreferencesHost } from "@/lib/chart/seriesBinding";
import { nativeIndicatorInputs } from "@/lib/indicators/nativeInputs";
import { bindTpoSessionMenu } from "@/lib/orderflow/tpoSessionMenu";
import { bindFootprintMenu } from "@/lib/orderflow/footprintMenu";
import { bindChartAppearance, chartAppearanceHost } from "@/lib/chart/appearanceBinding";
import { bindChartView, chartViewHost } from "@/lib/chart/viewBinding";
import { memo, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Vela } from "@luxalgo/vela";
import { Maximize2, Minimize2, LoaderCircle } from "lucide-react";
import { LAYOUTS, useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { useChartStore } from "@/stores/useChartStore";
import { marketService } from "@/lib/market/service";
import { applyTimezone } from "@/lib/chart/timezone";
import { bindCellContext, requestChartPaint } from "@/lib/chart/cellContext";
import { bindReplayClock, completedReplayBoundary } from "@/lib/chart/replayClock";
import { workspaceReplay } from "@/lib/chart/workspaceReplay";
import { chartTheme } from "@/lib/chart/theme";
import { INDICATORS } from "@/lib/indicators/catalog";
import { pineEngineOptions } from "@/lib/indicators/engineOptions";
import { formatPrice, describeSymbol } from "@/lib/symbols";
import { symbolLabel } from "@/lib/symbolId";
import type { WorkspaceCell } from "@/types/workspace";
import { ChartCanvas } from "./ChartCanvas";
import { DrawingFavorites } from "./DrawingFavorites";
import { IconButton } from "./ui";
import { bindPriceScale, priceScaleHost } from "@/lib/chart/priceScale";
import { bindStudyAxisLabels } from "@/lib/chart/studyAxisLabels";
import { indicatorExecutionSignature } from "@/lib/indicators/presentation";
import { bindLinkedCrosshair, publishLinkedCrosshair } from "@/lib/chart/crosshairLink";
import { bindLinkedViewport } from "@/lib/chart/viewportLink";
import { bindSatelliteQuote, type SatelliteQuote } from "@/lib/chart/satelliteQuote";
import {bindSnapshotChart,snapshotSource} from "@/lib/chart/snapshotRegistry";
export function ChartGrid({ phoneLayout }: { phoneLayout?: { grid: boolean; toggleGrid: () => void } }) {
  const layout = useWorkspaceStore((s) => s.layout),
    cells = useWorkspaceStore((s) => s.cells),
    activeId = useWorkspaceStore((s) => s.activeId),
    maximized = useWorkspaceStore((s) => s.maximizedId);
  const symbol = useChartStore((s) => s.symbol),
    timeframe = useChartStore((s) => s.timeframe),
    chartType = useChartStore((s) => s.chartType),
    logarithmic = useChartStore(s=>s.logarithmic),
    scaleMode = useChartStore(s=>s.scaleMode),
    legendCollapsed = useChartStore(s=>s.legendCollapsed),
    chartView = useChartStore(s=>s.chartView),
    chartAppearance = useChartStore(s=>s.chartAppearance),
    seriesPreferences = useChartStore(s=>s.seriesPreferences),
    chartTypeSettings = useChartStore(s=>s.chartTypeSettings),
    statusLine = useChartStore(s=>s.statusLine),
    indicators = useChartStore((s) => s.indicators);
  useEffect(() => {
    useWorkspaceStore.getState().capture();
  }, [symbol, timeframe, chartType, logarithmic, scaleMode, legendCollapsed, chartView, chartAppearance, seriesPreferences, chartTypeSettings, statusLine, indicators, activeId]);
  const config = LAYOUTS.find((l) => l.id === layout)!;
  const choices = cells.slice(0, config.count);
  const phoneFocus = phoneLayout !== undefined && !phoneLayout.grid;
  const singleId = phoneFocus ? activeId : maximized;
  const visible = singleId ? choices.filter(cell => cell.id === singleId) : choices;
  return (<>
    {phoneLayout && choices.length > 1 && (
      <div className="phone-chart-switcher">
        <select aria-label="Active chart" value={activeId} onChange={event => useWorkspaceStore.getState().activate(event.target.value)}>
          {choices.map((cell, index) => <option key={cell.id} value={cell.id}>{index + 1}/{choices.length} · {symbolLabel(cell.id === activeId ? symbol : cell.symbol)}</option>)}
        </select>
        <button className="button small" type="button" onClick={() => {
          if (maximized) useWorkspaceStore.setState({ maximizedId: null });
          phoneLayout.toggleGrid();
        }}>{phoneLayout.grid ? "Single chart" : "Show grid"}</button>
      </div>
    )}
    <div
      className={`chart-grid layout-${singleId ? "single" : layout} ${config.count > 1 && !phoneFocus ? "multi-chart" : ""}`}
      style={{
        gridTemplateColumns: `repeat(${singleId ? 1 : config.columns},minmax(0,1fr))`,
        gridTemplateRows: `repeat(${singleId ? 1 : config.rows},minmax(0,1fr))`,
      }}
      aria-label="Chart layout"
    >
      {visible.map((cell) => (
        <div
          className={`chart-grid-cell ${activeId === cell.id ? "active-cell" : ""}`}
          key={cell.id}
          data-cell-id={cell.id}
        >
          {activeId === cell.id ? (
            <ChartCanvas compact={config.count > 4 && !singleId} />
          ) : (
            <SatelliteChart
              cell={cell}
              compact={config.count > 4 && !singleId}
            />
          )}
          {config.count > 1 && !phoneFocus ? (
            <div className="cell-controls">
              <button
                className="cell-number"
                title={`Activate chart ${cells.indexOf(cell) + 1}`}
                onClick={() => useWorkspaceStore.getState().activate(cell.id)}
              >
                {cells.indexOf(cell) + 1}
              </button>
              <IconButton
                label={
                  maximized
                    ? "Restore chart grid"
                    : `Maximize chart ${cells.indexOf(cell) + 1}`
                }
                onClick={() => useWorkspaceStore.getState().maximize(cell.id)}
              >
                {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </IconButton>
            </div>
          ) : null}
        </div>
      ))}
      <DrawingFavorites />
    </div>
  </>);
}
const SatelliteQuoteLabel = memo(function SatelliteQuoteLabel({ store }: { store: StoreApi<SatelliteQuote> }) {
  const close = useStore(store, (state) => state.close);
  const replaying = useStore(store, (state) => state.replaying);
  return <>
    {close !== null ? <small className="mono">{formatPrice(close)}</small> : null}
    {replaying ? <small>REPLAY</small> : null}
  </>;
});

function SatelliteChart({
  cell,
  compact,
}: {
  cell: WorkspaceCell;
  compact: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Vela | null>(null);
  const current = useRef(cell);
  current.current = cell;
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [quote] = useState(() => createStore<SatelliteQuote>()(() => ({ close: null, replaying: false })));
  const epoch = useChartStore((s) => s.feedEpoch);
  const symbolEpoch = useChartStore((s) => s.marketEpochs[cell.symbol] ?? 0);
  const simulated = useChartStore(
    (s) => s.dataSources[`${cell.symbol}:${cell.timeframe}`] === "simulation",
  );
  const signature = JSON.stringify({ ...cell, indicators: cell.indicators.map(indicatorExecutionSignature), chartView: undefined, chartAppearance: undefined, seriesPreferences: undefined, chartTypeSettings: undefined, scaleMode: undefined, logarithmic: undefined });
  useEffect(() => {
    let disposed = false;
    let chart: Vela | null = null;
    let terminatePine: (() => void) | undefined;
    const off: (() => void)[] = [];
    const studyHandles = new Map<string, string>();
    const mount = async () => {
      try {
        const [vela, pine, plugins, fibonacci] = await Promise.all([
          import("@luxalgo/vela"),
          import("@luxalgo/vela-pinets"),
          import("@/lib/orderflow/velaPlugins"),
          import("@/lib/drawings/fibonacciPlugin"),
        ]);
        if (disposed || !ref.current) return;
        plugins.registerOrderflowPlugins();
        fibonacci.registerFibonacciConstruction();
        off.push(
          bindCellContext(ref.current, () => ({
            id: current.current.id,
            symbol: current.current.symbol,
            timeframe: current.current.timeframe,
            replay: chart?.replay.state.active ?? false,
            replayThrough: chart ? completedReplayBoundary(chart.replay.state, current.current.timeframe) : null,
          }), () => requestChartPaint(chart)),
        );
        off.push(bindDerivedSettingsPaint(cell.id));
        chart = new vela.Vela(
          ref.current,
          {
            symbol: cell.symbol,
            timeframe: cell.timeframe,
            bars: 600,
            live: true,
            drawings: { toolbar: false },
            volume: false,
            priceStyle: cell.chartType,
            logScale: Boolean(cell.logarithmic),
            theme: chartTheme(useWorkspaceStore.getState().theme),
            animations: { intro: false },
            nativeBackend: "canvas2d",
          },
          { dataFeed: marketService.velaFeed },
        );
        installTradingSettings(chart, cell.id);
        off.push(bindReplayClock(chart));
        off.push(bindNativeLayoutMode(chart.renderer));
        off.push(bindNativeChartType(chart, chartTypeHost(cell.id)));
        chartRef.current = chart;
        off.push(bindPriceScale(chart, ref.current, priceScaleHost(cell.id)));
        off.push(bindStudyAxisLabels(chart.renderer, {
          read: () => (useWorkspaceStore.getState().cells.find(value => value.id === cell.id)?.indicators ?? []).flatMap(indicator => {
            const nativeId = studyHandles.get(indicator.id); return nativeId ? [{ indicator, nativeId }] : [];
          }),
          subscribe: listener => useWorkspaceStore.subscribe((state, previous) => {
            if (state.cells.find(value => value.id === cell.id)?.indicators !== previous.cells.find(value => value.id === cell.id)?.indicators) listener();
          }),
        }));
        chart.renderer.set({ indicatorTitles: false });
        chart.renderer.applyConfig({ layout: { fontSize: 11 } });
        off.push(bindChartView(chart.renderer, chartViewHost(cell.id)));
        off.push(bindChartAppearance(chart, chartAppearanceHost(cell.id)));
        off.push(bindSeriesPreferences(chart.renderer, seriesPreferencesHost(cell.id)));
        off.push(bindTpoSessionMenu(ref.current, chart.renderer, cell.id));
        off.push(bindFootprintMenu(ref.current, chart.renderer, cell.id));
        applyTimezone(chart, useChartStore.getState().timezone, current.current.symbol);
        if (
          cell.indicators.some(
            (i) =>
              i.script ||
              INDICATORS.find((d) => d.id === i.definitionId)?.script,
          )
        ) {
          const engine = new pine.PineWorkerEngine(pineEngineOptions());
          terminatePine = () => engine.terminate();
          chart.registerEngine("pine", engine);
        }
        off.push(
          chart.renderer.onCrosshairMove((event) => {
            if (chart?.market.symbol !== current.current.symbol || chart.market.timeframe !== current.current.timeframe) return;
            publishLinkedCrosshair(event.time !== null && event.price !== null
              ? { time: event.time, price: event.paneKind === "study" ? null : event.price, symbol: chart.market.symbol, source: cell.id }
              : null);
          }),
        );
        off.push(bindLinkedCrosshair(chart, cell.id));
        off.push(bindLinkedViewport(chart, cell.id));
        const quoteBinding = bindSatelliteQuote(chart, (next) => {
          const previous = quote.getState();
          if (!disposed && (previous.close !== next.close || previous.replaying !== next.replaying)) quote.setState(next);
        });
        off.push(quoteBinding.dispose);
        await chart.ready();
        if (disposed) return;
        for (const indicator of cell.indicators) {
          const definition = [
            ...INDICATORS,
            ...useChartStore.getState().nativeCatalog,
          ].find((d) => d.id === indicator.definitionId);
          const source = indicator.script ?? definition?.script;
          const handle = source
            ? chart.addIndicator(source, {
                id: indicator.id,
                title: indicator.name,
                inputs: indicator.inputs,
              })
            : definition?.nativeId
              ? chart.addNativeIndicator(definition.nativeId, {
                  inputs: nativeIndicatorInputs(indicator),
                })
              : null;
          handle?.setVisible(indicator.visible);
          if (handle) studyHandles.set(indicator.id, handle.id);
        }
        const bars = await marketService.history(
          cell.symbol,
          cell.timeframe,
          600,
        );
        if (disposed) return;
        quoteBinding.setHistory(bars);
        const shared = await workspaceReplay(); if (disposed) return;
        const joined = shared.register(cell.id, chart); off.push(joined.dispose);
        await joined.ready; if (disposed) return;
        off.push(bindSnapshotChart(ref.current!,{renderer:chart.renderer,read:()=>{
          const currentCell=current.current,about=describeSymbol(currentCell.symbol);
          if(chart!.market.symbol!==currentCell.symbol||chart!.market.timeframe!==currentCell.timeframe)throw new Error("A chart changed. Retry the snapshot.");
          return{symbol:currentCell.symbol,title:`${about.title} · ${about.venue}`,timeframe:currentCell.timeframe,source:snapshotSource(useChartStore.getState().dataSources[`${currentCell.symbol}:${currentCell.timeframe}`],chart!.replay.state.active,Boolean(about.delayed))};
        }}));
        setLoading(false);
      } catch (error) {
        if (!disposed) {
          setError(String(error));
          setLoading(false);
        }
      }
    };
    setLoading(true);
    setError("");
    quote.setState({ close: null, replaying: false });
    void mount();
    return () => {
      disposed = true;
      off.forEach((fn) => fn());
      try { chart?.destroy(); } finally { terminatePine?.(); }
      chartRef.current = null;
    };
  }, [signature, epoch, symbolEpoch]);
  const timezone = useChartStore((s) => s.timezone);
  useEffect(() => {
    if (chartRef.current) applyTimezone(chartRef.current, timezone, cell.symbol);
  }, [timezone, cell.symbol]);
  const quoteReady = !loading && !error && chartRef.current?.market.symbol === cell.symbol && chartRef.current.market.timeframe === cell.timeframe;
  return (
    <section
      className="satellite-chart"
      aria-label={`Chart ${cell.symbol} ${cell.timeframe}`}
      onPointerDownCapture={(e) => {
        if (!(e.target as HTMLElement).closest("button,input,select,label")) {
          e.stopPropagation();
          useWorkspaceStore.getState().activate(cell.id);
        }
      }}
    >
      <div className="satellite-heading">
        <button onClick={() => useWorkspaceStore.getState().activate(cell.id)}>
          {compact ? describeSymbol(cell.symbol).short : describeSymbol(cell.symbol).title}{" "}
          <span>
            · {cell.timeframe}
            {compact ? "" : ` · ${describeSymbol(cell.symbol).venue}`}
          </span>
        </button>
        {quoteReady ? <SatelliteQuoteLabel store={quote} /> : null}
        <ChartTrading symbol={cell.symbol} cellId={cell.id}/>
        <WorkingOrderControls symbol={cell.symbol}/>
        <ChartPositionBar symbol={cell.symbol} cellId={cell.id}/>
      </div>
      <div className="vela-container" ref={ref} />
      <ChartCoverage cellId={cell.id} host={ref}/>
      <DerivedChartIssue layerId={cell.id} owner={cell.id} symbol={cell.symbol} timeframe={cell.timeframe} type={cell.chartType}/>
      <CandleRecoveryStatus symbol={cell.symbol} timeframe={cell.timeframe}/>
      <ChartOrderEditor layerCellId={cell.id} cellId={cell.id} symbol={cell.symbol}/>
      {simulated ? (
        <span className="satellite-source-badge">SIMULATED DATA</span>
      ) : null}
      {loading ? (
        <div className="chart-loading">
          <LoaderCircle size={15} className="spin" />
        </div>
      ) : null}
      {error ? (
        <button
          className="satellite-error"
          onClick={() => useWorkspaceStore.getState().activate(cell.id)}
        >
          {error}
        </button>
      ) : null}
    </section>
  );
}
