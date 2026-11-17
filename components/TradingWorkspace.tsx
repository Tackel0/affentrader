"use client";
import { MarketConnections } from "./MarketConnections";
import { TradeArchive } from "./TradeArchive";
import { useTradeArchiveStore } from "@/stores/useTradeArchiveStore";
import { useAlpacaStore } from "@/stores/useAlpacaStore";
import {currentPriceAlertDraft} from "@/lib/alerts/priceDraft";
import {NativeChartDialogs} from "./NativeChartDialogs";
import {OrderPresetSync} from "./OrderPresets";
import {ChartSnapshotDialog} from "./ChartSnapshotDialog";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { bindSidebarChartBounds } from "@/lib/chart/sidebarBounds";
import { bindSidebarResize, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH } from "@/lib/chart/sidebarResize";
import {
  Activity,
  ChevronDown,
  Bell,
  List,
  Layers,
  SquareTerminal,
  X,
  ListTree,
} from "lucide-react";
import { createWorkspaceBackup, restoreWorkspaceText } from "@/lib/workspaceBackup";
import { useMarketData } from "@/hooks/useMarketData";
import { useChartStore } from "@/stores/useChartStore";

import { useAlertStore } from "@/stores/useAlertStore";
import { getSymbol, describeSymbol } from "@/lib/symbols";
import { IconButton } from "./ui";
import { ChartGrid } from "./ChartGrid";
import { WorkspaceToolbar } from "./WorkspaceToolbar";
import { ReplayBar } from "./ReplayBar";
import { DrawingRail } from "./DrawingRail";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { Watchlist } from "./Watchlist";
import { ObjectSidebar } from "./ObjectSidebar";
import { CompareDialog, DerivedDialog, useChartToolHotkeys } from "./ChartTools";
import { SyncDialog } from "./SyncDialog";
import {RangeToolbar} from "./RangeToolbar";
import { useSync } from "@/hooks/useSync";
import { useWindowLink } from "@/hooks/useWindowLink";
import { AlertDialog, AlertsPanel } from "./Alerts";
import { IndicatorPicker, IndicatorSettings } from "./Indicators";
import { SymbolSearch } from "./SymbolSearch";
import { BottomPanel } from "./BottomPanel";
import { downloadFile } from "@/lib/files";
export default function TradingWorkspace({ deployment }: { deployment?: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted)
    return (
      <div className="boot-screen">
        <Activity size={30} />
        <strong>AffenTerminal</strong>
        <span>Preparing your AffenTerminal workspace…</span>
        {deployment}
      </div>
    );
  return <Workspace deployment={deployment} />;
}
function Workspace({ deployment }: { deployment?: ReactNode }) {
  const recordingTrades = useTradeArchiveStore(state => state.enabled);
  const recordingFailed = useTradeArchiveStore(state => Boolean(state.status.error));
  const iexStatus = useAlpacaStore(s => s.status);
  const alpacaEnabled = useAlpacaStore(s => s.enabled);
  useMarketData();
  useChartToolHotkeys();
  useSync();
  useWindowLink();
  const symbol = useChartStore((s) => s.symbol),
    status = useChartStore((s) => s.feedStatus),
    sidebar = useChartStore((s) => s.sidebarTab);
  const theme = useWorkspaceStore((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const alertCount = useAlertStore(
    (s) => s.alerts.filter((a) => a.status === "active").length,
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const sidebarHandle = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const sidebar = sidebarRef.current, chart = sidebar?.parentElement?.querySelector<HTMLElement>(".chart-grid");
    const handle = sidebarHandle.current;
    if (!sidebar || !handle) return;
    const offResize = bindSidebarResize(sidebar, handle, {
      read: () => useWorkspaceStore.getState().sidebarWidth,
      commit: (width) => useWorkspaceStore.getState().setSidebarWidth(width),
      subscribe: (changed) => useWorkspaceStore.subscribe((state, previous) => {
        if (state.sidebarWidth !== previous.sidebarWidth) changed(state.sidebarWidth);
      }),
    });
    const offBounds = chart ? bindSidebarChartBounds(sidebar, chart) : undefined;
    return () => { offResize(); offBounds?.(); };
  }, [sidebarOpen]);
  // Keep the chart visible when entering the phone layout, including resizes.
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 760px)");
    const adapt = () => { if (phone.matches) setSidebarOpen(false); };
    adapt();
    phone.addEventListener("change", adapt);
    return () => phone.removeEventListener("change", adapt);
  }, []);
  const toggleSidebarTab = (tab: "watchlist" | "alerts" | "objects") => {
    setSidebarOpen(open => sidebar === tab ? !open : true);
    useChartStore.getState().set({ sidebarTab: tab });
  };
  const workspaceFile = useRef<HTMLInputElement>(null);
  const command = (kind: "undo" | "redo" | "clear" | "settings" | "fit") =>
    useChartStore.getState().set({ command: { kind, id: Date.now() } });
  const createAlert = () =>
    useChartStore.getState().set({
      alertDraft: currentPriceAlertDraft(),
    });
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable="true"]',
        )
      )
        return;
      const store = useChartStore.getState();
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        store.set({ searchOpen: true, searchTarget: "chart" });
      }
      if (e.key === "Escape") store.set({ drawing: "cursor" });
      if (e.altKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        createAlert();
      }
      if (e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        store.set({ drawing: "trendline" });
      }
      if (e.altKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        store.set({ indicatorsOpen: true });
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => {
      window.removeEventListener("keydown", keyboard);
    };
  }, []);
  const save = () => {
    downloadFile(
      "affentrader-workspace.json",
      JSON.stringify(createWorkspaceBackup(), null, 2),
    );
    useChartStore
      .getState()
      .toast(
        "Workspace exported",
        "Charts, drawings, watchlists and alerts saved to your download.",
        "success",
      );
  };
  const restore = async (file: File) => {
    try {
      await restoreWorkspaceText(await file.text());
    } catch (error) {
      useChartStore.getState().toast("Import failed", String(error), "error");
    }
  };  return (
    <main className={`trading-app theme-${theme}`}>
      <NativeChartDialogs/>
      <MarketConnections/>
      <TradeArchive/>
      <OrderPresetSync/>
      <ChartSnapshotDialog/>
      <WorkspaceToolbar
        onExport={save}
        onImport={() => workspaceFile.current?.click()}
        sidebarOpen={sidebarOpen}
        toggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />
      <input
        hidden
        ref={workspaceFile}
        type="file"
        accept="application/json,.json"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void restore(file);
          e.target.value = "";
        }}
      />
      <div className="workspace-main">
        <DrawingRail />
        <div className="center-workspace">
          <ChartGrid />
          <ReplayBar />
          <RangeToolbar/>
          <BottomPanel />
        </div>
        {sidebarOpen ? (
          <aside
            ref={sidebarRef}
            className="right-sidebar"
            aria-label={
              sidebar === "watchlist"
                ? "Watchlist sidebar"
                : sidebar === "alerts"
                  ? "Alerts sidebar"
                  : "Object tree sidebar"
            }
          >
            <div
              ref={sidebarHandle}
              role="separator"
              aria-label="Resize sidebar"
              aria-orientation="vertical"
              aria-valuemin={MIN_SIDEBAR_WIDTH}
              aria-valuemax={MAX_SIDEBAR_WIDTH}
              tabIndex={0}
              className="sidebar-resizer"
            />
            {sidebar === "watchlist" ? (
              <Watchlist />
            ) : sidebar === "alerts" ? (
              <AlertsPanel />
            ) : (
              <ObjectSidebar />
            )}
          </aside>
        ) : null}
        <aside className="utility-rail">
          <IconButton
            label="Watchlists"
            className={sidebarOpen && sidebar === "watchlist" ? "active" : ""}
            aria-pressed={sidebarOpen && sidebar === "watchlist"}
            onClick={() => toggleSidebarTab("watchlist")}
          >
            <List size={21} />
          </IconButton>
          <div className="rail-alert">
            <IconButton
              label="Alerts"
              className={sidebarOpen && sidebar === "alerts" ? "active" : ""}
              aria-pressed={sidebarOpen && sidebar === "alerts"}
              onClick={() => toggleSidebarTab("alerts")}
            >
              <Bell size={20} />
            </IconButton>
            {alertCount ? <span>{alertCount}</span> : null}
          </div>
          <IconButton
            label="Object tree"
            className={sidebarOpen && sidebar === "objects" ? "active" : ""}
            aria-pressed={sidebarOpen && sidebar === "objects"}
            onClick={() => toggleSidebarTab("objects")}
          >
            <ListTree size={20} />
          </IconButton>
          <IconButton
            label="Order flow panel"
            onClick={() =>
              useChartStore
                .getState()
                .set({ bottomOpen: true, bottomTab: "orderflow" })
            }
          >
            <Layers size={20} />
          </IconButton>
          <IconButton
            label="Pine editor"
            onClick={() =>
              useChartStore
                .getState()
                .set({ bottomOpen: true, bottomTab: "pine" })
            }
          >
            <SquareTerminal size={20} />
          </IconButton>
          <span className="flex-1" />
          <a
            className="engine-link"
            href="https://github.com/luxalgo/vela"
            target="_blank"
            rel="noreferrer"
            title="Powered by Vela"
          >
            V
          </a>
        </aside>
      </div>
      <footer className="app-status">
        {(recordingTrades || recordingFailed) && <button className="archive-recording-status" aria-label={recordingFailed ? "Trade recording stopped; open archive" : "Trade recording active; open archive"} title={recordingFailed ? "Trade recording stopped. Open the local archive for details." : "Recording observed real classified trades locally in this tab."} onClick={() => useTradeArchiveStore.setState({ open: true })}>{recordingFailed ? "REC!" : "● REC"}</button>}
        <span className={`status-dot ${status === "live" ? "" : "amber"}`} />
        <span className="status-feed">
          {status !== "simulation" && symbol.startsWith("SIP:")
            ? alpacaEnabled ? "SIP historical data" : "Alpaca connection required"
            : status !== "simulation" && symbol.startsWith("IEX:") && iexStatus !== "authenticated"
            ? iexStatus === "disconnected" ? "IEX connection required" : iexStatus === "error" ? "IEX connection failed" : `IEX ${iexStatus}` : status === "live"
            ? "Market data connected"
            : status === "simulation"
              ? "Simulation mode · synthetic prices"
              : status === "reconnecting"
                ? `Reconnecting to ${describeSymbol(symbol).feed}`
                : `Connecting to ${describeSymbol(symbol).feed}`}
        </span>
        <span className="status-divider">/</span>
        <span>{describeSymbol(symbol).venue.toUpperCase()}</span>
        <span className="status-divider">/</span>
        <span>{symbol.startsWith("SIP:") ? "DELAYED SIP HISTORY · RAW" : symbol.startsWith("IEX:") ? "IEX ONLY · RAW" : describeSymbol(symbol).crypto ? "SPOT" : describeSymbol(symbol).delayed ? "DELAYED" : describeSymbol(symbol).streams ? "PERP · LIVE" : "LIVE"}</span>
        <span className="flex-1" />
        <span className="footer-attribution">
          Powered by{" "}
          <a
            href="https://github.com/luxalgo/vela"
            target="_blank"
            rel="noreferrer"
          >
            Vela™
          </a>{" "}
          & PineTS
        </span>
        <span className="status-divider">|</span>
        <span>Browser workspace</span>
        <span className="status-version">v1.0</span>
        {deployment}
      </footer>
      <SymbolSearch />
      <IndicatorPicker />
      <IndicatorSettings />
      <AlertDialog />
      <CompareDialog />
      <DerivedDialog />
      <SyncDialog />
      <ToastManager />
    </main>
  );
}
function ToastManager() {
  const toasts = useChartStore((s) => s.toasts);
  useEffect(() => {
    const timer = setInterval(() => {
      const state = useChartStore.getState();
      state.toasts
        .filter((t) => Date.now() - t.time > 7000)
        .forEach((t) => state.dismissToast(t.id));
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <Bell size={17} />
          <div>
            <strong>{t.title}</strong>
            <p>{t.message}</p>
          </div>
          <IconButton
            label="Dismiss notification"
            onClick={() => useChartStore.getState().dismissToast(t.id)}
          >
            <X size={14} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

