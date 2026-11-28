"use client";
import { useState } from "react";
import { Layers, ExternalLink, RefreshCw } from "lucide-react";
import { useDismiss } from "./WorkspaceMenus";
import { useChartStore } from "@/stores/useChartStore";
import { useLinkStore } from "@/stores/useLinkStore";
import { useOptionsChain } from "@/hooks/useOptionsChain";
import {
  computeOptionsPriceScale,
  formatCompactCount,
  formatCompactUsd,
  resolveOptionsTarget,
  type OptionsWallsOverlayConfig,
} from "@/lib/market/optionsAnalytics";
import { openAffenTerminalWindow } from "@/lib/windowScope";

const QUICK_SYMBOLS = [
  { label: "SPY", symbol: "YF:SPY" },
  { label: "QQQ", symbol: "YF:QQQ" },
  { label: "NVDA", symbol: "YF:NVDA" },
  { label: "AAPL", symbol: "YF:AAPL" },
  { label: "BTC", symbol: "BTCUSDT" },
];

function fmtStrike(price: number): string {
  return price >= 1000 ? `$${Math.round(price).toLocaleString("en-US")}` : `$${price.toFixed(price % 1 === 0 ? 0 : 2)}`;
}

export function OptionsWallsButton() {
  const on = useChartStore((s) => s.optionsWallsOn);
  const config = useChartStore((s) => s.optionsWallsConfig);
  const symbol = useChartStore((s) => s.symbol);
  const liveQuotePrice = useChartStore((s) => s.quotes[s.symbol]?.price);
  const lastCandleClose = useChartStore((s) => s.candles[s.candles.length - 1]?.close);
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const target = resolveOptionsTarget(symbol);
  const expiry = config.expiryMode === "nearest" ? "nearest" : "near";
  const { data, loading, error, refresh } = useOptionsChain(symbol, expiry, open || on);

  const chartPrice = liveQuotePrice && liveQuotePrice > 0 ? liveQuotePrice : lastCandleClose;
  const scale = data
    ? computeOptionsPriceScale(data.spot, chartPrice, Boolean(target?.scaleToChartPrice))
    : 1;

  const patchConfig = (patch: Partial<OptionsWallsOverlayConfig>) =>
    useChartStore.getState().set({ optionsWallsConfig: { ...config, ...patch } });

  const openDashboard = () => {
    setOpen(false);
    const link = useLinkStore.getState();
    const group = link.group === "off" ? "red" : link.group;
    const t = target?.ticker ?? "SPY";
    // Open embedded terminal panel first on mobile/compact, or dedicated window on desktop
    useChartStore.getState().set({ bottomOpen: true, bottomTab: "terminal" });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("affentrader:terminal-view", { detail: { view: "optionsflow", ticker: t } }));
    }
    if (typeof window !== "undefined" && window.innerWidth >= 1024) {
      if (link.group === "off") link.setGroup("red");
      openAffenTerminalWindow("optionsflow", t, group);
    }
  };

  return (
    <div ref={ref} className="toolbar-popover-host">
      <button
        type="button"
        className={`toolbar-button options-walls-toolbar-button ${on ? "active" : ""}`}
        aria-label="Options Walls & GEX"
        title="Put/Call Walls, Gamma Flip, Max Pain & Expected Move (inkl. tokenisierte Aktien auf Hyperliquid, Bybit & Binance)"
        aria-pressed={on}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Layers size={18} />
        <span>Walls{on && data?.callWall && data?.putWall ? " ●" : ""}</span>
      </button>
      {open ? (
        <div className="tv-popover options-walls-popover" role="dialog" aria-label="Options Walls Einstellungen">
          <div className="options-popover-head">
            <strong>Put/Call Walls &amp; GEX</strong>
            <span className="options-free-badge">Kein API-Key</span>
          </div>
          {target?.mappedFrom && (
            <p className="form-help" style={{ margin: 0 }}>
              Tokenisiert erkannt: US-Options-Levels von <strong>{target.display}</strong>
              {target.scaleToChartPrice ? " (auf Chart-Preis skaliert)" : " (1:1 übernommen)"}
            </p>
          )}
          <label className="sync-option">
            <span>Levels direkt im Chart anzeigen</span>
            <input
              type="checkbox"
              checked={on}
              onChange={(e) => useChartStore.getState().set({ optionsWallsOn: e.target.checked })}
            />
          </label>
          <label className="sync-option">
            <span>Call Wall &amp; Put Wall (OI)</span>
            <input
              type="checkbox"
              checked={config.showWalls}
              onChange={(e) => patchConfig({ showWalls: e.target.checked })}
            />
          </label>
          <label className="sync-option">
            <span>Gamma Flip (Zero Gamma)</span>
            <input
              type="checkbox"
              checked={config.showGammaFlip}
              onChange={(e) => patchConfig({ showGammaFlip: e.target.checked })}
            />
          </label>
          <label className="sync-option">
            <span>Max Pain</span>
            <input
              type="checkbox"
              checked={config.showMaxPain}
              onChange={(e) => patchConfig({ showMaxPain: e.target.checked })}
            />
          </label>
          <label className="sync-option">
            <span>Expected Move (±1σ)</span>
            <input
              type="checkbox"
              checked={config.showExpectedMove}
              onChange={(e) => patchConfig({ showExpectedMove: e.target.checked })}
            />
          </label>
          <label className="sync-option">
            <span>Verfalls-Fenster</span>
            <select
              value={config.expiryMode}
              onChange={(e) => patchConfig({ expiryMode: e.target.value === "nearest" ? "nearest" : "near" })}
            >
              <option value="near">Nahe Verfälle (3×)</option>
              <option value="nearest">Nächster Verfall</option>
            </select>
          </label>
          <hr />
          {!target ? (
            <div className="options-popover-empty">
              <p className="form-help">
                Für das aktuelle Symbol ist keine kostenlose Optionskette verfügbar. Unterstützt werden US-Aktien/ETFs, tokenisierte Werte (Hyperliquid, Bybit, Binance, Kraken) sowie BTC/ETH/SOL:
              </p>
              <div className="options-quick-chips">
                {QUICK_SYMBOLS.map((q) => (
                  <button
                    key={q.symbol}
                    type="button"
                    className="options-chip"
                    onClick={() => useChartStore.getState().set({ symbol: q.symbol, optionsWallsOn: true })}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          ) : loading && !data ? (
            <p className="form-help">Lade Optionskette für {target.display}…</p>
          ) : error && !data ? (
            <p className="form-help">{error}</p>
          ) : data ? (
            <div className="options-popover-summary">
              <div className="options-popover-meta">
                <span>
                  {data.display} · {data.includedExpirations.length} Verfall{data.includedExpirations.length === 1 ? "" : "e"}
                </span>
                <button type="button" className="icon-button" aria-label="Optionsdaten aktualisieren" onClick={refresh}>
                  <RefreshCw size={13} />
                </button>
              </div>
              <div className="options-mini-grid">
                <div className="options-mini-row call">
                  <span>Call Wall</span>
                  <strong className="mono">
                    {data.callWall ? `${fmtStrike(data.callWall.strike * scale)} (${formatCompactCount(data.callWall.openInterest)})` : "—"}
                  </strong>
                </div>
                <div className="options-mini-row put">
                  <span>Put Wall</span>
                  <strong className="mono">
                    {data.putWall ? `${fmtStrike(data.putWall.strike * scale)} (${formatCompactCount(data.putWall.openInterest)})` : "—"}
                  </strong>
                </div>
                <div className="options-mini-row gamma">
                  <span>Gamma Flip</span>
                  <strong className="mono">{data.gammaFlip !== null ? fmtStrike(data.gammaFlip * scale) : "—"}</strong>
                </div>
                <div className="options-mini-row pain">
                  <span>Max Pain</span>
                  <strong className="mono">{data.maxPain !== null ? fmtStrike(data.maxPain * scale) : "—"}</strong>
                </div>
                <div className="options-mini-row em">
                  <span>Expected Move</span>
                  <strong className="mono">
                    {data.expectedMovePct !== null && data.expectedMoveUsd !== null
                      ? `±${data.expectedMovePct.toFixed(1)}% (±$${(data.expectedMoveUsd * scale).toFixed(data.expectedMoveUsd * scale >= 100 ? 0 : 2)})`
                      : "—"}
                  </strong>
                </div>
                <div className="options-mini-row">
                  <span>Net GEX / P/C</span>
                  <strong className="mono">
                    {formatCompactUsd(data.netGexUsd)} · {data.pcRatioOi !== null ? data.pcRatioOi.toFixed(2) : "—"}
                  </strong>
                </div>
              </div>
            </div>
          ) : null}
          <button type="button" className="button primary options-popover-cta" onClick={openDashboard}>
            <ExternalLink size={14} />
            <span>Vollständige Options-Analyse</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
