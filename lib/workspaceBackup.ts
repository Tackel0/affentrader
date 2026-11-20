import { useChartStore } from "@/stores/useChartStore";
import { hotStorage } from "@/lib/debouncedStorage";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { useAlertStore } from "@/stores/useAlertStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { parseWorkspace, type WorkspaceBackup } from "./workspace";
import { useStrategyStore } from "@/stores/useStrategyStore";
import { editAlerts, browserAlertOwner } from "@/lib/alerts/browserOwnership";
import { shallow } from "zustand/vanilla/shallow";

function readBackupState() {
  const chart = useChartStore.getState();
  const watchlists = useWatchlistStore.getState();
  const alerts = useAlertStore.getState();
  const premium = useWorkspaceStore.getState();
  return {
    chart: {
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
      compares: chart.compares,
      patternOptions: chart.patternOptions,
      patternsOn: chart.patternsOn,
      favoriteIntervals: chart.favoriteIntervals,
      session: chart.session,
      timezone: chart.timezone,
      chartTrading: chart.chartTrading,
      adjustDividends: chart.adjustDividends,
      drawings: chart.drawings,
      drawingPreferences: chart.drawingPreferences,
      drawingTrees: chart.drawingTrees,
      pineLibraries: chart.pineLibraries,
      pineDraft: chart.pineDraft,
      bottomOpen: chart.bottomOpen,
      bottomTab: chart.bottomTab,
    },
    watchlists: { lists: watchlists.lists, activeId: watchlists.activeId },
    alerts: {
      alerts: alerts.alerts,
      logs: alerts.logs,
      rules: alerts.rules,
      events: alerts.events,
    },
    strategy: { document: useStrategyStore.getState().document },
    premium: {
      theme: premium.theme,
      layout: premium.layout,
      activeId: premium.activeId,
      cells: premium.cells,
      sync: premium.sync,
      sidebarWidth: premium.sidebarWidth,
      layouts: premium.layouts,
      studies: premium.studies,
      domPreferences: premium.domPreferences,
    },
    applyingCell: premium.applyingCell,
  };
}

type BackupState = ReturnType<typeof readBackupState>;

function buildBackup(state: BackupState): WorkspaceBackup {
  return {
    version: 1,
    chart: {
      version: 0,
      state: { ...state.chart, compares: state.chart.compares.map((c) => ({ ...c, error: undefined })) },
    },
    watchlists: { version: 0, state: state.watchlists },
    alerts: {
      version: 0,
      state: {
        ...state.alerts,
        // Webhook secrets are credentials: they stay out of exported files.
        rules: state.alerts.rules.map((r) =>
          r.webhook ? { ...r, webhook: { url: r.webhook.url } } : r,
        ),
        events: state.alerts.events.map((e) => ({ ...e, delivery: undefined })),
      },
    },
    strategy: { version: 0, state: state.strategy },
    premium: { version: 0, state: state.premium },
  };
}

export function createWorkspaceBackup(): WorkspaceBackup {
  useWorkspaceStore.getState().capture();
  return buildBackup(readBackupState());
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

function fingerprintText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

let lastFingerprint: { state: BackupState; value: string } | undefined;

/** Fingerprint an exact exported snapshot, or the current workspace when omitted. */
export function workspaceFingerprint(text?: string): string {
  if (text !== undefined) return fingerprintText(text);

  const current = readBackupState();
  const previous = lastFingerprint;
  // Backup stores replace saved values on edits. Market updates can replace the
  // outer chart state while leaving every field included in the backup intact.
  if (previous
    && current.applyingCell === previous.state.applyingCell
    && shallow(current.chart, previous.state.chart)
    && shallow(current.watchlists, previous.state.watchlists)
    && shallow(current.alerts, previous.state.alerts)
    && shallow(current.strategy, previous.state.strategy)
    && shallow(current.premium, previous.state.premium)) {
    return previous.value;
  }

  useWorkspaceStore.getState().capture();
  const state = readBackupState();
  const value = fingerprintText(JSON.stringify(buildBackup(state)));
  lastFingerprint = { state, value };
  return value;
}
