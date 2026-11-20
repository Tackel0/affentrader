import { useChartStore } from "@/stores/useChartStore";
import { hotStorage } from "@/lib/debouncedStorage";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { useAlertStore } from "@/stores/useAlertStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { parseWorkspace, type WorkspaceBackup } from "./workspace";
import { useStrategyStore } from "@/stores/useStrategyStore";
import { editAlerts, browserAlertOwner } from "@/lib/alerts/browserOwnership";
export function createWorkspaceBackup(): WorkspaceBackup {
  useWorkspaceStore.getState().capture();
  const chart = useChartStore.getState(),
    watchlists = useWatchlistStore.getState(),
    alerts = useAlertStore.getState(),
    premium = useWorkspaceStore.getState();
  return {
    version: 1,
    chart: {
      version: 0,
      state: {
        symbol: chart.symbol,
        timeframe: chart.timeframe,
        chartType: chart.chartType,
        logarithmic: chart.logarithmic,
        scaleMode: chart.scaleMode,
        feedMode: chart.feedMode,
        indicators: chart.indicators,
        legendCollapsed: chart.legendCollapsed,
        chartView: chart.chartView,
        chartAppearance: chart.chartAppearance,
        seriesPreferences: chart.seriesPreferences,
        statusLine: chart.statusLine,
        chartTypeSettings: chart.chartTypeSettings,
        compares: chart.compares.map((c) => ({ ...c, error: undefined })),
        patternOptions: chart.patternOptions,
        patternsOn: chart.patternsOn,
        favoriteIntervals: chart.favoriteIntervals,
        session: chart.session,
        timezone:chart.timezone,
        chartTrading:chart.chartTrading,
        adjustDividends: chart.adjustDividends,
        drawings: chart.drawings,
        drawingPreferences: chart.drawingPreferences,
        drawingTrees: chart.drawingTrees,
        pineLibraries: chart.pineLibraries,
        pineDraft: chart.pineDraft,
        bottomOpen: chart.bottomOpen,
        bottomTab: chart.bottomTab,
      },
    },
    watchlists: {
      version: 0,
      state: { lists: watchlists.lists, activeId: watchlists.activeId },
    },
    alerts: {
      version: 0,
      state: {
        alerts: alerts.alerts,
        logs: alerts.logs,
        // Webhook secrets are credentials: they stay out of exported files.
        rules: alerts.rules.map((r) =>
          r.webhook ? { ...r, webhook: { url: r.webhook.url } } : r,
        ),
        events: alerts.events.map((e) => ({ ...e, delivery: undefined })),
      },
    },
    strategy: {
      version: 0,
      state: { document: useStrategyStore.getState().document },
    },
    premium: {
      version: 0,
      state: {
        theme: premium.theme,
        layout: premium.layout,
        activeId: premium.activeId,
        cells: premium.cells,
        sync: premium.sync,
        sidebarWidth: premium.sidebarWidth,
        layouts: premium.layouts,
        studies: premium.studies,
        domPreferences:premium.domPreferences,
      },
    },
  };
}

/** Write a validated backup into the browser's storage and reload the app. */
export async function restoreWorkspace(data: WorkspaceBackup): Promise<void> {
  await editAlerts(()=>{
  browserAlertOwner().stop();
  // Queued writes of the live stores must not land on top of the restored data.
  hotStorage.discard();
  for (const [key, value] of [
    ["affentrader-chart-v1", data.chart],
    ["affentrader-watchlists-v1", data.watchlists],
    ["affentrader-alerts-v1", data.alerts],
  ] as const)
    localStorage.setItem(key, JSON.stringify(value));
  if (data.premium)
    localStorage.setItem("affentrader-premium-v1", JSON.stringify(data.premium));
  if (data.strategy)
    localStorage.setItem("affentrader-strategy-v1", JSON.stringify(data.strategy));
  window.location.reload();
  });
}

/** Parse, validate and restore a backup file's text. */
export async function restoreWorkspaceText(text: string): Promise<void> {
  await restoreWorkspace(parseWorkspace(text));
}

/** Fingerprint an exact exported snapshot, or the current workspace when omitted. */
export function workspaceFingerprint(text = JSON.stringify(createWorkspaceBackup())): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}
