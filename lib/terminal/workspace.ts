import type { TerminalView } from "./commands";

export type TerminalLayoutMode = "single" | "split-2" | "split-3";
export type TerminalPaneId = "p1" | "p2" | "p3";

export interface TerminalModuleMeta {
  id: TerminalView;
  label: string;
  selectLabel: string;
  command: string;
  paneTitle: string;
}

export const TERMINAL_MODULES: readonly TerminalModuleMeta[] = [
  { id: "opps", label: "Trade-Möglichkeiten", selectLabel: "OPPS · Setups", command: "OPPS", paneTitle: "TRADE SETUPS" },
  { id: "fa", label: "Fundamentals (FA)", selectLabel: "FA · Value", command: "FA", paneTitle: "FUNDAMENTALS" },
  { id: "scan", label: "Stock bases", selectLabel: "SCAN · Bases", command: "SCAN", paneTitle: "STOCK BASES" },
  { id: "markets", label: "Markets", selectLabel: "MARKETS · Global", command: "MARKETS", paneTitle: "GLOBAL MARKETS" },
  { id: "compare", label: "Compare", selectLabel: "COMPARE · Perf", command: "COMPARE", paneTitle: "COMPARE" },
  { id: "capm", label: "CAPM", selectLabel: "CAPM · Beta", command: "AAPL CAPM", paneTitle: "CAPM BETA" },
  { id: "macro", label: "Macro", selectLabel: "MACRO · Cal", command: "MACRO", paneTitle: "MACRO CALENDAR" },
  { id: "news", label: "News", selectLabel: "NEWS · Feed", command: "NEWS", paneTitle: "NEWS FEED" },
  { id: "heatmap", label: "Heatmap", selectLabel: "HEATMAP · Sectors", command: "HEATMAP", paneTitle: "HEATMAP" },
  { id: "osint", label: "Tanker & Flights (OSINT)", selectLabel: "OSINT · Radar", command: "OSINT", paneTitle: "OSINT RADAR" },
  { id: "help", label: "Commands", selectLabel: "HELP · Keys", command: "HELP", paneTitle: "COMMANDS CHEAT SHEET" },
];

export interface AutocompleteItem {
  key: string;
  description: string;
  category: "VIEW" | "LAYOUT" | "PANE" | "ORDER" | "SHORTCUT" | "CHART";
}

export const BASE_AUTOCOMPLETE_ITEMS: readonly AutocompleteItem[] = [
  { key: "OPPS", description: "Trade-Möglichkeiten & Setups Hub (F2)", category: "VIEW" },
  { key: "FA", description: "Fundamentals, Ratios & SEC Form 4 (F3)", category: "VIEW" },
  { key: "SCAN", description: "Stock Base Scanner (Confirmed Bases) (F6)", category: "VIEW" },
  { key: "MARKETS", description: "World Markets & Index Matrix (WEI) (F4)", category: "VIEW" },
  { key: "COMPARE", description: "Relative Performance & Drawdowns (F7)", category: "VIEW" },
  { key: "CAPM", description: "Capital Asset Pricing Model & Beta", category: "VIEW" },
  { key: "MACRO", description: "Economic Calendar, Treasury Yields & CPI", category: "VIEW" },
  { key: "NEWS", description: "Real-Time Multi-Asset News Feed (F8)", category: "VIEW" },
  { key: "HEATMAP", description: "Treemap Sector & Asset Heatmap (F10)", category: "VIEW" },
  { key: "OSINT", description: "Marine AIS Vessels & ADS-B Flight Radar (F11)", category: "VIEW" },
  { key: "HELP", description: "Terminal Command & Hotkey Cheat Sheet (F1)", category: "SHORTCUT" },
  { key: "SPLIT 1", description: "Single Pane Full-Width Layout", category: "LAYOUT" },
  { key: "SPLIT 2", description: "Dual-Pane Layout (Primary + Secondary)", category: "LAYOUT" },
  { key: "SPLIT 3", description: "Bloomberg 3-Pane Grid Layout", category: "LAYOUT" },
  { key: "1-PANE", description: "Switch to 1-Pane View", category: "LAYOUT" },
  { key: "2-PANE", description: "Switch to 2-Pane Dual Layout", category: "LAYOUT" },
  { key: "3-PANE", description: "Switch to 3-Pane Tri-Split Layout", category: "LAYOUT" },
  { key: "GRID", description: "Switch to 3-Pane Bloomberg Grid", category: "LAYOUT" },
  { key: "PANE 1", description: "Focus Primary Pane (Ctrl+1)", category: "PANE" },
  { key: "PANE 2", description: "Focus Secondary Pane (Ctrl+2)", category: "PANE" },
  { key: "PANE 3", description: "Focus Tertiary Pane (Ctrl+3)", category: "PANE" },
  { key: "CLEAR", description: "Clear Terminal Status & Output", category: "SHORTCUT" },
  { key: "BUY", description: "Stage Paper Buy Order (BUY <TICKER> [QTY] [@ PRICE])", category: "ORDER" },
  { key: "SELL", description: "Stage Paper Sell Order (SELL <TICKER> [QTY] [@ PRICE])", category: "ORDER" },
  { key: "QUOTE", description: "Open Ticker Chart & Quote (QUOTE <TICKER>)", category: "SHORTCUT" },
  { key: "DES", description: "Company Description & Financials (DES <TICKER>)", category: "SHORTCUT" },
  { key: "WEI", description: "World Equity Indices & Macro Matrices", category: "SHORTCUT" },
  { key: "FLOW", description: "Footprint Bid×Ask Orderflow & Cumulative Delta", category: "SHORTCUT" },
];

const PANE_TITLE_BY_VIEW = new Map(TERMINAL_MODULES.map((m) => [m.id, m.paneTitle] as const));

export function getPaneTitle(paneView: TerminalView): string {
  return PANE_TITLE_BY_VIEW.get(paneView) ?? "ANALYSIS";
}

export function resolveActivePaneForLayout(activePane: TerminalPaneId, nextMode: TerminalLayoutMode): TerminalPaneId {
  if (nextMode === "single") return "p1";
  if (nextMode === "split-2" && activePane === "p3") return "p2";
  return activePane;
}

/**
 * Ensures Pane 2 never mirrors Pane 1 when `view === "fa"` in split-2 or split-3,
 * and avoids colliding with Pane 3's default Markets feed when split-3 is active.
 */
export function resolveSecondaryPaneView(
  p1View: TerminalView,
  p2View: TerminalView,
  p3View: TerminalView,
  layoutMode: TerminalLayoutMode,
): TerminalView {
  if (p1View === "fa" && p2View === "fa") {
    return layoutMode === "split-3" && p3View === "markets" ? "macro" : "markets";
  }
  return p2View;
}

export function computePaneCloseState(
  paneId: "p2" | "p3",
  layoutMode: TerminalLayoutMode,
  activePane: TerminalPaneId,
  pane2View: TerminalView,
  pane3View: TerminalView,
): {
  layoutMode: TerminalLayoutMode;
  activePane: TerminalPaneId;
  pane2View: TerminalView;
} {
  if (paneId === "p3") {
    return {
      layoutMode: "split-2",
      activePane: activePane === "p3" ? "p2" : activePane,
      pane2View,
    };
  }
  if (layoutMode === "split-3") {
    return {
      layoutMode: "split-2",
      activePane: activePane === "p3" ? "p2" : activePane,
      pane2View: pane3View,
    };
  }
  return {
    layoutMode: "single",
    activePane: "p1",
    pane2View,
  };
}
