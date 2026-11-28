"use client";
import { useMemo, useState } from "react";
import { Activity, BellPlus, EyeOff, RefreshCw, Sparkles, TrendingUp, X } from "lucide-react";
import { useDismiss } from "./WorkspaceMenus";
import { useChartStore } from "@/stores/useChartStore";
import {
  analyzeChart,
  buildAiAnalysisOverlays,
  type AiAnalysisLayerConfig,
} from "@/lib/analysis/aiChartAnalysis";
import { backtestAiChartAnalysis } from "@/lib/analysis/aiBacktest";
import { setOverlay } from "@/lib/chart/overlays";
import { PRIMARY_CELL } from "@/hooks/useOverlays";
import { symbolLabel } from "@/lib/symbolId";

function fmtPrice(p: number): string {
  const abs = Math.abs(p);
  if (abs >= 1000) return `$${p.toLocaleString("en-US", { maximumFractionDigits: 1 })}`;
  if (abs >= 10) return `$${p.toFixed(2)}`;
  if (abs >= 1) return `$${p.toFixed(3)}`;
  return `$${p.toFixed(5)}`;
}

const LAYER_LABELS: Array<{ key: keyof AiAnalysisLayerConfig; label: string }> = [
  { key: "structure", label: "Struktur & Trend" },
  { key: "zones", label: "OB & FVG" },
  { key: "levels", label: "S/R, Liq & POC" },
  { key: "fib", label: "Fib Pocket" },
  { key: "tradePlan", label: "Setup (SL/TP)" },
];

export function AiChartAnalysisButton() {
  const on = useChartStore((s) => s.aiAnalysisOn);
  const layers = useChartStore((s) => s.aiAnalysisLayers);
  const report = useChartStore((s) => s.aiAnalysisReport);
  const candles = useChartStore((s) => s.candles);
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  // Zero-look-ahead walk-forward backtest on the active chart's loaded history (only computed while popover is open)
  const historyBacktest = useMemo(() => {
    if (!open || !report || candles.length < 75) return null;
    const windowBars = candles.length > 360 ? candles.slice(-360) : candles;
    return backtestAiChartAnalysis({
      symbol,
      timeframe,
      bars: windowBars,
      warmupBars: 60,
      stepBars: 1,
      minConfidence: 64,
      maxEntryWaitBars: 4,
      maxHoldBars: 36,
      roundTripCostBps: 10,
    });
  }, [open, report, candles, symbol, timeframe]);

  const triggerAnalysis = () => {
    const state = useChartStore.getState();
    if (!state.aiAnalysisOn) {
      state.set({ aiAnalysisOn: true });
      if (state.candles.length >= 20) {
        const instant = analyzeChart({
          symbol: state.symbol,
          timeframe: state.timeframe,
          bars: state.candles,
        });
        state.set({ aiAnalysisReport: instant });
        setOverlay(PRIMARY_CELL, "ai-analysis", buildAiAnalysisOverlays(instant, state.aiAnalysisLayers));
      }
      setOpen(true);
      return;
    }
    setOpen((prev) => !prev);
  };

  const reanalyze = () => {
    const state = useChartStore.getState();
    if (state.candles.length < 20) return;
    const next = analyzeChart({
      symbol: state.symbol,
      timeframe: state.timeframe,
      bars: state.candles,
    });
    state.set({ aiAnalysisOn: true, aiAnalysisReport: next });
    setOverlay(PRIMARY_CELL, "ai-analysis", buildAiAnalysisOverlays(next, state.aiAnalysisLayers));
  };

  const clearAnalysis = () => {
    useChartStore.getState().set({ aiAnalysisOn: false, aiAnalysisReport: null });
    setOverlay(PRIMARY_CELL, "ai-analysis", []);
    setOpen(false);
  };

  const toggleLayer = (key: keyof AiAnalysisLayerConfig) => {
    const nextLayers = { ...layers, [key]: !layers[key] };
    useChartStore.getState().set({ aiAnalysisLayers: nextLayers });
    if (report) {
      setOverlay(PRIMARY_CELL, "ai-analysis", buildAiAnalysisOverlays(report, nextLayers));
    }
  };

  const createEntryAlert = () => {
    if (!report?.tradePlan) return;
    const plan = report.tradePlan;
    useChartStore.getState().set({
      alertDraft: {
        symbol,
        name: `AI ${report.setupQuality} ${plan.direction === "long" ? "Long" : "Short"} (${fmtPrice(plan.entryMid)})`,
        price: plan.entryMid,
        source: "manual",
      },
    });
    setOpen(false);
  };

  const openPaperTrade = () => {
    useChartStore.getState().set({ bottomOpen: true, bottomTab: "trading" });
    setOpen(false);
  };

  const biasText =
    report?.bias === "bullish"
      ? "BULLISCH"
      : report?.bias === "bearish"
        ? "BÄRISCH"
        : "NEUTRAL";

  const qualityClass =
    report?.setupQuality === "A+"
      ? "aplus"
      : report?.setupQuality === "B"
        ? "bsetup"
        : "wait";

  return (
    <div ref={ref} className="toolbar-popover-host">
      <button
        type="button"
        className={`toolbar-button ai-analysis-toolbar-button ${on ? "active" : ""}`}
        aria-label="AI Chartanalyse"
        title="Professionelle AI Chartanalyse v2: zeichnet Marktstruktur, Trendlinien, Supply/Demand, FVG, Fib Golden Pocket, S/R, POC & backgetestete Trade-Setups direkt in den Chart"
        aria-pressed={on}
        aria-expanded={open}
        onClick={triggerAnalysis}
      >
        <Sparkles size={17} />
        <span>
          AI Analyse{on && report ? ` · ${report.setupQuality}` : ""}
        </span>
      </button>

      {open ? (
        <div
          className="tv-popover ai-analysis-popover"
          role="dialog"
          aria-label="AI Chartanalyse Ergebnis"
        >
          <div className="ai-analysis-head">
            <div className="ai-analysis-title">
              <Sparkles size={15} className="ai-sparkle-icon" />
              <strong>AI Analyse v2</strong>
              <span className="ai-analysis-sym mono">
                {symbolLabel(symbol)} · {timeframe}
              </span>
            </div>
            <div className="ai-analysis-head-actions">
              {report && (
                <>
                  <span className={`ai-quality-pill ${qualityClass}`} title="Setup-Qualität aus Walk-Forward-Kalibrierung">
                    {report.setupQuality}
                  </span>
                  <span className={`ai-bias-pill ${report.bias}`}>
                    {biasText} · {report.confidence}%
                  </span>
                </>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label="Analyse schließen"
                onClick={() => setOpen(false)}
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {!report ? (
            <p className="form-help">Analysiere Kerzen, Marktstruktur, Order Blocks &amp; Zonen…</p>
          ) : (
            <>
              <p className="ai-analysis-headline">{report.headline}</p>

              <div className="ai-metrics-strip">
                <div>
                  <span>ADX(14)</span>
                  <strong className="mono">{report.adx14.toFixed(0)}</strong>
                </div>
                <div>
                  <span>RSI(14)</span>
                  <strong className="mono">{report.rsi14 !== null ? report.rsi14.toFixed(1) : "—"}</strong>
                </div>
                <div>
                  <span>Rel. Vol</span>
                  <strong className="mono">{report.relativeVolume.toFixed(1)}×</strong>
                </div>
                <div>
                  <span>ATR(14)</span>
                  <strong className="mono">{report.atrPct.toFixed(2)}%</strong>
                </div>
              </div>

              <div className="ai-layers-bar" role="group" aria-label="Eingezeichnete Ebenen">
                {LAYER_LABELS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`ai-layer-chip${layers[item.key] ? " active" : ""}`}
                    aria-pressed={layers[item.key]}
                    onClick={() => toggleLayer(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <ul className="ai-bullets">
                {report.bullets.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>

              {report.tradePlan ? (
                <div className={`ai-plan-card ${report.tradePlan.direction}`}>
                  <header>
                    <strong>
                      <TrendingUp size={13} />{" "}
                      {report.setupQuality} {report.tradePlan.direction === "long" ? "Long" : "Short"} ·{" "}
                      {report.tradePlan.entryMode === "breakout" ? "Breakout" : "Retest/Zone"}
                    </strong>
                    <span className="mono">
                      R:R {report.tradePlan.riskReward1.toFixed(1)} / {report.tradePlan.riskReward2.toFixed(1)}
                    </span>
                  </header>
                  <div className="ai-plan-grid mono">
                    <div>
                      <span>Entry-Zone</span>
                      <strong>
                        {fmtPrice(report.tradePlan.entryLow)}–{fmtPrice(report.tradePlan.entryHigh)}
                      </strong>
                    </div>
                    <div>
                      <span>Stop (2× ATR)</span>
                      <strong className="sl">{fmtPrice(report.tradePlan.stopLoss)}</strong>
                    </div>
                    <div>
                      <span>TP 1 (50%)</span>
                      <strong className="tp">{fmtPrice(report.tradePlan.target1)}</strong>
                    </div>
                    <div>
                      <span>Runner / TP 2</span>
                      <strong className="tp">
                        {fmtPrice(report.tradePlan.target2)} ({report.tradePlan.trailAtrMultiple.toFixed(1)}× Trail)
                      </strong>
                    </div>
                  </div>
                  <p className="form-help">{report.tradePlan.rationale}</p>
                  <div className="ai-plan-actions">
                    <button type="button" className="button" onClick={createEntryAlert}>
                      <BellPlus size={13} />
                      <span>Alarm auf Entry</span>
                    </button>
                    <button type="button" className="button primary" onClick={openPaperTrade}>
                      <span>Paper-Trade öffnen</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="ai-wait-card">
                  <strong>Kein Blind-Einstieg (WAIT)</strong>
                  <span>
                    Alle Zonen &amp; Struktur-Levels sind im Chart markiert. Ein Trade-Plan wird erst bei bestätigtem
                    Makro-Ausbruch (A+) oder sauberem Zonen-Retest (B) ausgelöst.
                  </span>
                </div>
              )}

              {historyBacktest && (
                <div className="ai-bt-strip" aria-label="Walk-Forward Backtest auf Chart-Historie">
                  <div className="ai-bt-head">
                    <strong>
                      <Activity size={12} /> Chart-Backtest ({Math.min(candles.length, 360)} Kerzen)
                    </strong>
                    <span className="mono">
                      {historyBacktest.trades > 0
                        ? `${historyBacktest.trades} Trades · Zero-Look-Ahead`
                        : "Kein Signal im Fenster"}
                    </span>
                  </div>
                  {historyBacktest.trades > 0 && (
                    <div className="ai-bt-grid mono">
                      <div>
                        <span>Winrate</span>
                        <strong>{historyBacktest.winRatePct.toFixed(0)}%</strong>
                      </div>
                      <div>
                        <span>Profit Factor</span>
                        <strong className={historyBacktest.profitFactor >= 1.1 ? "pos" : historyBacktest.profitFactor < 0.9 ? "neg" : ""}>
                          {historyBacktest.profitFactor >= 99 ? "∞" : historyBacktest.profitFactor.toFixed(2)}
                        </strong>
                      </div>
                      <div>
                        <span>Gesamt-R</span>
                        <strong className={historyBacktest.totalR >= 0 ? "pos" : "neg"}>
                          {historyBacktest.totalR >= 0 ? "+" : ""}
                          {historyBacktest.totalR.toFixed(1)}R
                        </strong>
                      </div>
                      <div>
                        <span>Max DD</span>
                        <strong>{historyBacktest.maxDrawdownR.toFixed(1)}R</strong>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="ai-analysis-footer">
                <button type="button" className="button" onClick={reanalyze}>
                  <RefreshCw size={13} />
                  <span>Neu analysieren</span>
                </button>
                <button type="button" className="button" onClick={clearAnalysis}>
                  <EyeOff size={13} />
                  <span>Zeichnungen ausblenden</span>
                </button>
              </div>
              <p className="ai-disclaimer">
                Walk-Forward-kalibrierte Chartanalyse (inkl. 0,10% Gebühren/Slippage im Backtest) — keine Anlageberatung.
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

