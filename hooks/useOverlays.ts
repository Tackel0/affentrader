"use client";
import { useEffect } from "react";
import type { Vela } from "@luxalgo/vela";
import { marketService } from "@/lib/market/service";
import { useChartStore } from "@/stores/useChartStore";
import { compareSymbols, runFormula } from "@/lib/chart/compare";
import {
  onOverlayChange,
  setOverlay,
  type OverlayLine,
} from "@/lib/chart/overlays";
import { detectPatterns, patternOverlays } from "@/lib/patterns";
import {liquidationPrices} from "@/lib/trading/quotes";
import { tradingOverlays } from "@/lib/trading/overlays";
import { activeAccount, usePaperStore } from "@/stores/usePaperStore";
import { useStrategyStore } from "@/stores/useStrategyStore";
import { strategyOverlays } from "@/lib/strategy/overlay";
import type { CompareSeries, OHLCV } from "@/types/trading";
import { invalidateCanvasLayers } from "@/lib/chart/canvasLayer";
import { useSetupJournal } from "@/stores/useSetupJournal";
import { setupOverlays } from "@/lib/screener/setupJournal";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

/** Cell id the active chart paints under (see `bindCellContext`). */
export const PRIMARY_CELL = "primary";

export function buildCompareLine(
  series: CompareSeries,
  data: Record<string, readonly OHLCV[]>,
  timeline: readonly number[],
): OverlayLine {
  const expression =
    series.kind === "symbol" ? (series.symbol ?? "") : (series.expression ?? "");
  const { points } = runFormula(expression, data, timeline);
  return {
    kind: "line",
    id: series.id,
    label: series.label,
    color: series.color,
    width: series.lineWidth,
    scale: series.scale,
    points,
  };
}

/**
 * Keeps the primary chart's overlay layer current: comparison / formula
 * lines and detected patterns. Both recompute when the market or the live
 * bar stream changes, throttled so a busy feed cannot saturate the main thread.
 */
export function useOverlays(chart: Vela | null) {
  useEffect(() => {
    if (!chart) return;
    const off = onOverlayChange((cellId) => {
      if (cellId === PRIMARY_CELL) invalidateCanvasLayers(cellId);
    });
    return () => {
      off();
    };
  }, [chart]);

  const compares = useChartStore((s) => s.compares);
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const epoch = useChartStore((s) => s.feedEpoch);
  const setup = useSetupJournal(state => state.records.find(row => row.id === state.chartId));
  const replay = useWorkspaceStore(state => state.replay.active);
  useEffect(() => {
    if (chart && setup?.symbol === symbol && !replay) setOverlay(PRIMARY_CELL, "setup", setupOverlays(setup));
    return () => setOverlay(PRIMARY_CELL, "setup", []);
  }, [chart, setup, symbol, replay]);
  useEffect(() => {
    if (!chart) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const active = compares.filter((c) => c.visible);
    if (!active.length) {
      setOverlay(PRIMARY_CELL, "compare", []);
      return;
    }
    const run = async () => {
      const timeline = useChartStore.getState().candles.map((b) => b.time);
      if (!timeline.length) return;
      const lines: OverlayLine[] = [];
      for (const series of active) {
        try {
          const needed = compareSymbols(series);
          if (!needed.length) throw new Error("Enter a symbol or formula.");
          const data: Record<string, readonly OHLCV[]> = {};
          const depth = Math.min(20000, Math.max(600, timeline.length));
          for (const name of needed)
            data[name] =
              name === symbol
                ? useChartStore.getState().candles
                : await marketService.history(name, timeframe, depth);
          if (disposed) return;
          lines.push(buildCompareLine(series, data, timeline));
          if (series.error)
            useChartStore.setState((s) => ({
              compares: s.compares.map((c) =>
                c.id === series.id ? { ...c, error: undefined } : c,
              ),
            }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (series.error !== message)
            useChartStore.setState((s) => ({
              compares: s.compares.map((c) =>
                c.id === series.id ? { ...c, error: message } : c,
              ),
            }));
        }
      }
      if (!disposed) setOverlay(PRIMARY_CELL, "compare", lines);
    };
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, 400);
    };
    schedule();
    const offs = [
      marketService.subscribe(symbol, timeframe, schedule),
      ...active.flatMap((series) =>
        compareSymbols(series)
          .filter((name) => name !== symbol)
          .map((name) => marketService.subscribe(name, timeframe, schedule)),
      ),
    ];
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      offs.forEach((off) => off());
    };
    // The error field is rewritten by this effect; it must not retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    chart,
    symbol,
    timeframe,
    epoch,
    JSON.stringify(
      compares.map((c) => [c.id, c.kind, c.symbol, c.expression, c.color, c.lineWidth, c.scale, c.visible, c.label]),
    ),
  ]);

  const patternsOn = useChartStore((s) => s.patternsOn);
  const options = useChartStore((s) => s.patternOptions);
  useEffect(() => {
    if (!chart) return;
    if (!patternsOn) {
      setOverlay(PRIMARY_CELL, "patterns", []);
      useChartStore.getState().set({ patternHits: [] });
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      timer = null;
      const bars = useChartStore.getState().candles;
      if (bars.length < 20) return;
      const hits = detectPatterns(bars, options);
      useChartStore.getState().set({ patternHits: hits });
      setOverlay(PRIMARY_CELL, "patterns", patternOverlays(hits, bars));
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(run, 600);
    };
    schedule();
    const off = marketService.subscribe(symbol, timeframe, schedule);
    return () => {
      if (timer) clearTimeout(timer);
      off();
    };
  }, [chart, symbol, timeframe, epoch, patternsOn, options]);

  // Positions, working orders and fills of the paper account.
  useEffect(() => {
    if (!chart) return;
    const refresh = () => {
      const state = usePaperStore.getState();
      const symbolNow = useChartStore.getState().symbol;
      setOverlay(
        PRIMARY_CELL,
        "trading",
        tradingOverlays(activeAccount(state), symbolNow, state.mode==="live"?liquidationPrices(state.live,state.prices,state.liveBooks,state.liveSources)[symbolNow]:state.prices[symbolNow]),
      );
    };
    refresh();
    let last = 0;
    const expiry=setInterval(()=>{if(activeAccount(usePaperStore.getState()).positions.some(p=>p.symbol===symbol))refresh();},1000);
    const off = usePaperStore.subscribe((state, previous) => {
      // Price ticks only matter for the P&L label, so they are throttled.
      const accountChanged =
        state.live !== previous.live || state.replay !== previous.replay || state.mode !== previous.mode;
      const now = Date.now();
      if (accountChanged || now - last > 1000) {
        last = now;
        refresh();
      }
    });
    return () => {
      off();
      clearInterval(expiry);
      setOverlay(PRIMARY_CELL, "trading", []);
    };
  }, [chart, symbol]);

  // Dividends and splits of stocks and ETFs.
  const marketEvents = useChartStore((s) => s.marketEvents[s.symbol]);
  const loaded = useChartStore((s) => s.candles.length > 0);
  useEffect(() => {
    if (!chart) return;
    const bars = useChartStore.getState().candles;
    if (!marketEvents || !bars.length) {
      setOverlay(PRIMARY_CELL, "events", []);
      return;
    }
    const first = bars[0].time;
    const at = (time: number) => {
      let lo = 0;
      let hi = bars.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (bars[mid].time < time) lo = mid + 1;
        else hi = mid;
      }
      return bars[lo];
    };
    setOverlay(PRIMARY_CELL, "events", [
      ...marketEvents.dividends
        .filter((d) => d.time >= first)
        .map((d) => ({
          kind: "marker" as const,
          time: at(d.time).time,
          price: at(d.time).low,
          shape: "circle" as const,
          color: "#ff9800",
          label: `D ${d.amount}`,
          position: "below" as const,
        })),
      ...marketEvents.splits
        .filter((s) => s.time >= first)
        .map((s) => ({
          kind: "marker" as const,
          time: at(s.time).time,
          price: at(s.time).high,
          shape: "diamond" as const,
          color: "#9c27b0",
          label: `Split ${s.numerator}:${s.denominator}`,
          position: "above" as const,
        })),
    ]);
    return () => setOverlay(PRIMARY_CELL, "events", []);
  }, [chart, marketEvents, loaded, timeframe, symbol]);

  // Trades of the latest backtest, when it matches this chart.
  const strategyReport = useStrategyStore((s) => s.report);
  const showTrades = useStrategyStore((s) => s.showOnChart);
  const focusTrade = useStrategyStore((s) => s.focusTrade);
  useEffect(() => {
    if (
      !chart ||
      !strategyReport ||
      !showTrades ||
      strategyReport.market.symbol !== symbol ||
      strategyReport.market.timeframe !== timeframe
    ) {
      setOverlay(PRIMARY_CELL, "strategy", []);
      return;
    }
    setOverlay(PRIMARY_CELL, "strategy", strategyOverlays(strategyReport, focusTrade));
    return () => setOverlay(PRIMARY_CELL, "strategy", []);
  }, [chart, strategyReport, showTrades, focusTrade, symbol, timeframe]);
}
