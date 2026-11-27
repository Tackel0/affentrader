"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  Camera,
  ChartNoAxesCombined,
  ChevronsLeft,
  Cloud,
  Code2,
  Command,
  Download,
  ExternalLink,
  GitCompare,
  Layers,
  LayoutGrid,
  ListFilter,
  Moon,
  Newspaper,
  PenTool,
  PieChart,
  Rows3,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Terminal,
  Wallet,
  X,
} from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { useLinkStore } from "@/stores/useLinkStore";
import { currentPriceAlertDraft } from "@/lib/alerts/priceDraft";
import { openAffenTerminalWindow } from "@/lib/windowScope";
import { SYMBOLS, describeSymbol } from "@/lib/symbols";
import { isYahooTicker, symbolLabel } from "@/lib/symbolId";
import { normalizeInterval, parseInterval } from "@/lib/market/intervals";
import type { BottomTab } from "@/types/trading";
import { Modal } from "./ui";

interface PaletteAction {
  id: string;
  group: "Symbole" | "Timeframes" | "Module" | "Chart & Tools" | "App";
  label: string;
  hint?: string;
  shortcut?: string;
  keywords: string;
  icon: typeof Command;
  run: () => void;
}

const QUICK_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1D", "1W"] as const;

const PANEL_ACTIONS: ReadonlyArray<{
  id: BottomTab;
  label: string;
  keywords: string;
  icon: typeof Activity;
}> = [
  { id: "terminal", label: "AffenTerminal öffnen", keywords: "terminal research opps setups noisemeter", icon: Terminal },
  { id: "strategy", label: "Strategy Tester öffnen", keywords: "strategy backtest walk forward monte carlo", icon: BarChart3 },
  { id: "orderflow", label: "Order Flow Panel öffnen", keywords: "orderflow footprint cvd volume profile", icon: Layers },
  { id: "trading", label: "Paper Trading öffnen", keywords: "paper trading order ticket risk sizer", icon: Wallet },
  { id: "dom", label: "Depth of Market (DOM) öffnen", keywords: "dom orderbook ladder depth", icon: Rows3 },
  { id: "portfolio", label: "Portfolio öffnen", keywords: "portfolio holdings lots pnl", icon: PieChart },
  { id: "screener", label: "Screener öffnen", keywords: "screener scan filter stocks crypto", icon: ListFilter },
  { id: "pine", label: "Pine Editor öffnen", keywords: "pine script code editor indicator", icon: Code2 },
  { id: "heatmap", label: "Heatmap öffnen", keywords: "heatmap market treemap", icon: LayoutGrid },
  { id: "news", label: "News Feed öffnen", keywords: "news headlines rss", icon: Newspaper },
  { id: "overview", label: "Market Overview öffnen", keywords: "overview quote technicals", icon: Activity },
];

export function CommandPalette() {
  const open = useChartStore((s) => s.commandPaletteOpen);
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const theme = useWorkspaceStore((s) => s.theme);
  const replay = useWorkspaceStore((s) => s.replay.active);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    useChartStore.getState().set({ commandPaletteOpen: false });
    setQuery("");
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open, query]);

  const actions = useMemo<PaletteAction[]>(() => {
    const q = query.trim();
    const qLower = q.toLowerCase();
    const qUpper = q.toUpperCase();
    const items: PaletteAction[] = [];

    const openPanel = (tab: BottomTab) => {
      useChartStore.getState().set({ bottomOpen: true, bottomTab: tab });
    };

    // Dynamic direct interval command if query looks like an interval (e.g. "3m", "2h", "3D", "45s")
    if (q && /^\d+[smhdwMtT]$/.test(q) && parseInterval(q)) {
      const normalized = normalizeInterval(q);
      items.push({
        id: `dyn-tf-${normalized}`,
        group: "Timeframes",
        label: `Timeframe auf ${normalized} wechseln`,
        hint: `Aktuell: ${timeframe}`,
        keywords: `${normalized} timeframe interval`,
        icon: Activity,
        run: () => useChartStore.getState().set({ timeframe: normalized }),
      });
    }

    // Dynamic direct symbol jump if user typed a valid ticker
    const fallbackItems: PaletteAction[] = [];
    if (q.length >= 2 && q.length <= 16) {
      const matchedCatalog = SYMBOLS.filter((s) => {
        const hay = `${s.symbol} ${s.name} ${s.base} ${symbolLabel(s.symbol)}`.toLowerCase();
        return hay.includes(qLower);
      }).slice(0, 6);

      for (const s of matchedCatalog) {
        const desc = describeSymbol(s.symbol);
        items.push({
          id: `sym-${s.symbol}`,
          group: "Symbole",
          label: `${symbolLabel(s.symbol)} — ${s.name}`,
          hint: `${desc.venue.toUpperCase()} · ${desc.feed}`,
          keywords: `${s.symbol} ${s.name} ${s.base}`,
          icon: Search,
          run: () => useChartStore.getState().set({ symbol: s.symbol }),
        });
      }

      const cleanTicker = qUpper.replace(/^YF:/, "");
      if (
        isYahooTicker(cleanTicker) &&
        !matchedCatalog.some((s) => s.symbol === `YF:${cleanTicker}` || s.symbol === cleanTicker)
      ) {
        fallbackItems.push({
          id: `sym-yf-${cleanTicker}`,
          group: "Symbole",
          label: `Aktie / ETF laden: ${cleanTicker}`,
          hint: `YF:${cleanTicker} · Yahoo Finance`,
          keywords: `${cleanTicker} stock etf yahoo`,
          icon: Search,
          run: () => useChartStore.getState().set({ symbol: `YF:${cleanTicker}` }),
        });
      }
    }

    // Core Chart & Tools
    const coreTools: PaletteAction[] = [
      {
        id: "tool-search",
        group: "Chart & Tools",
        label: "Symbolsuche öffnen",
        hint: `Aktuell: ${symbolLabel(symbol)}`,
        shortcut: "/",
        keywords: "symbol search ticker wechseln suchen",
        icon: Search,
        run: () => useChartStore.getState().set({ searchOpen: true, searchTarget: "chart" }),
      },
      {
        id: "tool-indicators",
        group: "Chart & Tools",
        label: "Indikatoren hinzufügen",
        shortcut: "Alt+I",
        keywords: "indicators studien ema rsi macd vwap tpo",
        icon: ChartNoAxesCombined,
        run: () => useChartStore.getState().set({ indicatorsOpen: true }),
      },
      {
        id: "tool-alert",
        group: "Chart & Tools",
        label: `Preis-Alert für ${symbolLabel(symbol)} erstellen`,
        shortcut: "Alt+A",
        keywords: "alert alarm benachrichtigung preis",
        icon: Bell,
        run: () => useChartStore.getState().set({ alertDraft: currentPriceAlertDraft() }),
      },
      {
        id: "tool-compare",
        group: "Chart & Tools",
        label: "Symbol vergleichen (Compare / Spread)",
        shortcut: "Alt+C",
        keywords: "compare vergleich overlay spread",
        icon: GitCompare,
        run: () => useChartStore.getState().set({ compareOpen: true }),
      },
      {
        id: "tool-trendline",
        group: "Chart & Tools",
        label: "Trendlinie zeichnen",
        shortcut: "Alt+T",
        keywords: "draw trendline zeichnen linie",
        icon: PenTool,
        run: () => useChartStore.getState().set({ drawing: "trendline" }),
      },
      {
        id: "tool-replay",
        group: "Chart & Tools",
        label: replay ? "Bar Replay beenden" : "Bar Replay starten",
        keywords: "replay backtest bar simulation",
        icon: ChevronsLeft,
        run: () => useWorkspaceStore.getState().commandReplay(replay ? "stop" : "start"),
      },
      {
        id: "tool-snapshot",
        group: "Chart & Tools",
        label: "Chart-Snapshot (PNG) aufnehmen",
        keywords: "snapshot screenshot png bild",
        icon: Camera,
        run: () => useChartStore.getState().set({ command: { id: Date.now(), kind: "snapshot" } }),
      },
      {
        id: "tool-export",
        group: "Chart & Tools",
        label: "Chartdaten exportieren (CSV / JSON)",
        keywords: "export csv json ohlcv download",
        icon: Download,
        run: () => useChartStore.getState().set({ chartExportOpen: true }),
      },
      {
        id: "tool-settings",
        group: "Chart & Tools",
        label: "Chart-Einstellungen öffnen",
        keywords: "settings einstellungen appearance farben",
        icon: SlidersHorizontal,
        run: () => useChartStore.getState().set({ command: { id: Date.now(), kind: "settings" } }),
      },
    ];

    // Modules
    const moduleActions: PaletteAction[] = PANEL_ACTIONS.map((p) => ({
      id: `panel-${p.id}`,
      group: "Module",
      label: p.label,
      keywords: p.keywords,
      icon: p.icon,
      run: () => openPanel(p.id),
    }));

    // Timeframes
    const tfActions: PaletteAction[] = QUICK_INTERVALS.map((tf) => ({
      id: `tf-${tf}`,
      group: "Timeframes",
      label: `Timeframe ${tf}`,
      hint: timeframe === tf ? "Aktiv" : undefined,
      keywords: `timeframe interval ${tf}`,
      icon: Activity,
      run: () => useChartStore.getState().set({ timeframe: tf }),
    }));

    // App actions
    const appActions: PaletteAction[] = [
      {
        id: "app-theme",
        group: "App",
        label: theme === "dark" ? "Zu Light Mode wechseln" : "Zu Dark Mode wechseln",
        hint: `Aktuell: ${theme === "dark" ? "Dark" : "Light"}`,
        keywords: "theme dark light hell dunkel farbe",
        icon: theme === "dark" ? Sun : Moon,
        run: () => useWorkspaceStore.getState().setTheme(theme === "dark" ? "light" : "dark"),
      },
      {
        id: "app-terminal-window",
        group: "App",
        label: "AffenTerminal in neuem Fenster öffnen",
        keywords: "terminal popout fenster window noisemeter",
        icon: ExternalLink,
        run: () => {
          const link = useLinkStore.getState();
          const group = link.group === "off" ? "red" : link.group;
          if (link.group === "off") link.setGroup("red");
          const ticker = symbol.startsWith("YF:") ? symbol.slice(3) : undefined;
          openAffenTerminalWindow("opps", ticker, group);
        },
      },
      {
        id: "app-changelog",
        group: "App",
        label: "Updates & Changelog anzeigen",
        keywords: "updates changelog neuigkeiten version release",
        icon: Sparkles,
        run: () => useChartStore.getState().set({ changelogOpen: true }),
      },
      {
        id: "app-sync",
        group: "App",
        label: "Geräte-Sync öffnen",
        keywords: "sync cloud backup geraete",
        icon: Cloud,
        run: () => useChartStore.getState().set({ syncOpen: true }),
      },
    ];

    const allStatic = [...coreTools, ...moduleActions, ...appActions, ...tfActions];
    if (!qLower) {
      return [...coreTools.slice(0, 5), ...moduleActions.slice(0, 6), ...appActions, ...tfActions];
    }

    const filteredStatic = allStatic.filter((a) =>
      `${a.label} ${a.hint ?? ""} ${a.group} ${a.keywords}`.toLowerCase().includes(qLower),
    );
    return [...items, ...filteredStatic, ...fallbackItems].slice(0, 24);
  }, [query, symbol, timeframe, theme, replay]);

  if (!open) return null;

  const clampedIndex = Math.min(activeIndex, Math.max(0, actions.length - 1));
  const runAction = (action: PaletteAction) => {
    close();
    action.run();
  };

  const scrollIntoView = (index: number) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-index="${index}"]`);
    el?.scrollIntoView({ block: "nearest" });
  };

  return (
    <Modal
      title="Command Palette"
      className="command-palette-modal"
      onClose={close}
      initialFocusSelector='input[aria-label="Befehl oder Symbol suchen"]'
    >
      <div className="search-field command-palette-input">
        <Command size={17} aria-hidden="true" />
        <input
          aria-label="Befehl oder Symbol suchen"
          placeholder="Symbol, Timeframe (z. B. 15m), Modul oder Aktion suchen…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && actions.length > 0) {
              e.preventDefault();
              const next = (clampedIndex + 1) % actions.length;
              setActiveIndex(next);
              scrollIntoView(next);
            } else if (e.key === "ArrowUp" && actions.length > 0) {
              e.preventDefault();
              const next = (clampedIndex - 1 + actions.length) % actions.length;
              setActiveIndex(next);
              scrollIntoView(next);
            } else if (e.key === "Enter" && actions[clampedIndex]) {
              e.preventDefault();
              runAction(actions[clampedIndex]);
            }
          }}
        />
        {query ? (
          <button
            type="button"
            className="icon-button"
            aria-label="Suche leeren"
            onClick={() => setQuery("")}
          >
            <X size={14} />
          </button>
        ) : null}
        <kbd>ESC</kbd>
      </div>
      <div
        ref={listRef}
        className="command-palette-list"
        role="listbox"
        aria-label="Verfügbare Befehle"
      >
        {actions.length === 0 ? (
          <div className="empty-table">Keine passenden Befehle oder Symbole für „{query}“.</div>
        ) : (
          actions.map((action, idx) => {
            const Icon = action.icon;
            const prevGroup = idx > 0 ? actions[idx - 1].group : null;
            const showGroup = action.group !== prevGroup;
            return (
              <div key={action.id}>
                {showGroup ? <div className="command-palette-group">{action.group}</div> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === clampedIndex}
                  data-cmd-index={idx}
                  className={`command-palette-item${idx === clampedIndex ? " active" : ""}`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => runAction(action)}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span className="command-palette-label">
                    <strong>{action.label}</strong>
                    {action.hint ? <small>{action.hint}</small> : null}
                  </span>
                  {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
                </button>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}
