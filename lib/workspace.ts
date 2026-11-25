import {validChartTrading} from "@/lib/trading/chartPreferences";
import {validDomPreferences} from "@/lib/orderflow/domPreferences";
import {validSearchPreferences} from "@/lib/market/symbolSearch";
import { retainedTpoReference } from "@/lib/alerts/tpoDraft";
import { validStatusLine } from "@/lib/chart/statusLine";
import { validScaleMode } from "@/lib/chart/scaleMode";
import { validChartTypeSettings } from "@/lib/chart/derivedSettings";
import { validSeriesPreferences } from "@/lib/chart/seriesPreferences";
import { validAppearancePreferences } from "@/lib/chart/appearance";
import { validChartView } from "@/lib/chart/viewPreferences";
import { isValidInterval } from "@/lib/market/intervals";
import { CHART_TYPE_IDS } from "@/lib/chart/chartTypes";
import { validateRuleShape } from "@/lib/alerts/rules";
import { validateRateFields } from "@/lib/alerts/rateLimit";
import { validateTiming } from "@/lib/alerts/schedule";
import { isPineOrderFill } from "@/lib/alerts/pineValidation";
import { isSymbolId } from "@/lib/symbolId";
import { isValidZone } from "@/lib/timezones";
import { LAYOUTS } from "@/stores/useWorkspaceStore";
import { parseStrategyDocument } from "@/lib/strategy/settings";
import { parseDrawingPreferences } from "@/lib/drawings/preferences";
import { COLUMN_LABELS } from "@/lib/watchlist";
import { opportunityPlan } from "@/lib/screener/opportunities";
import type { SetupRecord } from "@/lib/screener/setupJournal";
type JsonRecord = Record<string, unknown>;
const BOTTOM_TABS = [
  "overview",
  "pine",
  "strategy",
  "orderflow",
  "trading",
  "dom",
  "portfolio",
  "screener",
  "news",
  "calendar",
  "heatmap",
  "terminal",
];
export interface WorkspaceBackup {
  version: 1;
  chart: { state: JsonRecord; version?: number };
  watchlists: { state: JsonRecord; version?: number };
  alerts: { state: JsonRecord; version?: number };
  premium?: { state: JsonRecord; version?: number };
  strategy?: {
    state: { document: ReturnType<typeof parseStrategyDocument> };
    version?: number;
  };
  setups?: { state: { records: readonly SetupRecord[] }; version?: number };
}
const record = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 200): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const symbol = (value: unknown): value is string => isSymbolId(value);
export function parseWorkspace(content: string): WorkspaceBackup {
  if (content.length > 8_000_000)
    throw new Error("Workspace exceeds the 8 MB import limit.");
  const data: unknown = JSON.parse(content);
  if (!record(data) || data.version !== 1)
    throw new Error("Unsupported workspace version.");
  for (const key of ["chart", "watchlists", "alerts"])
    if (!record(data[key]) || !record(data[key].state))
      throw new Error(`Missing ${key} state.`);
  const backup = data as unknown as WorkspaceBackup;
  const chart = backup.chart.state,
    watch = backup.watchlists.state,
    alerts = backup.alerts.state;
  for (const [state, allowed] of [
    [
      chart,
      [
        "symbol",
        "timeframe",
        "chartType",
        "logarithmic",
        "scaleMode",
        "feedMode",
        "indicators",
        "legendCollapsed",
        "chartView",
        "chartAppearance",
        "seriesPreferences",
        "statusLine",
        "chartTypeSettings",
        "compares",
        "patternOptions",
        "patternsOn",
        "favoriteIntervals",
        "session",
        "timezone",
        "chartTrading",
        "adjustDividends",
        "drawings",
        "drawingPreferences",
        "drawingTrees",
        "pineLibraries",
        "pineDraft",
        "bottomOpen",
        "bottomTab",
      ],
    ],
    [watch, ["lists", "activeId", "columns", "sort"]],
    [alerts, ["alerts", "logs", "rules", "events"]],
  ] as const) {
    if (
      Object.keys(state).some(
        (key) => !(allowed as readonly string[]).includes(key),
      )
    )
      throw new Error("Unexpected workspace state field.");
  }
  if (
    !symbol(chart.symbol) ||
    typeof chart.timeframe !== "string" ||
    !isValidInterval(chart.timeframe) ||
    !CHART_TYPE_IDS.includes(String(chart.chartType)) ||
    !["auto", "simulation"].includes(String(chart.feedMode))
  )
    throw new Error("Invalid chart market or display configuration.");
  if (!Array.isArray(chart.indicators) || chart.indicators.length > 100)
    throw new Error("Invalid indicator collection.");
  if(chart.logarithmic!==undefined&&typeof chart.logarithmic!=="boolean")throw new Error("Invalid logarithmic chart scale.");
  if(chart.scaleMode!==undefined&&(!validScaleMode(chart.scaleMode)||chart.scaleMode!=="price"&&chart.logarithmic===true))throw new Error("Invalid price scale mode.");
  if(chart.legendCollapsed!==undefined&&typeof chart.legendCollapsed!=="boolean")throw new Error("Invalid indicator legend preference.");
  if(chart.seriesPreferences!==undefined&&chart.seriesPreferences!==null&&!validSeriesPreferences(chart.seriesPreferences))throw new Error("Invalid chart series preferences.");
  if(chart.chartAppearance!==undefined&&chart.chartAppearance!==null&&!validAppearancePreferences(chart.chartAppearance))throw new Error("Invalid chart appearance preferences.");
  if(chart.chartView!==undefined&&chart.chartView!==null&&!validChartView(chart.chartView))throw new Error("Invalid chart view preferences.");
  if(chart.statusLine!==undefined&&!validStatusLine(chart.statusLine))throw new Error("Invalid status line preferences.");
  const ids = new Set<string>();
  if (
    chart.bottomTab !== undefined &&
    !BOTTOM_TABS.includes(String(chart.bottomTab))
  )
    throw new Error("Invalid bottom panel tab.");
  if (chart.pineDraft !== undefined && chart.pineDraft !== null) {
    const draft = chart.pineDraft;
    if (
      !record(draft) ||
      typeof draft.name !== "string" ||
      draft.name.length > 100 ||
      typeof draft.source !== "string" ||
      draft.source.length > 500000 ||
      !(draft.activeId === null || text(draft.activeId)) ||
      Object.keys(draft).some(
        (k) => !["name", "source", "activeId"].includes(k),
      )
    )
      throw new Error("Invalid Pine editor draft.");
  }
  for (const indicator of chart.indicators) {
    if (
      !record(indicator) ||
      !text(indicator.id) ||
      ids.has(indicator.id) ||
      !text(indicator.definitionId) ||
      !text(indicator.name) ||
      typeof indicator.visible !== "boolean" ||
      !record(indicator.inputs) ||
      !/^#[a-f0-9]{6}$/i.test(String(indicator.color)) ||
      !finite(indicator.lineWidth) ||
      indicator.lineWidth < 1 ||
      indicator.lineWidth > 10 ||
      !["close", "open", "high", "low", "hl2", "hlc3"].includes(
        String(indicator.source),
      )
    )
      throw new Error("Invalid indicator settings.");
    ids.add(indicator.id);
    if (indicator.valuesInStatusLine !== undefined && typeof indicator.valuesInStatusLine !== "boolean")
      throw new Error("Invalid indicator status line visibility.");
    if (indicator.valuesOnPriceScale !== undefined && typeof indicator.valuesOnPriceScale !== "boolean")
      throw new Error("Invalid indicator price-scale visibility.");
    if (indicator.script !== undefined && !text(indicator.script, 500_000))
      throw new Error("Invalid Pine source.");
    for (const v of Object.values(indicator.inputs))
      if (!(typeof v === "boolean" || typeof v === "string" || finite(v)))
        throw new Error("Invalid indicator input.");
  }
  if (
    !Array.isArray(watch.lists) ||
    !watch.lists.length ||
    watch.lists.length > 100
  )
    throw new Error("A workspace needs between 1 and 100 watchlists.");
  const listIds = new Set<string>();
  for (const list of watch.lists) {
    if (
      !record(list) ||
      !text(list.id) ||
      listIds.has(list.id) ||
      !text(list.name, 40) ||
      !Array.isArray(list.symbols) ||
      list.symbols.length > 1100 ||
      !list.symbols.every(
        (entry) =>
          symbol(entry) ||
          (typeof entry === "string" && entry.startsWith("###") && entry.length <= 43),
      ) ||
      list.symbols.filter((entry) => !String(entry).startsWith("###")).length > 1000 ||
      (list.flags !== undefined &&
        (!record(list.flags) ||
          Object.values(list.flags).some(
            (flag) => !["red", "orange", "yellow", "green", "blue", "purple"].includes(String(flag)),
          )))
    )
      throw new Error("Invalid watchlist.");
    listIds.add(list.id);
  }
  if (!listIds.has(String(watch.activeId)))
    throw new Error("Active watchlist was not found.");
  if (watch.columns !== undefined && (!Array.isArray(watch.columns) || !watch.columns.length ||
    new Set(watch.columns).size !== watch.columns.length || watch.columns.some(column => typeof column !== "string" || !Object.hasOwn(COLUMN_LABELS, column)))) {
    throw new Error("Invalid watchlist columns.");
  }
  if (watch.sort != null && (!record(watch.sort) || typeof watch.sort.column !== "string" ||
    !(["symbol", "flag"].includes(watch.sort.column) || Object.hasOwn(COLUMN_LABELS, watch.sort.column)) ||
    !["asc", "desc"].includes(String(watch.sort.direction)))) throw new Error("Invalid watchlist sorting.");
  if (
    !Array.isArray(alerts.alerts) ||
    alerts.alerts.length > 200 ||
    !Array.isArray(alerts.logs) ||
    alerts.logs.length > 200
  )
    throw new Error("Invalid alert collection.");
  for (const log of alerts.logs) {
    if (
      !record(log) ||
      !text(log.id) ||
      !text(log.alertId) ||
      !text(log.name) ||
      !symbol(log.symbol) ||
      !finite(log.price) ||
      !finite(log.time) ||
      typeof log.simulated !== "boolean" ||
      ![
        "crossing",
        "crossing_up",
        "crossing_down",
        "entering_band",
        "exiting_band",
      ].includes(String(log.condition))
    )
      throw new Error("Invalid alert log entry.");
  }
  for (const alert of alerts.alerts) {
    if (
      !record(alert) ||
      !text(alert.id) ||
      !text(alert.name, 100) ||
      !symbol(alert.symbol) ||
      !finite(alert.price) ||
      alert.price <= 0 ||
      ![
        "crossing",
        "crossing_up",
        "crossing_down",
        "entering_band",
        "exiting_band",
      ].includes(String(alert.condition)) ||
      !["active", "paused", "triggered", "expired", "stopped"].includes(String(alert.status)) ||
      !["tick", "close"].includes(String(alert.frequency)) ||
      typeof alert.timeframe !== "string" ||
      !isValidInterval(alert.timeframe) ||
      !finite(alert.createdAt) ||
      !["repeat", "sound", "browserNotification", "simulated"].every(
        (k) => typeof alert[k] === "boolean",
      )
    )
      throw new Error("Invalid price alert.");
    if (alert.tpoReference !== undefined && !retainedTpoReference(alert.tpoReference, alert as unknown as import("@/types/trading").PriceAlert))
      throw new Error("Invalid TPO alert reference.");
    const timingError = validateTiming(alert as unknown as import("@/types/trading").PriceAlert);
    if (timingError) throw new Error(timingError);
    const rateError = validateRateFields(alert as unknown as import("@/types/trading").PriceAlert);
    if (rateError || alert.status === "stopped" && !alert.stop) throw new Error(rateError ?? "Stopped alert needs a reason.");
    if (alert.lastTriggeredAt !== undefined && !finite(alert.lastTriggeredAt) || alert.lastTriggeredBar !== undefined && !finite(alert.lastTriggeredBar)) throw new Error("Invalid price alert firing history.");
    if (
      String(alert.condition).endsWith("_band") &&
      (!finite(alert.upperPrice) || alert.upperPrice <= alert.price)
    )
      throw new Error("Invalid alert band.");
  }
  validateChartExtras(chart);
  if (alerts.rules !== undefined) {
    if (!Array.isArray(alerts.rules) || alerts.rules.length > 300)
      throw new Error("Invalid alert rule collection.");
    const ruleIds = new Set<string>();
    for (const item of alerts.rules) {
      const problem = validateRuleShape(item);
      if (problem || ruleIds.has((item as { id: string }).id))
        throw new Error(`Invalid alert rule: ${problem ?? "duplicate id"}`);
      ruleIds.add((item as { id: string }).id);
    }
  }
  if (
    alerts.events !== undefined &&
    (!Array.isArray(alerts.events) ||
      alerts.events.length > 300 ||
      alerts.events.some(
        (e) =>
          !record(e) ||
          !text(e.id) ||
          !text(e.ruleId) ||
          !text(e.name, 100) ||
          !symbol(e.symbol) ||
          !finite(e.time) || e.barTime !== undefined && !finite(e.barTime) || e.scriptGate !== undefined && (!record(e.scriptGate) || typeof e.scriptGate.key !== "string" || !/^[\w-]{1,80}$/.test(e.scriptGate.key) || !finite(e.scriptGate.bar) || e.scriptGate.token !== undefined && (typeof e.scriptGate.token !== "string" || !e.scriptGate.token || e.scriptGate.token.length > 300)) || e.strategyFill !== undefined && !isPineOrderFill(e.strategyFill),
      ))
  )
    throw new Error("Invalid alert event.");
  if (
    chart.pineLibraries !== undefined &&
    (!record(chart.pineLibraries) ||
      Object.values(chart.pineLibraries).some((v) => !text(v, 500_000)))
  )
    throw new Error("Invalid Pine library collection.");
  if (
    chart.drawings !== undefined &&
    (!record(chart.drawings) ||
      Object.values(chart.drawings).some(
        (v) => !record(v) || v.version !== 1 || !Array.isArray(v.drawings),
      ))
  )
    throw new Error("Invalid drawings document.");
  if (backup.premium) validatePremium(backup.premium, backup);
  if (backup.strategy) {
    if (
      !record(backup.strategy) ||
      !record(backup.strategy.state) ||
      Object.keys(backup.strategy.state).some((k) => k !== "document")
    )
      throw new Error("Invalid strategy workspace state.");
    parseStrategyDocument(backup.strategy.state.document);
  }
  if (backup.setups !== undefined) {
    const rows = backup.setups?.state?.records;
    const ids = new Set<string>();
    if (!Array.isArray(rows) || rows.some(row => {
      if (!row || !text(row.id, 300) || ids.has(row.id) || !symbol(row.symbol) || !text(row.ticker, 30) ||
        !text(row.name) || !text(row.label) || !text(row.currency, 16) || !/^\d{4}-\d{2}-\d{2}$/.test(row.session) ||
        !finite(row.observedAt) || row.observedAt < 0 || row.observedAt > 8.64e15 || !finite(row.score) ||
        typeof row.tracked !== "boolean" || !opportunityPlan(row.levels)) return true;
      ids.add(row.id);
      return false;
    })) throw new Error("Invalid saved setups.");
  }
  return backup;
}
function validateChartExtras(chart: JsonRecord) {
  if (chart.drawingPreferences !== undefined) parseDrawingPreferences(chart.drawingPreferences);
  if (chart.drawingTrees !== undefined) {
    const trees = chart.drawingTrees;
    if (!record(trees) || Object.keys(trees).length > 200) throw new Error("Invalid drawing groups.");
    for (const tree of Object.values(trees)) {
      if (
        !record(tree) ||
        !Array.isArray(tree.groups) ||
        tree.groups.length > 200 ||
        !record(tree.assignments) ||
        !record(tree.names) ||
        tree.groups.some(
          (g) =>
            !record(g) ||
            !text(g.id) ||
            !text(g.name, 40) ||
            !(g.parent === null || text(g.parent)) ||
            typeof g.collapsed !== "boolean",
        ) ||
        Object.values(tree.assignments).some((v) => !text(v)) ||
        Object.values(tree.names).some((v) => !text(v, 60))
      )
        throw new Error("Invalid drawing groups.");
    }
  }
  if (chart.chartTypeSettings !== undefined && !validChartTypeSettings(chart.chartTypeSettings))
    throw new Error("Invalid chart type settings.");
  if (chart.compares !== undefined) {
    if (!Array.isArray(chart.compares) || chart.compares.length > 20)
      throw new Error("Invalid comparison collection.");
    for (const c of chart.compares)
      if (
        !record(c) ||
        !text(c.id) ||
        !["symbol", "formula"].includes(String(c.kind)) ||
        !text(c.label, 500) ||
        !/^#[a-f0-9]{6}$/i.test(String(c.color)) ||
        !finite(c.lineWidth) ||
        !["relative", "own", "price"].includes(String(c.scale)) ||
        typeof c.visible !== "boolean"
      )
        throw new Error("Invalid comparison series.");
  }
  if (chart.patternOptions !== undefined) {
    const o = chart.patternOptions;
    if (
      !record(o) ||
      typeof o.candlestick !== "boolean" ||
      typeof o.chart !== "boolean" ||
      !Array.isArray(o.disabled) ||
      o.disabled.length > 200 ||
      !o.disabled.every((d) => text(d, 60)) ||
      !finite(o.minConfidence) ||
      !finite(o.lookback)
    )
      throw new Error("Invalid pattern options.");
  }
  if (chart.patternsOn !== undefined && typeof chart.patternsOn !== "boolean")
    throw new Error("Invalid pattern flag.");
  if (chart.session !== undefined && !["regular", "extended"].includes(String(chart.session)))
    throw new Error("Invalid trading session.");
  if(chart.chartTrading!==undefined&&!validChartTrading(chart.chartTrading))throw new Error("Invalid chart trading preferences.");
  if (chart.timezone !== undefined && !isValidZone(chart.timezone)) throw new Error("Invalid time zone.");
  if (chart.adjustDividends !== undefined && typeof chart.adjustDividends !== "boolean")
    throw new Error("Invalid adjustment flag.");
  if (
    chart.favoriteIntervals !== undefined &&
    (!Array.isArray(chart.favoriteIntervals) ||
      chart.favoriteIntervals.length > 60 ||
      !chart.favoriteIntervals.every((i) => typeof i === "string" && isValidInterval(i)))
  )
    throw new Error("Invalid favorite intervals.");
}
function validatePremium(value: unknown, backup: WorkspaceBackup) {
  if (!record(value) || !record(value.state))
    throw new Error("Invalid layout state.");
  const s = value.state;
  if (
    Object.keys(s).some(
      (key) =>
        ![
          "theme",
          "layout",
          "activeId",
          "cells",
          "sync",
          "sidebarWidth",
          "layouts",
          "studies",
          "domPreferences",
          "searchPreferences",
        ].includes(key),
    )
  )
    throw new Error("Unexpected layout state field.");
  if(s.domPreferences!==undefined&&!validDomPreferences(s.domPreferences))throw new Error("Invalid DOM workspace settings.");
  if(s.searchPreferences!==undefined&&!validSearchPreferences(s.searchPreferences))throw new Error("Invalid search workspace settings.");
  if (
    !["light", "dark"].includes(String(s.theme)) ||
    !finite(s.sidebarWidth) ||
    s.sidebarWidth < 240 ||
    s.sidebarWidth > 520
  )
    throw new Error("Invalid workspace appearance.");
  const validateSync = (sync: unknown) => {
    if (
      !record(sync) ||
      Object.keys(sync).length !== 4 ||
      !["symbol", "interval", "crosshair", "timeRange"].every(
        (key) => typeof sync[key] === "boolean",
      )
    )
      throw new Error("Invalid chart synchronization.");
  };
  const minimalWatchlists = {
    version: 0,
    state: { lists: [{ id: "w", name: "W", symbols: ["BTCUSDT"] }], activeId: "w" },
  };
  const minimalAlerts = { version: 0, state: { alerts: [], rules: [], logs: [] } };
  const minimalChartBase = {
    symbol: backup.chart.state.symbol,
    timeframe: backup.chart.state.timeframe,
    chartType: backup.chart.state.chartType,
    feedMode: backup.chart.state.feedMode,
    indicators: [] as unknown[],
  };
  const validateStudies = (indicators: unknown) =>
    parseWorkspace(
      JSON.stringify({
        version: 1,
        chart: { state: { ...minimalChartBase, indicators } },
        watchlists: minimalWatchlists,
        alerts: minimalAlerts,
      }),
    );
  const validateCells = (
    cells: unknown,
    layout: unknown,
    activeId: unknown,
  ) => {
    const config = LAYOUTS.find((l) => l.id === layout);
    if (
      !config ||
      !Array.isArray(cells) ||
      cells.length < config.count ||
      cells.length > 8
    )
      throw new Error("Invalid chart grid.");
    const ids = new Set();
    for (const cell of cells) {
      if (!record(cell) || !text(cell.id) || ids.has(cell.id))
        throw new Error("Invalid chart cell.");
      ids.add(cell.id);
      parseWorkspace(
        JSON.stringify({
          version: 1,
          chart: {
            state: {
              ...minimalChartBase,
              symbol: cell.symbol,
              timeframe: cell.timeframe,
              chartType: cell.chartType,
              chartTypeSettings: cell.chartTypeSettings,
              logarithmic: cell.logarithmic,
              scaleMode: cell.scaleMode,
              legendCollapsed: cell.legendCollapsed,
              chartView: cell.chartView,
              chartAppearance: cell.chartAppearance,
              seriesPreferences: cell.seriesPreferences,
              statusLine: cell.statusLine,
              indicators: cell.indicators,
            },
          },
          watchlists: minimalWatchlists,
          alerts: minimalAlerts,
        }),
      );
    }
    if (!cells.slice(0, config.count).some((c) => c.id === activeId))
      throw new Error("Active chart is outside the grid.");
  };
  validateCells(s.cells, s.layout, s.activeId);
  validateSync(s.sync);
  if (
    !Array.isArray(s.layouts) ||
    s.layouts.length > 50 ||
    !Array.isArray(s.studies) ||
    s.studies.length > 100
  )
    throw new Error("Invalid template collection.");
  for (const layout of s.layouts) {
    if (
      !record(layout) ||
      !text(layout.id) ||
      !text(layout.name, 60) ||
      !finite(layout.savedAt)
    )
      throw new Error("Invalid saved layout.");
    validateCells(layout.cells, layout.layout, layout.activeId);
    validateSync(layout.sync);
  }
  for (const study of s.studies) {
    if (
      !record(study) ||
      !text(study.id) ||
      !text(study.name, 60) ||
      !finite(study.savedAt)
    )
      throw new Error("Invalid indicator template.");
    validateStudies(study.indicators);
  }
}
