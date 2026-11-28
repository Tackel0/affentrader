"use client";
import { priceScalePatch, type PriceScaleMode } from "@/lib/chart/scaleMode";
import { DEFAULT_STATUS_LINE, type StatusLinePreferences } from "@/lib/chart/statusLine";
import {DEFAULT_CHART_TRADING,type ChartTradingPreferences} from "@/lib/trading/chartPreferences";
import { create } from "zustand";
import { scopedName } from "@/lib/windowScope";
import { persist } from "zustand/middleware";
import { createShallowPersistStorage, hotStorage } from "@/lib/debouncedStorage";
import {
  DEFAULT_CHART_TYPE_SETTINGS,
  type ChartTypeSettings,
} from "@/lib/chart/chartTypes";
import type { DrawingTreeState } from "@/lib/drawings/tree";
import type { DrawingPreferences } from "@/types/trading";
import { DEFAULT_DRAWING_PREFERENCES } from "@/lib/drawings/preferences";
import {
  DEFAULT_PATTERN_OPTIONS,
  type PatternHit,
  type PatternOptions,
} from "@/lib/patterns";
import {
  DEFAULT_OPTIONS_WALLS_CONFIG,
  type OptionsWallsOverlayConfig,
} from "@/lib/market/optionsAnalytics";
import {
  DEFAULT_AI_ANALYSIS_LAYERS,
  type AiAnalysisLayerConfig,
  type AiChartAnalysisReport,
} from "@/lib/analysis/aiChartAnalysis";
import type {
  AlertDraft,
  BottomTab,
  ChartCommand,
  ChartType,
  CompareSeries,
  DrawingTool,
  FeedMode,
  FeedStatus,
  IndicatorDefinition,
  IndicatorInstance,
  OHLCV,
  OrderBook,
  Quote,
  Tick,
  Timeframe,
  ToastMessage,
} from "@/types/trading";
interface ChartState {
  snapshot:import("@/lib/chart/snapshot").ChartSnapshot|null;
  chartTrading:ChartTradingPreferences;
  symbol: string;
  timeframe: Timeframe;
  chartType: ChartType;
  logarithmic: boolean;
  scaleMode: PriceScaleMode;
  feedMode: FeedMode;
  feedStatus: FeedStatus;
  feedEpoch: number;
  marketEpochs: Record<string, number>;
  dataSources: Record<string, "exchange" | "simulation">;
  indicators: IndicatorInstance[];
  legendCollapsed: boolean;
  seriesPreferences: import("@/lib/chart/seriesPreferences").SeriesPreferences | null;
  chartAppearance: import("@/lib/chart/appearance").ChartAppearancePreferences | null;
  chartView: import("@/lib/chart/viewPreferences").ChartViewPreferences | null;
  statusLine: StatusLinePreferences;
  chartTypeSettings: ChartTypeSettings;
  compares: CompareSeries[];
  patternOptions: PatternOptions;
  /** Pattern detection is opt-in per chart because it scans the whole history. */
  patternsOn: boolean;
  patternHits: PatternHit[];
  /** Zero-API-key Options Walls (Call Wall, Put Wall, Gamma Flip, Max Pain, Expected Move) overlay on chart. */
  optionsWallsOn: boolean;
  optionsWallsConfig: OptionsWallsOverlayConfig;
  /** Zero-API-key AI Chart Analysis overlays (Structure, Trendlines, Supply/Demand, FVG, Fib, Trade Plan). */
  aiAnalysisOn: boolean;
  aiAnalysisLayers: AiAnalysisLayerConfig;
  aiAnalysisReport: AiChartAnalysisReport | null;
  favoriteIntervals: string[];
  /** Trading session for markets that have pre/post-market bars. */
  session: "regular" | "extended";
  /** `UTC`, an IANA zone, `exchange` (each symbol's own) or `local`. */
  timezone: string;
  /** Fold dividends into daily and coarser prices (stocks and ETFs). */
  adjustDividends: boolean;
  /** Dividends and splits of the symbols that have them, keyed by symbol. */
  marketEvents: Record<string, import("@/lib/market/yahoo").YahooEvents>;
  compareOpen: boolean;
  syncOpen: boolean;
  libraryOpen: boolean;
  derivedOpen: boolean;
  intervalOpen: boolean;
  pineLibraries: Record<string, string>;
  pineDraft: { name: string; source: string; activeId: string | null } | null;
  nativeCatalog: IndicatorDefinition[];
  quotes: Record<string, Quote>;
  visibleWatchSymbols: string[];
  candles: OHLCV[];
  candleRecoveries: Record<string, import("@/types/trading").CandleRecovery>;
  trades: Tick[];
  orderBook: OrderBook | null;
  drawing: DrawingTool;
  drawingPreferences: DrawingPreferences;
  drawings: Record<string, unknown>;
  command: ChartCommand | null;
  searchOpen: boolean;
  searchTarget: "chart" | "watchlist";
  indicatorsOpen: boolean;
  drawingFavoritesOpen: boolean;
  chartExportOpen: boolean;
  changelogOpen: boolean;
  commandPaletteOpen: boolean;
  settingsId: string | null;
  alertDraft: AlertDraft | null;
  sidebarTab: "watchlist" | "alerts" | "objects";
  objectPanelTab: "objects" | "data";
  /** Per-symbol object tree (groups and names) for drawings. */
  drawingTrees: Record<string, DrawingTreeState>;
  /** Bumped whenever the chart's drawings change so panels can refresh. */
  drawingsVersion: number;
  selectedDrawings: string[];
  bottomTab: BottomTab;
  bottomOpen: boolean;
  toasts: ToastMessage[];
  chartError: string | null;
  set: (patch: Partial<Omit<ChartState, "set">>) => void;
  addIndicator: (indicator: IndicatorInstance) => void;
  updateIndicator: (id: string, patch: Partial<IndicatorInstance>) => void;
  removeIndicator: (id: string) => void;
  toast: (title: string, message: string, tone?: ToastMessage["tone"]) => void;
  dismissToast: (id: string) => void;
}
export const useChartStore = create<ChartState>()(
  persist(
    (set) => ({
      snapshot:null,
      chartTrading:{...DEFAULT_CHART_TRADING},
      symbol: "BTCUSDT",
      timeframe: "15m",
      chartType: "candles",
      logarithmic: false,
      scaleMode: "price",
      feedMode: "auto",
      feedStatus: "connecting",
      feedEpoch: 0,
      marketEpochs: {},
      dataSources: {},
      indicators: [
        {
          id: "default-ema",
          definitionId: "ema",
          name: "EMA",
          visible: true,
          inputs: { length: 20 },
          color: "#7c83ff",
          lineWidth: 2,
          source: "close",
        },
        {
          id: "default-volume",
          definitionId: "volume",
          name: "Volume",
          visible: true,
          inputs: {} as Record<string, string | number | boolean>,
          color: "#38bea1",
          lineWidth: 1,
          source: "close",
        },
      ],
      legendCollapsed: false,
      chartView: null,
      chartAppearance: null,
      seriesPreferences: null,
      statusLine: { ...DEFAULT_STATUS_LINE },
      chartTypeSettings: DEFAULT_CHART_TYPE_SETTINGS,
      compares: [],
      patternOptions: DEFAULT_PATTERN_OPTIONS,
      patternsOn: false,
      patternHits: [],
      optionsWallsOn: false,
      optionsWallsConfig: DEFAULT_OPTIONS_WALLS_CONFIG,
      aiAnalysisOn: false,
      aiAnalysisLayers: DEFAULT_AI_ANALYSIS_LAYERS,
      aiAnalysisReport: null,
      favoriteIntervals: ["1m", "5m", "15m", "1h", "4h", "1D"],
      session: "regular",
      timezone: "UTC",
      adjustDividends: false,
      marketEvents: {},
      compareOpen: false,
      syncOpen: false,
      libraryOpen: false,
      derivedOpen: false,
      intervalOpen: false,
      nativeCatalog: [],
      quotes: {},
      visibleWatchSymbols: [],
      candles: [],
      candleRecoveries: {},
      trades: [],
      orderBook: null,
      drawing: "cursor",
      drawingPreferences: DEFAULT_DRAWING_PREFERENCES,
      drawings: {},
      command: null,
      pineLibraries: {},
      pineDraft: null,
      searchOpen: false,
      searchTarget: "chart",
      indicatorsOpen: false,
      drawingFavoritesOpen: false,
      chartExportOpen: false,
      changelogOpen: false,
      commandPaletteOpen: false,
      settingsId: null,
      alertDraft: null,
      sidebarTab: "watchlist",
      objectPanelTab: "objects",
      drawingTrees: {},
      drawingsVersion: 0,
      selectedDrawings: [],
      bottomTab: "overview",
      bottomOpen: false,
      toasts: [],
      chartError: null,
      set: (patch) => set(state => {
        const changed = patch.symbol !== undefined && patch.symbol !== state.symbol
          || patch.timeframe !== undefined && patch.timeframe !== state.timeframe
          || patch.feedEpoch !== undefined && patch.feedEpoch !== state.feedEpoch;
        const normalized = { ...patch, ...priceScalePatch(patch, state) };
        return changed && patch.candles === undefined ? { ...normalized, candles: [] } : normalized;
      }),
      addIndicator: (indicator) =>
        set((s) => ({ indicators: [...s.indicators, indicator], legendCollapsed: false })),
      updateIndicator: (id, patch) =>
        set((s) => ({
          indicators: s.indicators.map((i) =>
            i.id === id ? { ...i, ...patch } : i,
          ),
        })),
      removeIndicator: (id) =>
        set((s) => ({ indicators: s.indicators.filter((i) => i.id !== id) })),
      toast: (title, message, tone = "info") =>
        set((s) => ({
          toasts: [
            ...s.toasts.slice(-5),
            { id: crypto.randomUUID(), title, message, tone, time: Date.now() },
          ],
        })),
      dismissToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: scopedName("affentrader-chart-v1"),
      storage: createShallowPersistStorage(hotStorage),
      partialize: (s) => ({
        chartTrading:s.chartTrading,
        symbol: s.symbol,
        timeframe: s.timeframe,
        chartType: s.chartType,
        logarithmic: s.logarithmic,
        scaleMode: s.scaleMode,
        feedMode: s.feedMode,
        indicators: s.indicators,
        legendCollapsed: s.legendCollapsed,
        chartView: s.chartView,
        chartAppearance: s.chartAppearance,
        seriesPreferences: s.seriesPreferences,
        statusLine: s.statusLine,
        chartTypeSettings: s.chartTypeSettings,
        compares: s.compares,
        patternOptions: s.patternOptions,
        patternsOn: s.patternsOn,
        optionsWallsOn: s.optionsWallsOn,
        optionsWallsConfig: s.optionsWallsConfig,
        aiAnalysisLayers: s.aiAnalysisLayers,
        favoriteIntervals: s.favoriteIntervals,
        session: s.session,
        timezone: s.timezone,
        adjustDividends: s.adjustDividends,
        drawings: s.drawings,
        drawingPreferences: s.drawingPreferences,
        drawingTrees: s.drawingTrees,
        pineLibraries: s.pineLibraries,
        pineDraft: s.pineDraft,
        bottomOpen: s.bottomOpen,
        bottomTab: s.bottomTab,
      }),
    },
  ),
);
