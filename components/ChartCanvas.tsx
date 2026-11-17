"use client";
import {currentPriceAlertDraft} from "@/lib/alerts/priceDraft";
import {WorkingOrderControls} from "./OrderModification";
import {ChartOrderEditor} from "./ChartOrderEditor";
import {ChartPositionBar} from "./PositionActions";
import {ChartTrading} from "./ChartTrading";
import { memo, useMemo, useRef } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { Maximize2, RotateCcw, LoaderCircle, Plus } from "lucide-react";
import { useVelaChart } from "@/hooks/useVelaChart";
import { useOverlays } from "@/hooks/useOverlays";
import { useChartStore } from "@/stores/useChartStore";
import { formatPrice, getSymbol, formatVolume, describeSymbol } from "@/lib/symbols";
import { AssetBadge, IconButton } from "./ui";
import { IndicatorChips } from "./Indicators";
import { CandleRecoveryStatus } from "./CandleRecoveryStatus";
import { DerivedChartIssue } from "./DerivedChartIssue";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { statusLinePreferences } from "@/lib/chart/statusLine";
import { barChange, formatBarChange } from "@/lib/chart/barChange";
import { useAlpacaStore } from "@/stores/useAlpacaStore";
import { ChartCoverage } from "./ChartCoverage";
import { providerOf } from "@/lib/symbolId";
interface OhlcReadoutProps {
  readout: ReturnType<typeof useVelaChart>["readout"];
  loading: boolean;
  interrupted: boolean;
  unavailable: boolean;
  replay: boolean;
}

const OhlcReadout = memo(function OhlcReadout({ readout, loading, interrupted, unavailable, replay }: OhlcReadoutProps) {
  const savedPreferences = useChartStore((s) => s.statusLine);
  const preferences = useMemo(() => statusLinePreferences(savedPreferences), [savedPreferences]);
  const hidden = !preferences.ohlc && !preferences.volume && !preferences.barChange;
  const ready = !hidden && !loading && !interrupted && !unavailable;
  const observedBar = useStore(readout, useShallow(state => ready ? state.hovered ?? (replay ? state.replayBar : null) : null));
  const liveBar = useChartStore(useShallow(state => ready && !observedBar && !replay ? state.candles.at(-1) : undefined));
  const bar = observedBar ?? liveBar;
  const replayCursor = useWorkspaceStore(s => replay && bar && preferences.barChange ? s.replay.cursorTime : null);
  const change = useChartStore(useShallow(state => bar && preferences.barChange
    ? barChange(state.candles, bar, replay ? replayCursor ?? -Infinity : Infinity) : null));
  const positive = !bar || bar.close >= bar.open;
  return (
    <div
      className={`ohlc-strip mono ${positive ? "positive" : "negative"}`}
      hidden={hidden}
    >
      {bar ? (
        <>
          {preferences.ohlc ? (["open", "high", "low", "close"] as const).map((key, index) => (
            <span key={key} className={`ohlc-${key}`}>
              <small>{["O", "H", "L", "C"][index]}</small>
              {formatPrice(bar[key])}
            </span>
          )) : null}
          {preferences.barChange && change ? <span className={`bar-change ${change.difference > 0 ? "positive" : change.difference < 0 ? "negative" : "muted"}`}
            aria-label="Bar change" title={`Previous close: ${formatPrice(change.previousClose)} (${new Date(change.previousTime).toISOString()})`}>
            {formatBarChange(change)}
          </span> : null}
          {preferences.volume ? <span className="ohlc-volume">
            <small>Vol</small>
            {formatVolume(bar.volume ?? 0)}
          </span> : null}
        </>
      ) : (
        <span className="muted">
          {interrupted ? "Candle history interrupted" : loading
            ? "Loading market history…"
            : "Waiting for exchange trades"}
        </span>
      )}
    </div>
  );
});

export function ChartCanvas({ compact = false }: { compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { chart, loading, readout } = useVelaChart(ref);
  useOverlays(chart);
  const replay = useWorkspaceStore((s) => s.replay.active);
  const iexEnabled = useAlpacaStore(s => s.enabled);
  const simulated = useChartStore(
    (s) => s.dataSources[`${s.symbol}:${s.timeframe}`] === "simulation",
  );
  const symbol = useChartStore((s) => s.symbol),
    timeframe = useChartStore((s) => s.timeframe),
    error = useChartStore((s) => s.chartError),
    recovery = useChartStore(s => s.candleRecoveries[`${s.symbol}:${s.timeframe}`]),
    status = useChartStore((s) => s.feedStatus),
    type = useChartStore((s) => s.chartType);
  const asset = getSymbol(symbol), about = describeSymbol(symbol);
  const unavailable = !!error || chart?.market.symbol !== symbol || chart?.market.timeframe !== timeframe;
  return (
    <section className="chart-section" aria-label="Interactive price chart">
      <div className="chart-heading">
        <div className="chart-market-title">
          <AssetBadge symbol={symbol} />
          <button
            onClick={() =>
              useChartStore
                .getState()
                .set({ searchOpen: true, searchTarget: "chart" })
            }
          >
            {compact ? about.short : about.title}
          </button>
          <span className="market-timeframe">{timeframe}</span>
          <span className="exchange-label">{about.venue}</span>
          {about.delayed ? <span className="delayed-badge" title="Quotes are delayed">DELAYED</span> : null}
          {about.crypto ? <span className="market-open-dot" title="24/7 crypto market" /> : null}
        </div>
        <OhlcReadout readout={readout} loading={loading} interrupted={!replay && !!recovery} unavailable={unavailable} replay={replay} />
        <ChartTrading symbol={symbol} cellId={useWorkspaceStore.getState().activeId}/>
        <WorkingOrderControls symbol={symbol}/>
        <ChartPositionBar symbol={symbol} cellId={useWorkspaceStore.getState().activeId}/>
        <IndicatorChips />
      </div>
      {replay ? <div className="replay-chart-badge">REPLAY</div> : null}
      <div className="vela-container" ref={ref} />
      <ChartCoverage cellId="primary" host={ref}/>
      <DerivedChartIssue layerId="primary" owner={useWorkspaceStore.getState().activeId} symbol={symbol} timeframe={timeframe} type={type}/>
      <CandleRecoveryStatus symbol={symbol} timeframe={timeframe} hidden={replay} />
      <ChartOrderEditor layerCellId="primary" cellId={useWorkspaceStore.getState().activeId} symbol={symbol}/>
      <div className="chart-watermark" aria-hidden="true">
        <strong>{about.watermark}</strong>
        <span>
          {type === "footprint"
            ? "FOOTPRINT"
            : type === "tpo"
              ? "TIME PRICE OPPORTUNITY"
              : about.caption}
        </span>
      </div>
      {loading ? (
        <div className="chart-loading">
          <LoaderCircle className="spin" size={18} />
          <span>Loading {asset.base} market…</span>
        </div>
      ) : null}
      {error ? (
        <div className="chart-error">
          <strong>{providerOf(symbol) === "alpaca" && !iexEnabled ? "Alpaca connection required" : "Chart diagnostic"}</strong>
          <p>{providerOf(symbol) === "alpaca" && !iexEnabled ? "Connect your Alpaca API key to load stock market data." : error}</p>
          <button className="button" onClick={() => providerOf(symbol) === "alpaca" ? useAlpacaStore.setState({ open: true }) : window.location.reload()}>
            {providerOf(symbol) === "alpaca" ? "Manage Alpaca connection" : "Reload chart"}
          </button>
        </div>
      ) : null}
      {simulated || status === "simulation" ? (
        <div className="simulation-tag">
          <span className="status-dot amber" />
          SIMULATED DATA
        </div>
      ) : null}
      <div className="chart-floating-controls">
        <IconButton
          label="Fit all loaded bars"
          onClick={() =>
            useChartStore
              .getState()
              .set({ command: { id: Date.now(), kind: "fit" } })
          }
        >
          <Maximize2 size={14} />
        </IconButton>
        <IconButton
          label="Reset to recent candles"
          onClick={() =>
            useChartStore
              .getState()
              .set({ command: { id: Date.now(), kind: "recent" } })
          }
        >
          <RotateCcw size={14} />
        </IconButton>
      </div>
      <button
        className="price-alert-hint"
        title="Create an alert at the current price. Click the price scale for a custom price."
        aria-label="Create alert at current price"
        onClick={() =>
          useChartStore
            .getState()
            .set({ alertDraft: currentPriceAlertDraft() })
        }
      >
        <Plus size={13} />
      </button>
    </section>
  );
}

