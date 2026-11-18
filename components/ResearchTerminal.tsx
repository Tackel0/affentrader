"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Maximize2, Minimize2, X } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { useLinkStore } from "@/stores/useLinkStore";
import { usePaperStore } from "@/stores/usePaperStore";
import { isYahooTicker, tickerOf } from "@/lib/symbolId";
import { STOCK_BASE_MARKETS } from "@/lib/screener/stockBase";
import type { FundamentalSnapshot, TradeOpportunity } from "@/lib/screener/opportunities";
import type { terminalCapm } from "@/lib/terminal/capm";
import { parseTerminalCommand, tokenizeTerminalCommand, type TerminalView } from "@/lib/terminal/commands";
import { parseOrderTokens, resolveOrderExecution, resolveOrderTargetSymbol } from "@/lib/terminal/orders";
import {
  BASE_AUTOCOMPLETE_ITEMS,
  TERMINAL_MODULES,
  computePaneCloseState,
  getPaneTitle,
  resolveActivePaneForLayout,
  resolveSecondaryPaneView,
  type AutocompleteItem,
  type TerminalLayoutMode,
  type TerminalPaneId,
} from "@/lib/terminal/workspace";
import { hyperliquidCatalog } from "@/hooks/useHyperliquidCatalog";
import { buildMissingOrderflowIndicators, resolveOrderflowTarget } from "@/lib/orderflow/equityOrderflow";
import { broadcastWorkspaceAction } from "@/hooks/useWindowLink";
import { openAffenTerminalWindow } from "@/lib/windowScope";
import { StockBaseScanner } from "./StockBaseScanner";
import { OpportunitiesHub } from "./OpportunitiesHub";
import { FundamentalsPanel } from "./FundamentalsPanel";
import { NewsPanel } from "./NewsPanel";
import { CalendarPanel } from "./CalendarPanel";
import { TerminalMarkets } from "./TerminalMarkets";
import { TerminalCompare } from "./TerminalCompare";
import { HeatmapPanel } from "./HeatmapPanel";
import { OsintMapPanel } from "./OsintMapPanel";
import { ModuleErrorBoundary } from "./ModuleErrorBoundary";

type Capm = NonNullable<ReturnType<typeof terminalCapm>> & {
  ticker: string;
  name: string;
  benchmark: string;
  currency: string;
  asOf: string;
  riskFree: number;
};

type StatusTone = "neutral" | "ok" | "error";

const HISTORY_KEY = "affentrader-terminal-history";
const DEFAULT_HISTORY = ["OPPS", "QCOM FA", "OSINT", "HEATMAP", "MARKETS", "AAPL CAPM"];
const ORDER_QUICK_TICKERS = ["AAPL", "NVDA", "TSLA", "MSFT", "AMD", "QCOM", "SPY"];
const COMMAND_KEYWORDS_EXCLUDED_FROM_TICKER = new Set(["BUY", "SELL", "HELP", "CLEAR", "GRID", "FLOW"]);

function loadCommandHistory(): string[] {
  if (typeof window === "undefined") return [...DEFAULT_HISTORY];
  try {
    const stored = window.localStorage.getItem(HISTORY_KEY);
    if (!stored) return [...DEFAULT_HISTORY];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [...DEFAULT_HISTORY];
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const normalized = item.trim().toUpperCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      deduped.push(normalized);
      if (deduped.length >= 50) break;
    }
    return deduped.length > 0 ? deduped : [...DEFAULT_HISTORY];
  } catch {
    return [...DEFAULT_HISTORY];
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

function TerminalTileHeader({
  paneId,
  title,
  currentView,
  onViewChange,
  isMaximized,
  onToggleMaximize,
  canClose,
  onClose,
  isActive,
  onFocus,
}: {
  paneId: TerminalPaneId;
  title: string;
  currentView: TerminalView;
  onViewChange: (v: TerminalView) => void;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  canClose: boolean;
  onClose?: () => void;
  isActive: boolean;
  onFocus: () => void;
}) {
  return (
    <div className={`terminal-tile-header${isActive ? " active" : ""}`} onClick={onFocus}>
      <div className="pane-header-left">
        <span className="pane-tag">{paneId.toUpperCase()}</span>
        <span className="pane-title" title={title}>
          {title}
        </span>
      </div>

      <div className="pane-controls">
        <select
          className="pane-view-select"
          aria-label={`Pane ${paneId} view`}
          value={currentView}
          onChange={(e) => {
            e.stopPropagation();
            onViewChange(e.target.value as TerminalView);
          }}
        >
          {TERMINAL_MODULES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.selectLabel}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="pane-icon-btn"
          aria-label={isMaximized ? "Restore pane" : "Maximize pane"}
          title={isMaximized ? "Restore pane layout" : "Maximize pane full width"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMaximize();
          }}
        >
          {isMaximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
        </button>

        {canClose && onClose && (
          <button
            type="button"
            className="pane-icon-btn"
            aria-label={`Close pane ${paneId}`}
            title="Close pane"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            <X size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

function TerminalHelpView() {
  return (
    <div className="terminal-help">
      <dl>
        {TERMINAL_MODULES.map((item) => (
          <div key={item.id}>
            <dt>
              <code>{item.command}</code>
            </dt>
            <dd>{item.label}</dd>
          </div>
        ))}
        <div>
          <dt>
            <code>AAPL &lt;GO&gt;</code> / <code>AAPL GP</code>
          </dt>
          <dd>Open daily chart &amp; sync ticker</dd>
        </div>
        <div>
          <dt>
            <code>QCOM FA</code> / <code>VALUE</code> / <code>DES</code>
          </dt>
          <dd>Valuation, Balance Sheet, Cashflow &amp; SEC Form 4 Insider panel</dd>
        </div>
        <div>
          <dt>
            <code>FLOW</code> / <code>AAPL FLOW</code>
          </dt>
          <dd>Bid×Ask Footprint &amp; HIP-3 Orderflow Suite</dd>
        </div>
        <div>
          <dt>
            <code>OSINT</code> / <code>TANKER</code> / <code>FLIGHTS</code>
          </dt>
          <dd>Regional Baltic / N. Europe AIS Vessels &amp; ADS-B Flights OSINT Map</dd>
        </div>
        <div>
          <dt>
            <code>BUY AAPL 100 @ 180</code> / <code>SELL NVDA 50</code>
          </dt>
          <dd>Stage Paper Trading market or limit order tickets</dd>
        </div>
        <div>
          <dt>
            <code>SPLIT 1/2/3</code> / <code>GRID</code>
          </dt>
          <dd>Switch multi-pane workspace layout</dd>
        </div>
        <div>
          <dt>
            <code>PANE 1/2/3</code>
          </dt>
          <dd>Focus primary, secondary, or tertiary pane</dd>
        </div>
      </dl>
      <p className="form-help">
        Hotkeys: <code>Alt+K</code> Command Bar · <code>Escape</code> Clear/Blur · <code>Tab</code> Cycle Panes / Complete ·{" "}
        <code>Ctrl+1/2/3</code> Focus Panes · <code>F1–F12</code> Bloomberg Views. CAPM workflow adapted from{" "}
        <a href="https://github.com/kindermerendero/open-bloomberg-terminal" target="_blank" rel="noreferrer">
          OPNB (MIT)
        </a>
        .
      </p>
    </div>
  );
}

function TerminalCapmView({
  ticker,
  market,
  rate,
  analysis,
  loading,
  onReset,
  onTickerChange,
  onMarketChange,
  onRateChange,
  onSubmit,
}: {
  ticker: string;
  market: string;
  rate: string;
  analysis: Capm | null;
  loading: boolean;
  onReset: () => void;
  onTickerChange: (value: string) => void;
  onMarketChange: (value: string) => void;
  onRateChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="stock-base-evidence">
      <form
        className="screener-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <label>
          Ticker
          <input
            value={ticker}
            onChange={(e) => {
              onReset();
              onTickerChange(e.target.value);
            }}
            maxLength={24}
          />
        </label>
        <label>
          Benchmark
          <select
            value={market}
            onChange={(e) => {
              onReset();
              onMarketChange(e.target.value);
            }}
          >
            {STOCK_BASE_MARKETS.map((m) => (
              <option value={m.id} key={m.id}>
                {m.benchmarkLabel}
              </option>
            ))}
          </select>
        </label>
        <label>
          Risk-free rate %
          <input
            type="number"
            value={rate}
            onChange={(e) => {
              onReset();
              onRateChange(e.target.value);
            }}
            min={-20}
            max={50}
            step="any"
          />
        </label>
        <button type="submit" className="button small primary" disabled={loading}>
          {loading ? "Loading…" : "Calculate"}
        </button>
      </form>
      {analysis && (
        <>
          <p className="form-help">
            {analysis.name} vs {analysis.benchmark} · {analysis.observations} paired daily returns · {analysis.asOf} · Yahoo Finance
          </p>
          <dl>
            {[
              ["Beta", analysis.beta.toFixed(2)],
              ["Jensen alpha (annual log %)", `${(analysis.alpha * 100).toFixed(2)}%`],
              ["R²", analysis.r2.toFixed(3)],
              ["Annual volatility", `${(analysis.volatility * 100).toFixed(2)}%`],
              ["Model return (annual)", `${(analysis.capmReturn * 100).toFixed(2)}%`],
              ["Sharpe (annual)", analysis.sharpe.toFixed(2)],
            ].map(([label, val]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{val}</dd>
              </div>
            ))}
          </dl>
          <p className="form-help">
            Historical model using up to one year of completed sessions and your {analysis.riskFree}% rate.
          </p>
        </>
      )}
    </div>
  );
}

export function ResearchTerminal({
  initialView = "opps",
  initialTicker = "QCOM",
  externalWindow = false,
  defaultLayout,
  onSelectSymbol,
  onViewChange,
}: {
  initialView?: TerminalView;
  initialTicker?: string;
  externalWindow?: boolean;
  defaultLayout?: TerminalLayoutMode;
  onSelectSymbol?: (symbol: string) => void;
  onViewChange?: (view: TerminalView) => void;
} = {}) {
  const [comparison, setComparison] = useState<readonly [string, string, string]>();
  const [view, setView] = useState<TerminalView>(initialView);
  const [layoutMode, setLayoutMode] = useState<TerminalLayoutMode>(
    defaultLayout ?? (externalWindow ? "split-3" : "single"),
  );
  const [activePane, setActivePane] = useState<TerminalPaneId>("p1");
  const [pane2View, setPane2View] = useState<TerminalView>(initialView === "fa" ? "markets" : "fa");
  const [pane3View, setPane3View] = useState<TerminalView>("markets");
  const [maximizedPane, setMaximizedPane] = useState<TerminalPaneId | null>(null);

  const [command, setCommand] = useState("");
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [hasNavigatedSuggestion, setHasNavigatedSuggestion] = useState(false);

  const [history, setHistory] = useState<string[]>(loadCommandHistory);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [ticker, setTicker] = useState(initialTicker);
  const [faPreload, setFaPreload] = useState<{
    ticker: string;
    lastClose?: number;
    fundamentals: FundamentalSnapshot | null;
  } | null>(null);
  const [market, setMarket] = useState("us");
  const [rate, setRate] = useState("0");
  const [analysis, setAnalysis] = useState<Capm | null>(null);
  const [message, setMessage] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");
  const [loading, setLoading] = useState(false);

  const request = useRef<AbortController | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const userChangedLayoutRef = useRef(false);
  const preMobileLayoutRef = useRef<TerminalLayoutMode | null>(null);
  const layoutModeRef = useRef(layoutMode);
  layoutModeRef.current = layoutMode;
  const lastPickedSuggestionRef = useRef<{ key: string; at: number } | null>(null);

  const chartSymbol = useChartStore((s) => s.symbol);
  const prevChartSymbol = useRef(chartSymbol);

  useEffect(() => {
    if (defaultLayout || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 768px)");
    const syncPhoneLayout = () => {
      if (userChangedLayoutRef.current) return;
      if (query.matches) {
        if (preMobileLayoutRef.current === null && layoutModeRef.current !== "single") {
          preMobileLayoutRef.current = layoutModeRef.current;
        }
        setMaximizedPane(null);
        setLayoutMode("single");
        setActivePane("p1");
      } else if (preMobileLayoutRef.current !== null) {
        setLayoutMode(preMobileLayoutRef.current);
        preMobileLayoutRef.current = null;
      }
    };
    syncPhoneLayout();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", syncPhoneLayout);
      return () => query.removeEventListener("change", syncPhoneLayout);
    }
    query.addListener(syncPhoneLayout);
    return () => query.removeListener(syncPhoneLayout);
  }, [defaultLayout]);

  useEffect(() => {
    return () => {
      request.current?.abort();
      if (blurTimer.current !== null) clearTimeout(blurTimer.current);
    };
  }, []);

  useEffect(() => {
    onViewChange?.(view);
  }, [view, onViewChange]);

  useEffect(() => {
    if (chartSymbol === prevChartSymbol.current) return;
    prevChartSymbol.current = chartSymbol;
    const raw = tickerOf(chartSymbol).trim().toUpperCase();
    const cleaned = raw.includes(":") ? (raw.split(":").at(-1) ?? raw) : raw;
    if (!cleaned || !isYahooTicker(cleaned)) return;
    setTicker(cleaned);
    setFaPreload((prev) => (prev && prev.ticker === cleaned ? prev : { ticker: cleaned, fundamentals: null }));
  }, [chartSymbol]);

  const suggestions = useMemo(() => {
    const trimmed = command.trim().toUpperCase();
    if (!trimmed) return [];

    const list: AutocompleteItem[] = [];

    if (trimmed.startsWith("BUY") || trimmed.startsWith("SELL")) {
      const verb = trimmed.startsWith("BUY") ? "BUY" : "SELL";
      const rest = trimmed.slice(verb.length).trim();
      const candidates = [ticker, ...ORDER_QUICK_TICKERS];
      if (!rest) {
        list.push(
          { key: `${verb} ${ticker} 100`, description: `Stage paper ${verb.toLowerCase()} 100 ${ticker}`, category: "ORDER" },
          { key: `${verb} AAPL 100`, description: `Stage paper ${verb.toLowerCase()} 100 AAPL`, category: "ORDER" },
          { key: `${verb} NVDA 50 @ 135`, description: `Stage limit ${verb.toLowerCase()} 50 NVDA @ $135`, category: "ORDER" },
        );
      } else {
        for (const t of candidates) {
          if (t.startsWith(rest)) {
            list.push({
              key: `${verb} ${t} 100`,
              description: `Stage paper ${verb.toLowerCase()} 100 ${t}`,
              category: "ORDER",
            });
          }
        }
      }
    }

    if (isYahooTicker(trimmed) && !COMMAND_KEYWORDS_EXCLUDED_FROM_TICKER.has(trimmed)) {
      list.push(
        { key: `${trimmed} <GO>`, description: `Open daily chart for ${trimmed}`, category: "CHART" },
        { key: `${trimmed} FA`, description: `Fundamentals & SEC Form 4 for ${trimmed}`, category: "VIEW" },
        { key: `${trimmed} GP`, description: `Price action & technicals for ${trimmed}`, category: "CHART" },
        { key: `${trimmed} FLOW`, description: `Footprint & orderflow for ${trimmed}`, category: "SHORTCUT" },
        { key: `BUY ${trimmed} 100`, description: `Stage buy order for 100 ${trimmed}`, category: "ORDER" },
        { key: `${trimmed} CAPM`, description: `CAPM Beta regression for ${trimmed}`, category: "VIEW" },
      );
    }

    for (const item of BASE_AUTOCOMPLETE_ITEMS) {
      if (item.key.startsWith(trimmed) || item.key.includes(trimmed)) {
        list.push(item);
      }
    }

    const seen = new Set<string>();
    const res: AutocompleteItem[] = [];
    for (const item of list) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      res.push(item);
      if (res.length >= 8) break;
    }
    return res;
  }, [command, ticker]);

  const reset = () => {
    request.current?.abort();
    setMessage("");
    setStatusTone("neutral");
    setAnalysis(null);
    setLoading(false);
  };

  const setPaneView = (paneId: TerminalPaneId, nextView: TerminalView) => {
    if (paneId === "p1") {
      reset();
      setView(nextView);
    } else if (paneId === "p2") {
      setPane2View(nextView);
    } else {
      setPane3View(nextView);
    }
  };

  const applyLayoutMode = (nextMode: TerminalLayoutMode) => {
    userChangedLayoutRef.current = true;
    setMaximizedPane(null);
    setLayoutMode(nextMode);
    setActivePane((prev) => resolveActivePaneForLayout(prev, nextMode));
  };

  const closePane = (paneId: "p2" | "p3") => {
    userChangedLayoutRef.current = true;
    const next = computePaneCloseState(paneId, layoutMode, activePane, pane2View, pane3View);
    setMaximizedPane(null);
    setLayoutMode(next.layoutMode);
    setPane2View(next.pane2View);
    setActivePane(next.activePane);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }

      if (e.key === "Escape") {
        if (isAutocompleteOpen) {
          e.preventDefault();
          setIsAutocompleteOpen(false);
          setHasNavigatedSuggestion(false);
          return;
        }
        if (document.activeElement === inputRef.current) {
          e.preventDefault();
          if (command) {
            setCommand("");
          } else {
            inputRef.current?.blur();
          }
          return;
        }
      }

      if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        if (e.key === "1") {
          e.preventDefault();
          setActivePane("p1");
          return;
        }
        if (e.key === "2" && layoutMode !== "single") {
          e.preventDefault();
          setActivePane("p2");
          return;
        }
        if (e.key === "3" && layoutMode === "split-3") {
          e.preventDefault();
          setActivePane("p3");
          return;
        }
      }

      if (e.key === "Tab" && document.activeElement !== inputRef.current && !isEditableTarget(e.target)) {
        if (layoutMode === "split-2") {
          e.preventDefault();
          setActivePane((p) => (p === "p1" ? "p2" : "p1"));
          return;
        }
        if (layoutMode === "split-3") {
          e.preventDefault();
          setActivePane((p) => (p === "p1" ? "p2" : p === "p2" ? "p3" : "p1"));
          return;
        }
      }

      if (e.altKey || e.ctrlKey || e.metaKey) return;

      switch (e.key) {
        case "F1":
          e.preventDefault();
          setPaneView(activePane, "help");
          break;
        case "F2":
          e.preventDefault();
          setPaneView(activePane, "opps");
          break;
        case "F3":
          e.preventDefault();
          setPaneView(activePane, "fa");
          break;
        case "F4":
          e.preventDefault();
          setPaneView(activePane, "markets");
          break;
        case "F5":
          e.preventDefault();
          setStatusTone("ok");
          setMessage("Refreshed active data feeds.");
          break;
        case "F6":
          e.preventDefault();
          setPaneView(activePane, "scan");
          break;
        case "F7":
          e.preventDefault();
          setPaneView(activePane, "compare");
          break;
        case "F8":
          e.preventDefault();
          setPaneView(activePane, "news");
          break;
        case "F9":
          e.preventDefault();
          setPaneView(activePane, "opps");
          setStatusTone("ok");
          setMessage("Trading & Order Hub active (F9).");
          break;
        case "F10":
          e.preventDefault();
          setPaneView(activePane, "heatmap");
          break;
        case "F11":
          e.preventDefault();
          setPaneView(activePane, "osint");
          break;
        case "F12":
          e.preventDefault();
          if (typeof document !== "undefined") {
            if (!document.fullscreenElement) {
              document.documentElement.requestFullscreen().catch(() => {});
            } else {
              document.exitFullscreen().catch(() => {});
            }
          }
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePane, layoutMode, isAutocompleteOpen, command]);

  const syncSymbol = (fullSymbol: string) => {
    if (onSelectSymbol) onSelectSymbol(fullSymbol);
    else useChartStore.getState().set({ symbol: fullSymbol });
  };

  const runCapm = async (symbol: string, targetPane: TerminalPaneId = activePane) => {
    reset();
    setPaneView(targetPane, "capm");
    setTicker(symbol);
    if (!isYahooTicker(symbol) || !rate.trim() || !Number.isFinite(Number(rate)) || Number(rate) < -20 || Number(rate) > 50) {
      setStatusTone("error");
      setMessage("Enter a valid ticker and annual risk-free rate (−20% to 50%).");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`/api/terminal-capm?${new URLSearchParams({ ticker: symbol, market, rf: rate })}`, {
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "CAPM unavailable.");
      if (!controller.signal.aborted) setAnalysis(data);
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatusTone("error");
        setMessage(error instanceof Error ? error.message : "CAPM unavailable.");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const openChart = (symbol: string) => {
    const clean = symbol.replace(/^YF:/i, "").toUpperCase();
    setTicker(clean);
    setFaPreload({ ticker: clean, fundamentals: null });
    const full = symbol.includes(":") ? symbol : resolveOrderTargetSymbol(clean);
    if (onSelectSymbol) onSelectSymbol(full);
    else useChartStore.getState().set({ symbol: full, timeframe: "1D" });
  };

  const saveHistoryItem = (cmd: string) => {
    setHistory((prev) => {
      const next = [cmd, ...prev.filter((x) => x !== cmd)].slice(0, 50);
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
        }
      } catch {
        /* ignore localStorage quota/disabled errors */
      }
      return next;
    });
  };

  const execute = (rawInput = command) => {
    const trimmed = rawInput.trim();
    if (!trimmed) return;
    const upper = trimmed.toUpperCase();
    saveHistoryItem(upper);
    setHistoryIdx(-1);
    setCommand("");
    setIsAutocompleteOpen(false);
    setHasNavigatedSuggestion(false);

    const parsed = parseTerminalCommand(trimmed, ticker);

    if (parsed.kind === "view") {
      reset();
      if (parsed.ticker) {
        setTicker(parsed.ticker);
        setFaPreload({ ticker: parsed.ticker, fundamentals: null });
        syncSymbol(resolveOrderTargetSymbol(parsed.ticker));
      }
      setPaneView(activePane, parsed.view);
      return;
    }

    if (parsed.kind === "chart") {
      reset();
      openChart(parsed.ticker);
      setStatusTone("ok");
      setMessage(`Opened daily chart & FA sync for ${parsed.ticker}.`);
      return;
    }

    if (parsed.kind === "layout") {
      reset();
      applyLayoutMode(parsed.mode);
      setStatusTone("ok");
      setMessage(`Workspace layout set to ${parsed.mode.toUpperCase()}.`);
      return;
    }

    if (parsed.kind === "pane") {
      setMaximizedPane(null);
      if (parsed.pane === "p2" && layoutMode === "single") {
        userChangedLayoutRef.current = true;
        setLayoutMode("split-2");
      } else if (parsed.pane === "p3" && layoutMode !== "split-3") {
        userChangedLayoutRef.current = true;
        setLayoutMode("split-3");
      }
      setActivePane(parsed.pane);
      setStatusTone("ok");
      setMessage(`Active pane focused: ${parsed.pane.toUpperCase()}.`);
      return;
    }

    if (parsed.kind === "clear") {
      reset();
      setCommand("");
      return;
    }

    if (parsed.kind === "order") {
      reset();
      const plan = resolveOrderExecution(parsed);
      if (!plan.ok) {
        setStatusTone("error");
        setMessage(plan.reason);
        return;
      }

      setTicker(plan.ticker);
      setFaPreload({ ticker: plan.ticker, fundamentals: null });
      syncSymbol(plan.targetSymbol);
      usePaperStore.getState().setTicket({
        side: plan.action === "BUY" ? "buy" : "sell",
        quantity: plan.quantity,
        type: plan.type,
        price: plan.price,
      });
      setStatusTone("ok");
      setMessage(
        `Staged ${plan.action} order: ${plan.quantity} ${plan.ticker}${plan.price !== undefined ? ` @ $${plan.price}` : ""} (Paper Trading ticket active).`,
      );
      return;
    }

    if (parsed.kind === "flow") {
      reset();
      const targetSymbol = parsed.ticker ? resolveOrderTargetSymbol(parsed.ticker) : useChartStore.getState().symbol;
      if (parsed.ticker) {
        setTicker(parsed.ticker);
        setFaPreload({ ticker: parsed.ticker, fundamentals: null });
      }
      void (async () => {
        const hlAssets = await hyperliquidCatalog().catch(() => []);
        const resolved = resolveOrderflowTarget(targetSymbol, hlAssets);
        const store = useChartStore.getState();
        const extras = buildMissingOrderflowIndicators(store.indicators, resolved.studies);
        store.set({
          symbol: resolved.symbol,
          chartType: resolved.chartType,
          bottomOpen: true,
          bottomTab: "orderflow",
          ...(extras.length ? { indicators: [...store.indicators, ...extras] } : {}),
        });
        broadcastWorkspaceAction({
          symbol: resolved.symbol,
          chartType: resolved.chartType,
          bottomOpen: true,
          bottomTab: "orderflow",
          addIndicators: resolved.studies,
          ...(resolved.notice
            ? {
                toast: {
                  title: resolved.mappedFrom ? "Orderflow-Proxy aktiv" : "Orderflow Hinweis",
                  tone: "success" as const,
                  message: resolved.notice,
                },
              }
            : {}),
        });
        if (onSelectSymbol) onSelectSymbol(resolved.symbol);
        setStatusTone("ok");
        setMessage(resolved.notice ?? `Switched ${resolved.symbol} to Footprint & Orderflow view.`);
      })();
      return;
    }

    if (parsed.kind === "capm") {
      void runCapm(parsed.ticker ?? ticker, activePane);
      return;
    }

    const orderValidation = parseOrderTokens(tokenizeTerminalCommand(trimmed));
    setStatusTone("error");
    if (orderValidation.matched && !orderValidation.ok) {
      setMessage(orderValidation.reason);
      return;
    }

    setMessage(
      "Unknown command. Enter HELP for available commands (e.g., OPPS, QCOM FA, AAPL GP, BUY AAPL 10 @ 180, FLOW, OSINT, MACRO, NEWS).",
    );
  };

  const handleOpportunitySelect = (opp: TradeOpportunity, fundamentals: FundamentalSnapshot | null) => {
    setTicker(opp.ticker);
    setFaPreload({
      ticker: opp.ticker,
      lastClose: opp.levels.lastClose,
      fundamentals,
    });
  };

  const resolvedPane2View = resolveSecondaryPaneView(view, pane2View, pane3View, layoutMode);

  const renderPaneBody = (paneView: TerminalView, paneId: TerminalPaneId) => {
    switch (paneView) {
      case "opps":
        return (
          <OpportunitiesHub
            onSelectOpportunity={handleOpportunitySelect}
            onCompare={(sym, bench, session) => {
              reset();
              setComparison([sym, bench, session]);
              setPaneView(paneId, "compare");
            }}
          />
        );
      case "fa":
        return <FundamentalsPanel initialTicker={ticker} preloaded={faPreload} onOpenChart={openChart} />;
      case "scan":
        return (
          <StockBaseScanner
            onCompare={(sym, bench, retest) => {
              reset();
              setComparison([sym, bench, retest]);
              setPaneView(paneId, "compare");
            }}
          />
        );
      case "news":
        return <NewsPanel />;
      case "macro":
        return <CalendarPanel />;
      case "heatmap":
        return <HeatmapPanel onSelectSymbol={syncSymbol} />;
      case "osint":
        return <OsintMapPanel onSelectSymbol={syncSymbol} />;
      case "markets":
        if (paneId === "p3") {
          return (
            <>
              <ModuleErrorBoundary moduleName="Markets" resetKey={`${paneId}:markets:primary`} compact>
                <TerminalMarkets openChart={openChart} />
              </ModuleErrorBoundary>
              <ModuleErrorBoundary moduleName="News" resetKey={`${paneId}:markets:news`} compact>
                <NewsPanel />
              </ModuleErrorBoundary>
            </>
          );
        }
        return <TerminalMarkets openChart={openChart} />;
      case "compare":
        return <TerminalCompare key={comparison?.join(":") ?? "default"} setupComparison={comparison} />;
      case "capm":
        return (
          <TerminalCapmView
            ticker={ticker}
            market={market}
            rate={rate}
            analysis={analysis}
            loading={loading}
            onReset={reset}
            onTickerChange={setTicker}
            onMarketChange={setMarket}
            onRateChange={setRate}
            onSubmit={() => void runCapm(ticker.trim().toUpperCase(), paneId)}
          />
        );
      case "help":
        return <TerminalHelpView />;
      default:
        return null;
    }
  };

  return (
    <div
      className={`research-terminal affen-terminal${externalWindow ? "" : " is-embedded"}${layoutMode === "single" && !maximizedPane ? " is-single-pane" : ""}`}
      aria-label="AffenTerminal Pro Workspace"
    >
      <form
        className="terminal-command"
        onSubmit={(e) => {
          e.preventDefault();
          execute();
        }}
      >
        <label htmlFor="terminal-command">AffenTerminal</label>
        <div className="terminal-command-input-wrap">
          <input
            ref={inputRef}
            id="terminal-command"
            value={command}
            onChange={(e) => {
              const val = e.target.value;
              setCommand(val);
              setHistoryIdx(-1);
              setIsAutocompleteOpen(val.trim().length > 0);
              setAutocompleteIndex(0);
              setHasNavigatedSuggestion(false);
            }}
            onFocus={() => {
              if (blurTimer.current !== null) {
                clearTimeout(blurTimer.current);
                blurTimer.current = null;
              }
              if (command.trim().length > 0) setIsAutocompleteOpen(true);
            }}
            onBlur={() => {
              if (blurTimer.current !== null) clearTimeout(blurTimer.current);
              blurTimer.current = setTimeout(() => {
                setIsAutocompleteOpen(false);
                setHasNavigatedSuggestion(false);
              }, 250);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault();
                if (isAutocompleteOpen && suggestions.length > 0 && historyIdx === -1) {
                  setHasNavigatedSuggestion(true);
                  setAutocompleteIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
                  return;
                }
                if (history.length > 0) {
                  setIsAutocompleteOpen(false);
                  setHasNavigatedSuggestion(false);
                  const next = Math.min(history.length - 1, historyIdx + 1);
                  setHistoryIdx(next);
                  setCommand(history[next]);
                }
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                if (isAutocompleteOpen && suggestions.length > 0 && historyIdx === -1) {
                  setHasNavigatedSuggestion(true);
                  setAutocompleteIndex((prev) => (prev + 1) % suggestions.length);
                  return;
                }
                setIsAutocompleteOpen(false);
                setHasNavigatedSuggestion(false);
                if (historyIdx <= 0) {
                  setHistoryIdx(-1);
                  setCommand("");
                } else {
                  const next = historyIdx - 1;
                  setHistoryIdx(next);
                  setCommand(history[next]);
                }
              } else if (e.key === "Tab") {
                if (isAutocompleteOpen && suggestions.length > 0) {
                  e.preventDefault();
                  const chosen = suggestions[autocompleteIndex] ?? suggestions[0];
                  setCommand(chosen.key);
                  setIsAutocompleteOpen(false);
                  setHasNavigatedSuggestion(false);
                }
              } else if (e.key === "Enter") {
                if (isAutocompleteOpen && hasNavigatedSuggestion && suggestions[autocompleteIndex]) {
                  e.preventDefault();
                  execute(suggestions[autocompleteIndex].key);
                }
              } else if (e.key === "Escape") {
                if (isAutocompleteOpen) {
                  e.preventDefault();
                  setIsAutocompleteOpen(false);
                  setHasNavigatedSuggestion(false);
                }
              }
            }}
            placeholder="TICKER <GO> · OPPS · FA · WEI · BUY/SELL · SPLIT 1/2/3 · F1-F12 (Alt+K)"
            maxLength={56}
            autoComplete="off"
            spellCheck={false}
          />

          {isAutocompleteOpen && suggestions.length > 0 && (
            <div className="terminal-autocomplete" role="listbox" aria-label="Command suggestions">
              {suggestions.map((item, idx) => {
                const pickSuggestion = () => {
                  const now = Date.now();
                  const prev = lastPickedSuggestionRef.current;
                  if (prev && prev.key === item.key && now - prev.at < 300) return;
                  lastPickedSuggestionRef.current = { key: item.key, at: now };
                  if (blurTimer.current !== null) {
                    clearTimeout(blurTimer.current);
                    blurTimer.current = null;
                  }
                  setCommand(item.key);
                  setIsAutocompleteOpen(false);
                  setHasNavigatedSuggestion(false);
                  execute(item.key);
                };
                return (
                <button
                  key={item.key}
                  type="button"
                  role="option"
                  aria-selected={idx === autocompleteIndex}
                  className={`autocomplete-item${idx === autocompleteIndex ? " highlighted" : ""}`}
                  onPointerDown={(e) => {
                    if (e.pointerType !== "mouse" && blurTimer.current !== null) {
                      clearTimeout(blurTimer.current);
                      blurTimer.current = null;
                    }
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickSuggestion();
                  }}
                  onClick={pickSuggestion}
                >
                  <span className="autocomplete-key">
                    <span className="autocomplete-cat">{item.category}</span>
                    {item.key}
                  </span>
                  <span className="autocomplete-desc">{item.description}</span>
                </button>
                );
              })}
            </div>
          )}
        </div>

        <button className="button small primary" type="submit">
          &lt;GO&gt;
        </button>

        {!externalWindow && (
          <button
            type="button"
            className="button small affen-terminal-launch"
            title="Open AffenTerminal in a separate synchronized window"
            onClick={() => {
              const linkState = useLinkStore.getState();
              const group = linkState.group === "off" ? "red" : linkState.group;
              if (linkState.group === "off") linkState.setGroup("red");
              if (!openAffenTerminalWindow(view, ticker, group)) {
                setStatusTone("error");
                setMessage("Pop-up blocked — allow browser pop-ups for this site to detach AffenTerminal.");
              }
            }}
          >
            <ExternalLink size={13} /> Pop-out ↗
          </button>
        )}

        <div className="segmented" aria-label="Terminal multi-pane layout">
          <button
            type="button"
            className={layoutMode === "single" && !maximizedPane ? "active" : ""}
            onClick={() => applyLayoutMode("single")}
            title="Single-pane view"
          >
            1-Pane
          </button>
          <button
            type="button"
            className={layoutMode === "split-2" && !maximizedPane ? "active" : ""}
            onClick={() => applyLayoutMode("split-2")}
            title="2-Pane (OPPS + FA)"
          >
            2-Pane
          </button>
          <button
            type="button"
            className={layoutMode === "split-3" && !maximizedPane ? "active" : ""}
            onClick={() => applyLayoutMode("split-3")}
            title="Bloomberg 3-pane grid: Primary + Fundamental/FA + Markets & News"
          >
            3-Pane Grid
          </button>
        </div>
      </form>

      <div className="panel-tabs">
        {TERMINAL_MODULES.map((item) => (
          <button
            type="button"
            key={item.id}
            className={view === item.id ? "active" : ""}
            onClick={() => {
              reset();
              setView(item.id);
              setActivePane("p1");
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {message && (
        <p
          className={`form-help terminal-status${statusTone === "error" ? " is-error" : statusTone === "ok" ? " is-ok" : ""}`}
          role="status"
        >
          {message}
        </p>
      )}

      <div className={`terminal-workspace-grid layout-${maximizedPane ? "single" : layoutMode}`}>
        {(!maximizedPane || maximizedPane === "p1") && (
          <div
            className={`terminal-pane terminal-primary-pane${activePane === "p1" ? " active-pane" : ""}`}
            onClick={() => setActivePane("p1")}
          >
            <TerminalTileHeader
              paneId="p1"
              title={`P1: ${getPaneTitle(view)} · ${ticker}`}
              currentView={view}
              onViewChange={(v) => setPaneView("p1", v)}
              isMaximized={maximizedPane === "p1"}
              onToggleMaximize={() => setMaximizedPane((m) => (m === "p1" ? null : "p1"))}
              canClose={false}
              isActive={activePane === "p1"}
              onFocus={() => setActivePane("p1")}
            />

            <div className="pane-content">
              <div hidden={view !== "opps"}>
                <ModuleErrorBoundary moduleName="Opportunities" resetKey="p1:opps">
                  {renderPaneBody("opps", "p1")}
                </ModuleErrorBoundary>
              </div>
              {view !== "opps" && (
                <ModuleErrorBoundary moduleName={getPaneTitle(view)} resetKey={`p1:${view}`}>
                  {renderPaneBody(view, "p1")}
                </ModuleErrorBoundary>
              )}
            </div>
          </div>
        )}

        {layoutMode !== "single" && (!maximizedPane || maximizedPane === "p2") && (
          <aside
            className={`terminal-pane terminal-secondary-pane${activePane === "p2" ? " active-pane" : ""}`}
            aria-label="Synchronisiertes Fundamental-Panel"
            onClick={() => setActivePane("p2")}
          >
            <TerminalTileHeader
              paneId="p2"
              title={`P2: ${getPaneTitle(resolvedPane2View)} · ${ticker}`}
              currentView={resolvedPane2View}
              onViewChange={(v) => setPane2View(v)}
              isMaximized={maximizedPane === "p2"}
              onToggleMaximize={() => setMaximizedPane((m) => (m === "p2" ? null : "p2"))}
              canClose={true}
              onClose={() => closePane("p2")}
              isActive={activePane === "p2"}
              onFocus={() => setActivePane("p2")}
            />

            <div className="pane-content">
              <ModuleErrorBoundary moduleName={getPaneTitle(resolvedPane2View)} resetKey={`p2:${resolvedPane2View}`}>
                {renderPaneBody(resolvedPane2View, "p2")}
              </ModuleErrorBoundary>
            </div>
          </aside>
        )}

        {layoutMode === "split-3" && (!maximizedPane || maximizedPane === "p3") && (
          <aside
            className={`terminal-pane terminal-tertiary-pane${activePane === "p3" ? " active-pane" : ""}`}
            aria-label="Live Markets und News Feed"
            onClick={() => setActivePane("p3")}
          >
            <TerminalTileHeader
              paneId="p3"
              title={`P3: ${getPaneTitle(pane3View)}`}
              currentView={pane3View}
              onViewChange={(v) => setPane3View(v)}
              isMaximized={maximizedPane === "p3"}
              onToggleMaximize={() => setMaximizedPane((m) => (m === "p3" ? null : "p3"))}
              canClose={true}
              onClose={() => closePane("p3")}
              isActive={activePane === "p3"}
              onFocus={() => setActivePane("p3")}
            />

            <div className="pane-content">
              <ModuleErrorBoundary moduleName={getPaneTitle(pane3View)} resetKey={`p3:${pane3View}`}>
                {renderPaneBody(pane3View, "p3")}
              </ModuleErrorBoundary>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
