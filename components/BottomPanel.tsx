"use client";
import { baseVolume, periodLabel, quoteRange, rangeDescription } from "@/lib/market/quoteMetrics";
import { useQuoteRanges } from "@/hooks/useQuoteRanges";
import { symbolLabel } from "@/lib/symbolId";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { bindBottomPanelResize } from "@/lib/chart/bottomPanelResize";
import {
  ChevronDown,
  ChevronUp,
  Code2,
  BookOpen,
  Play,
  Upload,
  Download,
  Activity,
  ArrowUpRight,
  Maximize2,
} from "lucide-react";
import { HeatmapPanel } from "./HeatmapPanel";
import { WorkspacePanelTabs } from "./WorkspacePanelTabs";
import { useChartStore } from "@/stores/useChartStore";
import { describeSymbol, formatPrice, formatVolume, getSymbol } from "@/lib/symbols";
import {
  STARTER_SCRIPT,
  STRUCTURE_SCRIPT,
  LIQUIDITY_SCRIPT,
  KNN_SCRIPT,
  ICHIMOKU_SCRIPT,
} from "@/lib/indicators/scripts";
import { indicatorHandles } from "@/hooks/useVelaChart";
import { IconButton } from "./ui";
import { PineLibraries } from "./PineLibraries";
import { StrategyTester } from "./StrategyTester";
import { useStrategyStore } from "@/stores/useStrategyStore";
import { downloadFile } from "@/lib/files";
import { TradingPanel } from "./TradingPanel";
import { DomPanel } from "./DomPanel";
import { OrderFlowPanel } from "./OrderFlowPanel";
import { PortfolioPanel } from "./PortfolioPanel";
import { ScreenerPanel } from "./ScreenerPanel";
import { NewsPanel } from "./NewsPanel";
import { CalendarPanel } from "./CalendarPanel";
import { ResearchTerminal } from "./ResearchTerminal";
import { ModuleErrorBoundary } from "./ModuleErrorBoundary";
import type { BottomTab } from "@/types/trading";
/** Tabs that share the resizable full-height tool layout. */
const TOOL_TABS: BottomTab[] = ["trading", "dom", "portfolio", "screener", "terminal", "news", "calendar", "heatmap"];
const examples: Record<string, string> = {
  "EMA crossover": STARTER_SCRIPT,
  "Market structure": STRUCTURE_SCRIPT,
  "Liquidity sweeps": LIQUIDITY_SCRIPT,
  "k-NN momentum": KNN_SCRIPT,
  "Ichimoku Cloud": ICHIMOKU_SCRIPT,
};
export function BottomPanel() {
  const open = useChartStore((s) => s.bottomOpen),
    tab = useChartStore((s) => s.bottomTab);
  const resizable = open && (tab === "strategy" || TOOL_TABS.includes(tab));
  const contentId = useId();
  const panel = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const resize = useRef<ReturnType<typeof bindBottomPanelResize>>(null);
  useLayoutEffect(() => {
    const dock = panel.current;
    const chart = dock?.parentElement?.querySelector<HTMLElement>(".chart-grid");
    if (!resizable || !dock || !chart || !content.current || !handle.current) return;
    const binding = bindBottomPanelResize(dock, content.current, handle.current, chart);
    resize.current = binding;
    return () => {
      binding.dispose();
      resize.current = null;
    };
  }, [resizable, tab]);
  return (
    <section
      ref={panel}
      className={`bottom-panel ${open ? "expanded" : ""} ${resizable ? "resizable-panel" : ""} ${tab === "pine" ? "editor-panel" : tab === "strategy" ? "strategy-panel" : TOOL_TABS.includes(tab) ? "tool-panel" : ""}`}
    >
      {resizable ? (
        <div
          ref={handle}
          className="bottom-panel-resizer"
          role="separator"
          aria-label="Resize bottom panel"
          aria-controls={contentId}
          aria-orientation="horizontal"
          tabIndex={0}
        />
      ) : null}
      <WorkspacePanelTabs>
        {resizable ? (
          <IconButton
            label="Toggle panel height"
            aria-controls={contentId}
            onClick={() => resize.current?.toggle()}
          >
            <Maximize2 size={14} />
          </IconButton>
        ) : null}
        <IconButton
          label={open ? "Collapse bottom panel" : "Expand bottom panel"}
          onClick={() => useChartStore.getState().set({ bottomOpen: !open })}
        >
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </IconButton>
      </WorkspacePanelTabs>
      {open ? (
        <div id={contentId} ref={content} className="bottom-panel-content">
          <ModuleErrorBoundary moduleName={`Bottom panel (${tab})`} resetKey={tab} compact>
            {tab === "overview" ? (
              <MarketOverview />
            ) : tab === "pine" ? (
              <PineEditor />
            ) : tab === "strategy" ? (
              <StrategyTester />
            ) : tab === "trading" ? (
              <TradingPanel />
            ) : tab === "dom" ? (
              <DomPanel />
            ) : tab === "portfolio" ? (
              <PortfolioPanel />
            ) : tab === "screener" ? (
              <ScreenerPanel />
            ) : tab === "terminal" ? (
              <ResearchTerminal />
            ) : tab === "news" ? (
              <NewsPanel />
            ) : tab === "calendar" ? (
              <CalendarPanel />
            ) : tab === "heatmap" ? (
              <HeatmapPanel />
            ) : (
              <OrderFlowPanel />
            )}
          </ModuleErrorBoundary>
        </div>
      ) : null}
    </section>
  );
}
function MarketOverview() {
  const symbol = useChartStore((s) => s.symbol),
    quote = useChartStore((s) => s.quotes[s.symbol]),
    trades = useChartStore((s) => s.trades),
    status = useChartStore((s) => s.feedStatus);
  useQuoteRanges([symbol]);
  const volume = baseVolume(quote), range = quoteRange(quote);
  const ratio = useMemo(() => {
    let buys = 0;
    let sells = 0;
    for (const t of trades) {
      if (t.side === "buy") buys += t.quantity;
      else if (t.side === "sell") sells += t.quantity;
    }
    return buys + sells ? buys / (buys + sells) : 0.5;
  }, [trades]);
  return (
    <div className="market-overview">
      <div className="overview-metric">
        <span>{periodLabel(quote?.metrics?.volume.period)} trading volume</span>
        <strong className="mono">
          {volume === null ? "—" : formatVolume(volume)}
          <small>{getSymbol(symbol).base}</small>
        </strong>
        <p>{describeSymbol(symbol).venue} market</p>
      </div>
      <div className="overview-metric">
        <span title={rangeDescription(quote)}>{periodLabel(quote?.metrics?.range.period)} price range</span>
        <strong className="mono range-value">
          {range.low === null ? "—" : formatPrice(range.low)}
          <small>—</small>
          {range.high === null ? "—" : formatPrice(range.high)}
        </strong>
        <p>Quoted in {describeSymbol(symbol).quote || "the market currency"}</p>
      </div>
      <div className="overview-metric flow-metric">
        <span>
          Collected trade volume <small>BUY / SELL</small>
        </span>
        <strong>
          <span className="positive mono">{(ratio * 100).toFixed(1)}%</span>
          <span className="negative mono">
            {((1 - ratio) * 100).toFixed(1)}%
          </span>
        </strong>
        <div className="sentiment-bar">
          <i style={{ width: `${ratio * 100}%` }} />
        </div>
        <p>{trades.length.toLocaleString()} trades since connection</p>
      </div>
      <div className="overview-connection">
        <span
          className={`connection-icon ${status === "live" ? "positive" : "amber-text"}`}
        >
          {status === "live" ? (
            <ArrowUpRight size={20} />
          ) : (
            <Activity size={20} />
          )}
        </span>
        <div>
          <strong>
            {status === "live"
              ? `Connected to ${describeSymbol(symbol).feed}`
              : status === "simulation"
                ? "Offline simulation"
                : "Connecting to market"}
          </strong>
          <p>
            {status === "live"
              ? describeSymbol(symbol).streams
                ? "Streaming trades, quotes & depth"
                : "Polling quotes · no trade stream"
              : status === "simulation"
                ? "Synthetic ticks · automatic live retry"
                : "Secure public WebSocket feed"}
          </p>
        </div>
      </div>
    </div>
  );
}
function PineEditor() {
  const draft = useChartStore.getState().pineDraft;
  const [source, setSource] = useState(draft?.source ?? STARTER_SCRIPT),
    [name, setName] = useState(draft?.name ?? "EMA crossover"),
    [activeId, setActiveId] = useState<string | null>(draft?.activeId ?? null),
    [status, setStatus] = useState("Ready to run"),
    [busy, setBusy] = useState(false),
    [librariesOpen, setLibrariesOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const indicators = useChartStore((s) => s.indicators);
  useEffect(() => {
    useChartStore.getState().set({ pineDraft: { source, name, activeId } });
  }, [source, name, activeId]);
  useEffect(() => {
    if (!activeId) return;
    const indicator = indicators.find((i) => i.id === activeId);
    if (!indicator) {
      setStatus("Removed from chart");
      setBusy(false);
      return;
    }
    if (indicator.error) {
      setStatus(indicator.error);
      setBusy(false);
      return;
    }
    let disposed = false;
    let completed = false;
    let unsub: (() => void) | undefined;
    const poll = setInterval(() => {
      const handle = indicatorHandles.get(activeId);
      if (handle) {
        clearInterval(poll);
        unsub = handle.on("ready", () => {
          if (!disposed) {
            completed = true;
            setStatus("Compiled & running · worker thread");
            setBusy(false);
          }
        });
        const fail = handle.on("error", ({ error }) => {
          if (!disposed) {
            setStatus(error.message);
            setBusy(false);
          }
        });
        const prev = unsub;
        unsub = () => {
          prev?.();
          fail();
        };
        void handle.context().then((ctx) => {
          if (ctx && !disposed) {
            completed = true;
            setStatus("Compiled & running · worker thread");
            setBusy(false);
          }
        });
      }
    }, 80);
    const timeout = setTimeout(() => {
      if (!disposed && !completed) {
        setBusy(false);
        setStatus(
          "Execution is taking longer than expected. Review the study diagnostic above.",
        );
      }
    }, 30000);
    return () => {
      disposed = true;
      clearInterval(poll);
      clearTimeout(timeout);
      unsub?.();
    };
  }, [activeId, source, indicators]);
  const run = () => {
    const store = useChartStore.getState();
    if (!source.trim()) {
      setStatus("Enter a Pine Script before running.");
      return;
    }
    setBusy(true);
    setStatus("Compiling in PineTS worker…");
    if (activeId && store.indicators.some((i) => i.id === activeId))
      store.updateIndicator(activeId, { script: source, error: undefined });
    else {
      const id = crypto.randomUUID();
      store.addIndicator({
        id,
        definitionId: "custom-pine",
        name,
        script: source,
        visible: true,
        inputs: {},
        color: "#7c83ff",
        lineWidth: 2,
        source: "close",
      });
      setActiveId(id);
    }
  };
  return (
    <div className="pine-editor">
      <div className="pine-toolbar">
        <Code2 size={15} className="text-accent" />
        <input
          aria-label="Script name"
          className="script-name"
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          aria-label="Example script"
          value={
            Object.keys(examples).find((key) => examples[key] === source) ??
            "custom"
          }
          onChange={(e) => {
            if (e.target.value === "custom") return;
            setName(e.target.value);
            setSource(examples[e.target.value]);
            setActiveId(null);
            setStatus("Ready to run");
          }}
        >
          {Object.keys(examples).map((n) => (
            <option key={n}>{n}</option>
          ))}
          <option value="custom">Custom script</option>
        </select>
        <span className="flex-1" />
        <IconButton
          label="Manage Pine libraries"
          onClick={() => setLibrariesOpen(true)}
        >
          <BookOpen size={15} />
        </IconButton>
        <IconButton
          label="Import Pine script"
          onClick={() => file.current?.click()}
        >
          <Upload size={15} />
        </IconButton>
        <IconButton
          label="Download Pine script"
          onClick={() =>
            downloadFile(
              `${name.replace(/[^a-z0-9-]/gi, "-")}.pine`,
              source,
              "text/plain",
            )
          }
        >
          <Download size={15} />
        </IconButton>
        <input
          hidden
          ref={file}
          type="file"
          accept=".pine,.txt,.pinescript"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              if (f.size > 500000) {
                setStatus("Pine source exceeds 500 KB.");
                e.target.value = "";
                return;
              }
              setSource(await f.text());
              setName(f.name.replace(/\.[^.]+$/, ""));
              setActiveId(null);
              setStatus("Script imported");
            }
            e.target.value = "";
          }}
        />
        <button className="button primary small" onClick={run} disabled={busy}>
          <Play size={12} />
          {busy ? "Running…" : activeId ? "Update on chart" : "Add to chart"}
        </button>
        <button
          className="button small"
          onClick={() => {
            const strategy = useStrategyStore.getState();
            strategy.edit({
              name,
              source,
              inputs:
                strategy.document.source === source
                  ? strategy.document.inputs
                  : {},
            });
            useStrategyStore.getState().set({ inputSchema: [] });
            useChartStore
              .getState()
              .set({ bottomTab: "strategy", bottomOpen: true });
          }}
        >
          Test strategy
        </button>
      </div>
      <div className="code-area">
        <div className="line-numbers" aria-hidden="true">
          {source.split("\n").map((_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
        <textarea
          spellCheck={false}
          aria-label="Pine Script source code"
          maxLength={500000}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              run();
            }
            if (e.key === "Tab") {
              e.preventDefault();
              const target = e.currentTarget;
              const start = target.selectionStart;
              setSource(
                source.slice(0, start) +
                  "    " +
                  source.slice(target.selectionEnd),
              );
              requestAnimationFrame(() => {
                target.selectionStart = target.selectionEnd = start + 4;
              });
            }
          }}
        />
      </div>
      <div
        className={`pine-status ${indicators.find((i) => i.id === activeId)?.error ? "negative" : ""}`}
      >
        <span className={`status-dot ${busy ? "amber" : ""}`} />
        {status}
        <span className="flex-1" />
        <span>v5 / v6 · Ctrl + Enter to run · AGPL-3.0 runtime</span>
      </div>
      {librariesOpen ? (
        <PineLibraries onClose={() => setLibrariesOpen(false)} />
      ) : null}
    </div>
  );
}
