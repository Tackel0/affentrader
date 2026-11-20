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
import { bindBottomPanelResize, COMPACT_WORKSPACE_QUERY } from "@/lib/chart/bottomPanelResize";
import {
  Activity,
  ChevronDown,
  Bell,
  List,
  Layers,
  SquareTerminal,
  Terminal,
  ChartCandlestick,
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
import { ModuleErrorBoundary } from "./ModuleErrorBoundary";
import { downloadFile } from "@/lib/files";
interface WorkspaceProps {
  deployment?: ReactNode;
  initialSidebar?: "watchlist" | "alerts";
}
const PHONE_CHART_QUERY = "(max-width: 600px), (max-width: 1024px) and (max-height: 520px) and (pointer: coarse)";

export default function TradingWorkspace({ deployment, initialSidebar }: WorkspaceProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (initialSidebar && useChartStore.getState().sidebarTab !== initialSidebar) {
      useChartStore.getState().set({ sidebarTab: initialSidebar });
    }
    setMounted(true);
  }, [initialSidebar]);
  if (!mounted)
    return (
      <div className="boot-screen">
        <Activity size={30} />
        <strong>AffenTerminal</strong>
        <span>Preparing your AffenTerminal workspace…</span>
        {deployment}
      </div>
    );
  return <Workspace deployment={deployment} initialSidebar={initialSidebar} />;
}
function Workspace({ deployment, initialSidebar }: WorkspaceProps) {
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [phoneChart, setPhoneChart] = useState(() => window.matchMedia(PHONE_CHART_QUERY).matches);
  const [phoneGrid, setPhoneGrid] = useState(false);
  const [drawingToolsOpen, setDrawingToolsOpen] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(PHONE_CHART_QUERY);
    const update = () => { setPhoneChart(query.matches); setPhoneGrid(false); setDrawingToolsOpen(false); };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const sidebarHandle = useRef<HTMLDivElement | null>(null);
  const sidebarSheetHandle = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const sidebar = sidebarRef.current, chart = sidebar?.parentElement?.querySelector<HTMLElement>(".chart-grid");
    const handle = sidebarHandle.current, sheetHandle = sidebarSheetHandle.current;
    if (!sidebar || !handle || !sheetHandle) return;
    const offResize = bindSidebarResize(sidebar, handle, {
      read: () => useWorkspaceStore.getState().sidebarWidth,
      commit: (width) => useWorkspaceStore.getState().setSidebarWidth(width),
      subscribe: (changed) => useWorkspaceStore.subscribe((state, previous) => {
        if (state.sidebarWidth !== previous.sidebarWidth) changed(state.sidebarWidth);
      }),
    });
    const offBounds = chart ? bindSidebarChartBounds(sidebar, chart) : undefined;
    const compact = window.matchMedia(COMPACT_WORKSPACE_QUERY);
    let offHeight: (() => void) | undefined;
    const bindSheet = () => {
      offHeight?.();
      offHeight = compact.matches && chart
        ? bindBottomPanelResize(sidebar, sidebar, sheetHandle, chart, () => chart.getBoundingClientRect().height).dispose
        : undefined;
    };
    bindSheet();
    compact.addEventListener("change", bindSheet);
    return () => {
      compact.removeEventListener("change", bindSheet);
      offHeight?.();
      offResize();
      offBounds?.();
    };
  }, [sidebarOpen]);
  // Keep the chart visible when entering the phone/tablet layout, including resizes.
  useEffect(() => {
    const phone = window.matchMedia(COMPACT_WORKSPACE_QUERY);
    const adapt = () => { if (phone.matches) setSidebarOpen(false); };
    if (initialSidebar) setSidebarOpen(true);
    else adapt();
    phone.addEventListener("change", adapt);
    return () => phone.removeEventListener("change", adapt);
  }, [initialSidebar]);
  const toggleSidebar = (tab: SidebarTab = sidebar) => {
    const opening = !sidebarOpen || sidebar !== tab;
    if (opening) setDrawingToolsOpen(false);
    setSidebarOpen(opening);
    useChartStore.getState().set({
      sidebarTab: tab,
      ...(opening && window.matchMedia(COMPACT_WORKSPACE_QUERY).matches ? { bottomOpen: false } : {}),
    });
  };
  const openPanel = (tab: "orderflow" | "terminal" | "pine") => {
    if (window.matchMedia(COMPACT_WORKSPACE_QUERY).matches) {
      setSidebarOpen(false);
      setDrawingToolsOpen(false);
    }
    useChartStore.getState().set({ bottomOpen: true, bottomTab: tab });
  };
  const openChart = () => {
    setSidebarOpen(false);
    setDrawingToolsOpen(false);
    useChartStore.getState().set({ bottomOpen: false });
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
        toggleSidebar={toggleSidebar}
        phoneDrawing={phoneChart ? {
          open: drawingToolsOpen,
          toggle: () => {
            if (!drawingToolsOpen) setSidebarOpen(false);
            setDrawingToolsOpen(!drawingToolsOpen);
          },
        } : undefined}
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
      <div className={`workspace-main${phoneChart ? " phone-chart" : ""}`}>
        {(!phoneChart || drawingToolsOpen) && <DrawingRail id="workspace-drawing-tools" />}
        <div className="center-workspace">
          <ModuleErrorBoundary moduleName="Chart Grid">
            <ChartGrid phoneLayout={phoneChart ? { grid: phoneGrid, toggleGrid: () => setPhoneGrid(previous => !previous) } : undefined} />
          </ModuleErrorBoundary>
          <ReplayBar />
          <RangeToolbar/>
          <ModuleErrorBoundary moduleName="Bottom Panel" compact>
            <BottomPanel />
          </ModuleErrorBoundary>
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
            <div
              ref={sidebarSheetHandle}
              role="separator"
              aria-label="Resize sidebar height"
              aria-orientation="horizontal"
              tabIndex={0}
              className="sidebar-sheet-resizer"
            />
            <ModuleErrorBoundary
              moduleName={
                sidebar === "watchlist"
                  ? "Watchlist"
                  : sidebar === "alerts"
                    ? "Alerts"
                    : "Object Tree"
              }
              resetKey={sidebar}
              compact
            >
              {sidebar === "watchlist" ? (
                <Watchlist />
              ) : sidebar === "alerts" ? (
                <AlertsPanel />
              ) : (
                <ObjectSidebar />
              )}
            </ModuleErrorBoundary>
          </aside>
        ) : null}
        <WorkspaceNavigation
          sidebar={sidebarOpen ? sidebar : null}
          toggleSidebar={toggleSidebar}
          openPanel={openPanel}
          openChart={openChart}
        />
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



type SidebarTab = "watchlist" | "alerts" | "objects";

function WorkspaceNavigation({ sidebar, toggleSidebar, openPanel, openChart }: {
  sidebar: SidebarTab | null;
  toggleSidebar: (tab: SidebarTab) => void;
  openPanel: (tab: "orderflow" | "terminal" | "pine") => void;
  openChart: () => void;
}) {
  const panel = useChartStore(s => s.bottomOpen ? s.bottomTab : null);
  const alertCount = useAlertStore(s => s.alerts.filter(a => a.status === "active").length);
  return (
    <nav className="utility-rail" aria-label="Workspace navigation">
      <IconButton label="Chart" className="compact-nav-only" aria-pressed={!sidebar && !panel} onClick={openChart}>
        <ChartCandlestick size={21} />
        <span className="compact-nav-label" aria-hidden="true">Chart</span>
      </IconButton>
      <IconButton label="Watchlists" aria-pressed={sidebar === "watchlist"} onClick={() => toggleSidebar("watchlist")}>
        <List size={21} />
        <span className="compact-nav-label" aria-hidden="true">Watchlist</span>
      </IconButton>
      <div className="rail-alert">
        <IconButton label="Alerts" aria-pressed={sidebar === "alerts"} onClick={() => toggleSidebar("alerts")}>
          <Bell size={20} />
          <span className="compact-nav-label" aria-hidden="true">Alerts</span>
        </IconButton>
        {alertCount ? <span>{alertCount}</span> : null}
      </div>
      <IconButton label="Object tree" aria-pressed={sidebar === "objects"} onClick={() => toggleSidebar("objects")}>
        <ListTree size={20} />
        <span className="compact-nav-label" aria-hidden="true">Objects</span>
      </IconButton>
      <IconButton label="Order flow panel" aria-pressed={panel === "orderflow"} onClick={() => openPanel("orderflow")}>
        <Layers size={20} />
        <span className="compact-nav-label" aria-hidden="true">Order flow</span>
      </IconButton>
      <IconButton label="Terminal" className="compact-nav-only" aria-pressed={panel === "terminal"} onClick={() => openPanel("terminal")}>
        <Terminal size={20} />
        <span className="compact-nav-label" aria-hidden="true">Terminal</span>
      </IconButton>
      <IconButton label="Pine editor" className="desktop-nav-only" onClick={() => openPanel("pine")}>
        <SquareTerminal size={20} />
      </IconButton>
      <span className="flex-1 desktop-nav-only" />
      <a className="engine-link desktop-nav-only" href="https://github.com/luxalgo/vela" target="_blank" rel="noreferrer" title="Powered by Vela">V</a>
    </nav>
  );
}
