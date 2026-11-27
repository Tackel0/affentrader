"use client";
import { useState, type ReactNode } from "react";
import {currentPriceAlertDraft} from "@/lib/alerts/priceDraft";
import { symbolLabel } from "@/lib/symbolId";
import {
  Search,
  ChartNoAxesCombined,
  Bell,
  ChevronsLeft,
  Undo2,
  Redo2,
  SlidersHorizontal,
  Maximize,
  Camera,
  PanelRightClose,
  PanelRightOpen,
  ExternalLink,
  PenTool,
  List,
  Command,
} from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { useLinkStore } from "@/stores/useLinkStore";
import { openAffenTerminalWindow } from "@/lib/windowScope";

import { AssetBadge, IconButton, Modal } from "./ui";
import {ChartToolbarOverflow} from "./ChartToolbarOverflow";
import {
  ChartTypeMenu,
  CompareButton,
  IntervalPicker,
  PatternsButton,
} from "./ChartTools";
import {
  MainMenu,
  MainMenuSheet,
  LayoutMenu,
  SavedLayoutsMenu,
  IndicatorTemplateMenu,
} from "./WorkspaceMenus";
import { RangeToolbar } from "./RangeToolbar";
import { PhoneWorkspacePanelsSheet } from "./WorkspacePanelTabs";
import type { BottomTab } from "@/types/trading";
export function WorkspaceToolbar({
  onExport,
  onImport,
  sidebarOpen,
  toggleSidebar,
  phoneStatus,
  phoneDeployment,
  tabletStatus,
  tabletDeployment,
}: {
  onExport: () => void;
  onImport: () => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  phoneStatus?: { label: string; description: string; connected: boolean };
  phoneDeployment?: ReactNode;
  tabletStatus?: { label: string; description: string; connected: boolean };
  tabletDeployment?: ReactNode;
}) {
  const symbol = useChartStore((s) => s.symbol),
    replay = useWorkspaceStore((s) => s.replay.active),
    linkGroup = useLinkStore((s) => s.group),
    setLinkGroup = useLinkStore((s) => s.setGroup);
  const command = (kind: "undo" | "redo" | "settings" | "snapshot") =>
    useChartStore.getState().set({ command: { id: Date.now(), kind } });
  const launchTerminalWindow = () => {
    const group = linkGroup === "off" ? "red" : linkGroup;
    if (linkGroup === "off") setLinkGroup("red");
    const ticker = symbol.startsWith("YF:") ? symbol.slice(3) : undefined;
    if (!openAffenTerminalWindow("opps", ticker, group)) {
      useChartStore
        .getState()
        .toast("Pop-up blockiert", "Bitte Pop-ups erlauben, um AffenTerminal im externen Fenster zu öffnen.", "error");
    }
  };
  const search = (
    <button className="symbol-selector" aria-label={`Search symbols · ${symbolLabel(symbol)}`}
      onClick={() => useChartStore.getState().set({ searchOpen: true, searchTarget: "chart" })}>
      <Search size={15} />
      <AssetBadge symbol={symbol} size="xs" />
      <strong>{symbolLabel(symbol)}</strong>
      {phoneStatus ? (
        <span className="phone-symbol-status" title={phoneStatus.description}>
          <span className={`status-dot ${phoneStatus.connected ? "green" : "amber"}`} aria-hidden="true" />
          <span>{phoneStatus.label}</span>
        </span>
      ) : null}
    </button>
  );
  if (phoneStatus) return (
    <div className="workspace-toolbar tv-toolbar phone-workspace-header" role="toolbar" aria-label="Chart toolbar">
      <MainMenu onExport={onExport} onImport={onImport} footer={<div className="phone-menu-footer">
        <span>Powered by <a href="https://github.com/luxalgo/vela" target="_blank" rel="noreferrer">Vela™</a> &amp; PineTS</span>
        {phoneDeployment}
      </div>} />
      {search}
    </div>
  );
  const menuFooter = tabletStatus ? (
    <div className="phone-menu-footer">
      <span>Powered by <a href="https://github.com/luxalgo/vela" target="_blank" rel="noreferrer">Vela™</a> &amp; PineTS</span>
      {tabletDeployment}
    </div>
  ) : undefined;
  return (
    <div
      className={`workspace-toolbar tv-toolbar${tabletStatus ? " tablet-workspace-header" : ""}`}
      role="toolbar"
      aria-label="Chart toolbar"
    >
      <MainMenu onExport={onExport} onImport={onImport} footer={menuFooter} />
      {!tabletStatus ? (
        <button
          type="button"
          className="toolbar-button affen-terminal-launch"
          aria-label="AffenTerminal extern öffnen"
          title="AffenTerminal GUI im externen Fenster öffnen"
          onClick={launchTerminalWindow}
        >
          <ExternalLink size={15} />
          <span>AffenTerminal ↗</span>
        </button>
      ) : null}
      {search}
      <CompareButton />
      <span className="toolbar-divider" />
      <IntervalPicker />
      <span className="toolbar-divider" />
      <ChartTypeMenu />
      <span className="toolbar-divider" />
      <button
        className="toolbar-button indicators-toolbar-button"
        aria-label="Indicators"
        onClick={() => useChartStore.getState().set({ indicatorsOpen: true })}
      >
        <ChartNoAxesCombined size={20} />
        <span>Indicators</span>
      </button>
      <div className="desktop-chart-tools"><IndicatorTemplateMenu /><PatternsButton /></div>
      <span className="toolbar-divider" />
      <button
        className="toolbar-button"
        aria-label="Alert"
        onClick={() => {
          const s = useChartStore.getState();
          s.set({
            alertDraft: currentPriceAlertDraft(),
          });
        }}
      >
        <Bell size={19} />
        <span>Alert</span>
      </button>
      <button
        className={`toolbar-button replay-toggle ${replay ? "active" : ""}`}
        aria-label="Replay"
        aria-pressed={replay}
        onClick={() =>
          useWorkspaceStore.getState().commandReplay(replay ? "stop" : "start")
        }
      >
        <ChevronsLeft size={20} />
        <span>Replay</span>
      </button>
      <span className="toolbar-divider" />
      <IconButton label="Undo drawing" className="tablet-wide-tool" onClick={() => command("undo")}>
        <Undo2 size={18} />
      </IconButton>
      <IconButton label="Redo drawing" className="tablet-wide-tool" onClick={() => command("redo")}>
        <Redo2 size={18} />
      </IconButton>
      <span className="flex-1" />
      {tabletStatus ? (
        <span className="tablet-market-status" title={tabletStatus.description}>
          <span className={`status-dot ${tabletStatus.connected ? "green" : "amber"}`} aria-hidden="true" />
          <span>{tabletStatus.label}</span>
        </span>
      ) : null}
      <div className="desktop-chart-tools"><LayoutMenu /><SavedLayoutsMenu /></div>
      {tabletStatus ? <div className="tablet-layout-control"><LayoutMenu /></div> : null}
      <span className="toolbar-divider" />
      <div className="desktop-chart-tools">
        <IconButton
          label="Command palette (Ctrl+K)"
          onClick={() =>
            useChartStore.getState().set({ commandPaletteOpen: true })
          }
        >
          <Command size={18} />
        </IconButton>
      </div>
      <IconButton
        label="Quick search"
        onClick={() =>
          useChartStore
            .getState()
            .set({ searchOpen: true, searchTarget: "chart" })
        }
      >
        <Search size={19} />
      </IconButton>
      <IconButton label="Chart settings" className="tablet-header-tool" onClick={() => command("settings")}>
        <SlidersHorizontal size={19} />
      </IconButton>
      <IconButton
        label="Full screen"
        onClick={() => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else
            void document.documentElement
              .requestFullscreen()
              .catch(() =>
                useChartStore
                  .getState()
                  .toast(
                    "Full screen unavailable",
                    "Use your browser full screen shortcut.",
                  ),
              );
        }}
      >
        <Maximize size={19} />
      </IconButton>
      <IconButton label="Take a snapshot" onClick={() => command("snapshot")}>
        <Camera size={20} />
      </IconButton>
      <IconButton
        label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        className="tablet-header-tool tablet-sidebar-toggle"
        aria-pressed={sidebarOpen}
        onClick={toggleSidebar}
      >
        {sidebarOpen ? (
          <PanelRightClose size={19} />
        ) : (
          <PanelRightOpen size={19} />
        )}
      </IconButton>
      <ChartToolbarOverflow toggleSidebar={toggleSidebar}/>
    </div>
  );
}

export function PhoneChartActions({
  drawingOpen,
  toggleDrawing,
  toggleSidebar,
  tradingOpen,
  toggleTrading,
  watchlistOpen,
  toggleWatchlist,
  openAlerts,
  openObjects,
  openPanel,
  alertCount,
  onExport,
  onImport,
  deployment,
  phoneStatus,
}: {
  drawingOpen: boolean;
  toggleDrawing: () => void;
  toggleSidebar: () => void;
  tradingOpen: boolean;
  toggleTrading: () => void;
  watchlistOpen: boolean;
  toggleWatchlist: () => void;
  openAlerts: () => void;
  openObjects?: () => void;
  openPanel: (tab: BottomTab) => void;
  alertCount: number;
  onExport: () => void;
  onImport: () => void;
  deployment?: ReactNode;
  phoneStatus: { label: string; description: string; connected: boolean };
}) {
  const symbol = useChartStore((s) => s.symbol);
  const [ranges, setRanges] = useState(false);
  const [modulesOpen, setModulesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const phoneMenuFooter = (
    <div className="phone-menu-footer">
      <span>Powered by <a href="https://github.com/luxalgo/vela" target="_blank" rel="noreferrer">Vela™</a> &amp; PineTS</span>
      {deployment}
    </div>
  );
  return (
    <div className="phone-chart-actions workspace-toolbar tv-toolbar" role="toolbar" aria-label="Quick chart controls">
      <button
        type="button"
        className="symbol-selector phone-bottom-symbol"
        aria-label={`Search symbols · ${symbolLabel(symbol)}`}
        title={phoneStatus.description}
        onClick={() => useChartStore.getState().set({ searchOpen: true, searchTarget: "chart" })}
      >
        <AssetBadge symbol={symbol} size="xs" />
        <strong>{symbolLabel(symbol)}</strong>
        <span className={`status-dot ${phoneStatus.connected ? "green" : "amber"}`} aria-hidden="true" />
      </button>
      <IntervalPicker />
      <ChartTypeMenu compact />
      <IconButton
        label="Indicators"
        className="phone-indicators-toggle"
        onClick={() => useChartStore.getState().set({ indicatorsOpen: true })}
      >
        <ChartNoAxesCombined size={19} />
      </IconButton>
      <IconButton
        label="Watchlists"
        className="phone-watchlist-toggle"
        aria-pressed={watchlistOpen}
        onClick={toggleWatchlist}
      >
        <List size={20} />
      </IconButton>
      <IconButton label="Drawing tools" className="phone-drawing-toggle" aria-expanded={drawingOpen}
        aria-controls={drawingOpen ? "workspace-drawing-tools" : undefined} onClick={toggleDrawing}>
        <PenTool size={19} />
      </IconButton>
      <ChartToolbarOverflow toggleSidebar={toggleSidebar} phone={{
        showRanges: () => setRanges(true),
        tradingOpen,
        toggleTrading,
        openObjects,
        openAlerts,
        openModules: () => setModulesOpen(true),
        openTerminal: () => openPanel("terminal"),
        openMainMenu: () => setMenuOpen(true),
        alertCount,
      }} />
      {ranges && <Modal title="Zeitraum und Zeitzone" className="phone-action-sheet phone-range-dialog" onClose={() => setRanges(false)}>
        <RangeToolbar onRangeSelected={() => setRanges(false)} />
      </Modal>}
      <PhoneWorkspacePanelsSheet open={modulesOpen} onClose={() => setModulesOpen(false)} onSelect={openPanel} />
      <MainMenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} onExport={onExport} onImport={onImport} footer={phoneMenuFooter} />
    </div>
  );
}

