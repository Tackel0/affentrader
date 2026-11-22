"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Terminal, ExternalLink, Activity, Moon, Sun } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { LINK_GROUPS, useLinkStore } from "@/stores/useLinkStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { useWindowLink } from "@/hooks/useWindowLink";
import type { TerminalView } from "@/lib/terminal/commands";
import type { GlobalMacroPulse } from "@/lib/server/macroAndSentimentSources";
import { isYahooTicker, symbolLabel } from "@/lib/symbolId";
import { resolveOrderTargetSymbol } from "@/lib/terminal/orders";
import { scopedName } from "@/lib/windowScope";
import { ResearchTerminal } from "./ResearchTerminal";
import { ModuleErrorBoundary } from "./ModuleErrorBoundary";
import { MarketConnections } from "./MarketConnections";

function AffenUtcClock() {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const updateClock = () => {
      setClock(new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC");
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="mono muted affen-clock">{clock}</span>;
}

export function AffenTerminalWindow({
  initialView = "opps",
  initialTicker = "QCOM",
  deployment,
}: {
  initialView?: TerminalView;
  initialTicker?: string;
  deployment?: ReactNode;
}) {
  useWindowLink();
  const symbol = useChartStore((s) => s.symbol);
  const linkGroup = useLinkStore((s) => s.group);
  const setLinkGroup = useLinkStore((s) => s.setGroup);
  const theme = useWorkspaceStore((s) => s.theme);
  const [macro, setMacro] = useState<GlobalMacroPulse | null>(null);

  // Default standalone AffenTerminal to institutional pitch-charcoal dark when no explicit theme preference is persisted.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const explicitTheme = new URLSearchParams(window.location.search).get("theme");
    if (explicitTheme === "light" || explicitTheme === "dark") {
      useWorkspaceStore.getState().setTheme(explicitTheme);
      return;
    }
    let hasStoredTheme = false;
    try {
      const raw = localStorage.getItem(scopedName("affentrader-premium-v1"));
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: { theme?: string } };
        if (parsed?.state?.theme === "light" || parsed?.state?.theme === "dark") {
          hasStoredTheme = true;
        }
      }
    } catch {
      /* ignore storage errors */
    }
    if (!hasStoredTheme && useWorkspaceStore.getState().theme === "light" && document.documentElement.dataset.theme !== "light") {
      useWorkspaceStore.getState().setTheme("dark");
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
    document.title = `AffenTerminal · ${symbolLabel(symbol)}`;
  }, [theme, symbol]);

  useEffect(() => {
    const hasExplicitLink =
      typeof window !== "undefined" && new URLSearchParams(window.location.search).has("link");
    let hasStoredLink = false;
    try {
      hasStoredLink = typeof sessionStorage !== "undefined" && Boolean(sessionStorage.getItem("affentrader-link-group"));
    } catch {
      /* sessionStorage unavailable */
    }
    if (!hasExplicitLink && !hasStoredLink && linkGroup === "off") setLinkGroup("red");
    // Only apply default link group on initial mount when neither URL nor sessionStorage has an explicit choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Honor explicit ?ticker= param on external launch and propagate to linked windows
  useEffect(() => {
    if (typeof window === "undefined") return;
    const rawParam = new URLSearchParams(window.location.search).get("ticker");
    const clean = rawParam?.replace(/^YF:/i, "").trim().toUpperCase();
    if (clean && isYahooTicker(clean)) {
      useChartStore.getState().set({ symbol: resolveOrderTargetSymbol(clean) });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false, lastRequest = 0;
    const loadMacro = async () => {
      if (document.hidden || pending || Date.now() - lastRequest < 120_000) return;
      pending = true;
      lastRequest = Date.now();
      try {
        const res = await fetch("/api/feeds?kind=macro", { signal: controller.signal });
        if (!res.ok) return;
        const json = (await res.json()) as GlobalMacroPulse;
        if (!controller.signal.aborted) setMacro(json);
      } catch {
        /* keep header silent when offline */
      } finally { pending = false; }
    };
    void loadMacro();
    const timer = setInterval(() => void loadMacro(), 120_000);
    document.addEventListener("visibilitychange", loadMacro);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", loadMacro);
    };
  }, []);

  return (
    <div className={`affen-window-shell theme-${theme}`}>
      {deployment}
      <header className="affen-window-header">
        <div className="affen-brand-block">
          <Terminal size={18} aria-hidden="true" />
          <strong>AffenTerminal</strong>
        </div>

        <div className="affen-header-actions">
          <AffenUtcClock />
          <button
            type="button"
            className="button small"
            aria-label={theme === "dark" ? "Light" : "Dark"}
            onClick={() => {
              useWorkspaceStore.getState().setTheme(theme === "dark" ? "light" : "dark");
            }}
          >
            {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="button small"
            aria-label="Chart Workspace"
            onClick={() => {
              if (window.opener && !window.opener.closed) {
                window.opener.focus();
              } else {
                window.open("/", "affenterminal-chart");
              }
            }}
            title="Focus or open main chart workspace"
          >
            <ExternalLink size={14} aria-hidden="true" /><span>Chart</span>
          </button>
        </div>

        <div className="affen-sync-block">
          <strong className="mono affen-symbol" aria-label={`Verknüpftes Symbol ${symbolLabel(symbol)}`}
            title="Verknüpftes Chart-Symbol">{symbolLabel(symbol)}</strong>
          <div className="link-groups" role="radiogroup" aria-label="Window link color">
            {LINK_GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={linkGroup === g}
                className={`link-chip ${g} ${linkGroup === g ? "active" : ""}`}
                title={g === "off" ? "Unlinked" : `Sync Group: ${g}`}
                onClick={() => setLinkGroup(g)}
              >
                {g === "off" ? "Off" : ""}
              </button>
            ))}
          </div>
        </div>
      </header>

      {(macro?.crossAssets?.length || macro?.fearGreed) ? (
        <div className="affen-macro-ribbon">
          <span className="pulse-tag">
            <Activity size={12} /> PULSE
          </span>
          {(macro.crossAssets ?? []).map((a) => {
            const pctVal = Number.isFinite(a.changePct) ? a.changePct : 0;
            return (
              <button
                key={a.symbol}
                type="button"
                className="chip"
                onClick={() => useChartStore.getState().set({ symbol: a.symbol, timeframe: "1D" })}
                title={`Open chart: ${a.label}`}
              >
                <span>{a.label}</span>{" "}
                <strong className="mono">{a.price}</strong>{" "}
                <span className={`mono ${pctVal >= 0 ? "positive" : "negative"}`}>
                  {pctVal >= 0 ? "+" : ""}
                  {pctVal.toFixed(1)}%
                </span>
              </button>
            );
          })}
          {macro.fearGreed ? (
            <span className="mono affen-fear-greed">
              F&amp;G: <strong>{macro.fearGreed.value}</strong> ({macro.fearGreed.classification})
            </span>
          ) : null}
        </div>
      ) : null}

      <main className="affen-window-body">
        <MarketConnections />
        <ModuleErrorBoundary moduleName="AffenTerminal">
          <ResearchTerminal
            externalWindow
            initialView={initialView}
            initialTicker={initialTicker}
            onSelectSymbol={(nextSymbol) => {
              useChartStore.getState().set({ symbol: nextSymbol });
            }}
          />
        </ModuleErrorBoundary>
      </main>
    </div>
  );
}
