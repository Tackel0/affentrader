import { useChartStore } from "@/stores/useChartStore";
import { hotStorage } from "@/lib/debouncedStorage";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { useAlertStore } from "@/stores/useAlertStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { parseWorkspace, type WorkspaceBackup } from "./workspace";
import { useStrategyStore } from "@/stores/useStrategyStore";
import { editAlerts, browserAlertOwner } from "@/lib/alerts/browserOwnership";
import { shallow } from "zustand/vanilla/shallow";
import { useSetupJournal } from "@/stores/useSetupJournal";
import { accountScopedName, readWorkspaceProfile, workspaceProfile } from "@/lib/accountScope";

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
    watchlists: { lists: watchlists.lists, activeId: watchlists.activeId, columns: watchlists.columns, sort: watchlists.sort },
    alerts: {
      alerts: alerts.alerts,
      logs: alerts.logs,
      rules: alerts.rules,
      events: alerts.events,
    },
    strategy: { document: useStrategyStore.getState().document },
    setups: { records: useSetupJournal.getState().records },
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
      searchPreferences: premium.searchPreferences,
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
    setups: { version: 0, state: state.setups },
    premium: { version: 0, state: state.premium },
  };
}

export function createWorkspaceBackup(): WorkspaceBackup {
  useWorkspaceStore.getState().capture();
  return buildBackup(readBackupState());
}

/** Write a validated backup into the browser's storage and reload the app. */
const backupStorage = {
  chart: "affentrader-chart-v1", watchlists: "affentrader-watchlists-v1", alerts: "affentrader-alerts-v1",
  premium: "affentrader-premium-v1", strategy: "affentrader-strategy-v1", setups: "affentrader-setups-v1",
} as const;

export async function restoreWorkspace(data: WorkspaceBackup, canRestore = () => true): Promise<void> {
  const applyRestore = () => {
    if (workspaceProfile() !== readWorkspaceProfile() || !canRestore()) throw new Error("Der Workspace wurde inzwischen geändert.");
    const updates = (Object.keys(backupStorage) as (keyof typeof backupStorage)[]).flatMap(section => {
      const value = data[section];
      return value ? [[accountScopedName(backupStorage[section]), JSON.stringify(value)] as const] : [];
    });
    hotStorage.flush();
    const previous = new Map(updates.map(([key]) => [key, localStorage.getItem(key)]));
    const written: string[] = [];
    try {
      for (const [key, value] of updates) { localStorage.setItem(key, value); written.push(key); }
    } catch (error) {
      for (const key of written.reverse()) {
        const value = previous.get(key);
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      throw error;
    }
    browserAlertOwner().stop();
    hotStorage.discard();
    window.location.reload();
  };
  try {
    await editAlerts(applyRestore);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A full validated backup replaces affentrader-alerts-v1 outright, so allow recovery when
    // the previous local alert storage is corrupted or Web Locks are unavailable (non-HTTPS LAN).
    const recoverable =
      message.includes("Saved alerts could not be read") ||
      message.includes("browser lock coordination");
    if (!recoverable) throw error;
    applyRestore();
  }
}

/** Parse, validate and restore a backup file's text. */
export async function restoreWorkspaceText(text: string, canRestore?: () => boolean): Promise<void> {
  await restoreWorkspace(parseWorkspace(text), canRestore);
}

export function hasLegacyWorkspace() {
  try { return [backupStorage.chart, backupStorage.watchlists, backupStorage.premium].some(key => localStorage.getItem(key) !== null); }
  catch { return false; }
}

export async function importLegacyWorkspace() {
  if (!workspaceProfile() || !hasLegacyWorkspace()) throw new Error("In diesem Browser ist kein bisheriger Workspace verfügbar.");
  const snapshot = createWorkspaceBackup();
  const source = snapshot as unknown as Record<string, { state: Record<string, unknown>; version: number }>;
  for (const [section, key] of Object.entries(backupStorage)) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    const loaded = JSON.parse(raw) as { state?: Record<string, unknown> };
    if (!loaded?.state || typeof loaded.state !== "object") throw new Error("Der bisherige Workspace ist beschädigt.");
    for (const field of Object.keys(source[section].state)) {
      if (field in loaded.state) source[section].state[field] = loaded.state[field];
    }
  }
  // Legacy webhook credentials are local to the previous profile.
  if (Array.isArray(source.alerts.state.rules)) source.alerts.state.rules = source.alerts.state.rules.map(rule => rule.webhook ? { ...rule, webhook: { url: rule.webhook.url } } : rule);
  await restoreWorkspaceText(JSON.stringify(snapshot));
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
    && shallow(current.setups, previous.state.setups)
    && shallow(current.premium, previous.state.premium)) {
    return previous.value;
  }

  useWorkspaceStore.getState().capture();
  const state = readBackupState();
  const value = fingerprintText(JSON.stringify(buildBackup(state)));
  lastFingerprint = { state, value };
  return value;
}
