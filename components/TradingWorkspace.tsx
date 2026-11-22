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
import { bindBottomPanelResize, COMPACT_WORKSPACE_QUERY, TABLET_WORKSPACE_QUERY } from "@/lib/chart/bottomPanelResize";
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
import { PhoneChartActions, WorkspaceToolbar } from "./WorkspaceToolbar";
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
import { useSetupJournal } from "@/stores/useSetupJournal";
import type { BottomTab } from "@/types/trading";
interface WorkspaceProps {
  deployment?: ReactNode;
  initialSidebar?: "watchlist" | "alerts";
}
const PHONE_CHART_QUERY = "(max-width: 600px), (max-width: 1024px) and (max-height: 520px) and (pointer: coarse)";

export default function TradingWorkspace({ deployment, initialSidebar }: WorkspaceProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const isPhone = window.matchMedia(PHONE_CHART_QUERY).matches;
    if (isPhone) {
      const state = useChartStore.getState();
      const patch: Partial<Pick<typeof state, "bottomOpen" | "legendCollapsed">> = {};
      if (state.bottomOpen) patch.bottomOpen = false;
      if (!state.legendCollapsed) patch.legendCollapsed = true;
      if (Object.keys(patch).length) state.set(patch);
    }
    const setupId = new URLSearchParams(window.location.search).get("setup");
    const setup = setupId ? useSetupJournal.getState().records.find(row => row.id === setupId) : undefined;
    if (setup) {
      useSetupJournal.getState().show(setup.id);
      useChartStore.getState().set({ symbol: setup.symbol, timeframe: "1D",
        ...(window.matchMedia(COMPACT_WORKSPACE_QUERY).matches ? { bottomOpen: false } : {}) });
    }
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
  const [sidebarOpen, setSidebarOpen] = useState(
    () => Boolean(initialSidebar) || !window.matchMedia(COMPACT_WORKSPACE_QUERY).matches,
  );
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia(COMPACT_WORKSPACE_QUERY).matches);
  const [showChartGrid, setShowChartGrid] = useState(false);
  const [phoneChart, setPhoneChart] = useState(() => window.matchMedia(PHONE_CHART_QUERY).matches);
  const [tabletLayout, setTabletLayout] = useState(() => window.matchMedia(TABLET_WORKSPACE_QUERY).matches);
  const [drawingToolsOpen, setDrawingToolsOpen] = useState(false);
  const [phoneTradingOpen, setPhoneTradingOpen] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(PHONE_CHART_QUERY);
    const tablet = window.matchMedia(TABLET_WORKSPACE_QUERY);
    const update = () => {
      setPhoneChart(query.matches);
      setTabletLayout(tablet.matches);
      setDrawingToolsOpen(false);
      setPhoneTradingOpen(false);
    };
    update();
    query.addEventListener("change", update);
    tablet.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
      tablet.removeEventListener("change", update);
    };
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
    const compact = window.matchMedia(COMPACT_WORKSPACE_QUERY);
    const tablet = window.matchMedia(TABLET_WORKSPACE_QUERY);
    let offSheet: (() => void) | undefined;
    const bindSheet = () => {
      offSheet?.();
      offSheet = undefined;
      if (!compact.matches || tablet.matches || !chart) return;
      const offBounds = bindSidebarChartBounds(sidebar, chart);
      const offHeight = bindBottomPanelResize(sidebar, sidebar, sheetHandle, chart, () => chart.getBoundingClientRect().height).dispose;
      offSheet = () => { offHeight(); offBounds(); };
    };
    bindSheet();
    compact.addEventListener("change", bindSheet);
    tablet.addEventListener("change", bindSheet);
    return () => {
      compact.removeEventListener("change", bindSheet);
      tablet.removeEventListener("change", bindSheet);
      offSheet?.();
      offResize();
    };
  }, [sidebarOpen]);
  // Keep the chart visible when entering the phone/tablet layout, including resizes.
  useEffect(() => {
    const compact = window.matchMedia(COMPACT_WORKSPACE_QUERY);
    const adapt = () => {
      setCompactLayout(compact.matches);
      setShowChartGrid(false);
      if (compact.matches) setSidebarOpen(false);
    };
    if (initialSidebar) setSidebarOpen(true);
    else adapt();
    compact.addEventListener("change", adapt);
    return () => compact.removeEventListener("change", adapt);
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
  const openPanel = (tab: BottomTab) => {
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
  const toggleDrawing = () => {
    if (!drawingToolsOpen) openChart();
    setDrawingToolsOpen(!drawingToolsOpen);
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
  };
  const market = describeSymbol(symbol);
  const requiresAlpaca = symbol.startsWith("IEX:") && iexStatus !== "authenticated" || symbol.startsWith("SIP:") && !alpacaEnabled;
  const dataLabel = status === "simulation" ? "Simulation" : requiresAlpaca ? "Datenzugang" : status !== "live" ? "Verbinden…"
    : market.delayed ? "Verzögert" : "Live";
  const isTablet = tabletLayout && !phoneChart;
  const feedBadge = { label: dataLabel, description: `${market.feed} · ${dataLabel}`, connected: status === "live" && !requiresAlpaca };
  return (
    <main className={`trading-app theme-${theme}${phoneChart ? " phone-workspace" : ""}${isTablet ? " tablet-workspace" : ""}`}>
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
        phoneStatus={phoneChart ? feedBadge : undefined}
        phoneDeployment={phoneChart ? deployment : undefined}
        tabletStatus={isTablet ? feedBadge : undefined}
        tabletDeployment={isTablet ? deployment : undefined}
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
      <div className={`workspace-main${phoneChart ? " phone-chart" : ""}${isTablet ? " tablet-chart" : ""}`}>
        {(!phoneChart || drawingToolsOpen) && <DrawingRail id="workspace-drawing-tools" />}
        <div className="center-workspace">
          <ModuleErrorBoundary moduleName="Chart Grid">
            <ChartGrid tradingControls={!phoneChart || phoneTradingOpen} compactLayout={compactLayout ? {
              grid: showChartGrid,
              toggleGrid: () => setShowChartGrid(previous => !previous),
            } : undefined} />
          </ModuleErrorBoundary>
          <ReplayBar />
          {phoneChart ? <PhoneChartActions drawingOpen={drawingToolsOpen} toggleDrawing={toggleDrawing}
            toggleSidebar={toggleSidebar} tradingOpen={phoneTradingOpen} toggleTrading={() => setPhoneTradingOpen(open => !open)}
            openPanel={openPanel} openObjects={() => toggleSidebar("objects")} /> : <RangeToolbar />}
          <ModuleErrorBoundary moduleName="Bottom Panel" compact>
            <BottomPanel phone={phoneChart} />
          </ModuleErrorBoundary>
        </div>
        {sidebarOpen ? (
          <aside
            ref={sidebarRef}
            className={`right-sidebar${phoneChart && sidebar === "watchlist" ? " phone-watchlist" : ""}${isTablet ? " tablet-right-sidebar" : ""}`}
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
                <Watchlist
                  phone={phoneChart}
                  onOpenChart={phoneChart ? openChart : undefined}
                  onClose={isTablet ? () => setSidebarOpen(false) : undefined}
                />
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
          phone={phoneChart}
          tablet={isTablet}
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
        <span className="status-divider footer-legal-sep">|</span>
        <nav className="footer-legal" aria-label="Rechtliches">
          <a href="/risikohinweis">Keine Anlageberatung</a>
          <a href="/impressum">Impressum</a>
          <a href="/datenschutz">Datenschutz</a>
        </nav>
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

function WorkspaceNavigation({ sidebar, toggleSidebar, openPanel, openChart, phone, tablet }: {
  sidebar: SidebarTab | null;
  toggleSidebar: (tab: SidebarTab) => void;
  openPanel: (tab: "orderflow" | "terminal" | "pine") => void;
  openChart: () => void;
  phone: boolean;
  tablet: boolean;
}) {
  const panel = useChartStore(s => s.bottomOpen ? s.bottomTab : null);
  const alertCount = useAlertStore(s => s.alerts.filter(a => a.status === "active").length);
  const toggleBottom = (tab: "orderflow" | "terminal" | "pine") => {
    if (tablet && panel === tab) {
      useChartStore.getState().set({ bottomOpen: false });
      return;
    }
    openPanel(tab);
  };
  return (
    <nav className={`utility-rail${phone ? " phone-bottom-nav" : ""}${tablet ? " tablet-right-rail" : ""}`} aria-label="Workspace navigation">
      {!tablet ? (
        <IconButton label="Chart" className="compact-nav-only" aria-pressed={!sidebar && !panel} onClick={openChart}>
          <ChartCandlestick size={20} />
          <span className="compact-nav-label" aria-hidden="true">Chart</span>
        </IconButton>
      ) : null}
      <IconButton label="Watchlists" aria-pressed={sidebar === "watchlist"} onClick={() => toggleSidebar("watchlist")}>
        <List size={20} />
        <span className="compact-nav-label" aria-hidden="true">Watchlist</span>
      </IconButton>
      <div className="rail-alert">
        <IconButton label="Alerts" aria-pressed={sidebar === "alerts"} onClick={() => toggleSidebar("alerts")}>
          <Bell size={20} />
          <span className="compact-nav-label" aria-hidden="true">Alerts</span>
        </IconButton>
        {alertCount ? <span>{alertCount}</span> : null}
      </div>
      {!phone ? (
        <IconButton label="Object tree" aria-pressed={sidebar === "objects"} onClick={() => toggleSidebar("objects")}>
          <ListTree size={20} />
          <span className="compact-nav-label" aria-hidden="true">Objekte</span>
        </IconButton>
      ) : null}
      {tablet ? <span className="tablet-rail-divider" aria-hidden="true" /> : null}
      <IconButton label="Order flow panel" aria-pressed={panel === "orderflow"} onClick={() => toggleBottom("orderflow")}>
        <Layers size={20} />
        <span className="compact-nav-label" aria-hidden="true">Flow</span>
      </IconButton>
      <IconButton label="Terminal" className={tablet ? "tablet-rail-tool" : "compact-nav-only"} aria-pressed={panel === "terminal"} onClick={() => toggleBottom("terminal")}>
        <Terminal size={20} />
        <span className="compact-nav-label" aria-hidden="true">Terminal</span>
      </IconButton>
      <IconButton label="Pine editor" className={tablet ? "tablet-rail-tool" : "desktop-nav-only"} aria-pressed={panel === "pine"} onClick={() => toggleBottom("pine")}>
        <SquareTerminal size={20} />
      </IconButton>
      <span className="flex-1 desktop-nav-only" />
      <a className="engine-link desktop-nav-only" href="https://github.com/luxalgo/vela" target="_blank" rel="noreferrer" title="Powered by Vela">V</a>
    </nav>
  );
}
