"use client";

import { useEffect, useRef, useState } from "react";
import type { Timeframe } from "@/types/trading";
import type { StrategySettings } from "@/types/strategy";
import { benchmarkPresets, type PresetBenchmarkResult } from "@/lib/strategy/presetBenchmark";
import { STRATEGY_EXAMPLES } from "@/lib/strategy/scripts";
import { useStrategyStore } from "@/stores/useStrategyStore";

export function StrategyPresetBenchmark({ symbol, timeframe, settings, disabled }: {
  symbol: string; timeframe: Timeframe; settings: StrategySettings; disabled: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<PresetBenchmarkResult | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const start = async () => {
    if (disabled || running) return;
    const active = new AbortController();
    controller.current = active;
    setRunning(true); setResult(null); setStatus("Gemeinsame Kursreihe wird geladen…");
    try {
      const result = await benchmarkPresets(symbol, timeframe, settings, active.signal, setStatus);
      if (!active.signal.aborted) { setResult(result); setStatus(""); }
    } catch (error) {
      setStatus(active.signal.aborted ? "Preset-Vergleich gestoppt." : error instanceof Error ? error.message : "Preset-Vergleich fehlgeschlagen.");
    } finally { if (controller.current === active) { controller.current = null; setRunning(false); } }
  };
  const ranked = [...(result?.reports ?? [])].sort((a, b) => b.netProfit - a.netProfit);
  const reference = ranked[0];
  return <details className="strategy-preset-benchmark">
    <summary>Pine-Vorlagen vergleichen</summary>
    <p className="form-help">Alle Vorlagen laufen auf derselben Kursreihe mit den aktuellen Gebühren, Slippage und Kapitaleinstellungen. Die Rangfolge gilt für diesen Testzeitraum.</p>
    {running ? <button type="button" className="button small" onClick={() => controller.current?.abort()}>Vergleich stoppen</button> :
      <button type="button" className="button small" disabled={disabled} onClick={() => void start()}>Vorlagen im Backtest vergleichen</button>}
    {status && <p role="status">{status}</p>}
    {reference && <p className="form-help">{reference.market.symbol} · {reference.market.timeframe} · {new Date(reference.firstTime).toISOString().slice(0, 10)} bis {new Date(reference.lastTime).toISOString().slice(0, 10)} · {reference.source === "simulation" ? "Simulation" : "Börsenhistorie"}</p>}
    {!!ranked.length && <div className="table-scroll"><table className="data-table" aria-label="Rangfolge der Pine-Vorlagen">
      <thead><tr><th>Vorlage</th><th>Netto</th><th>Drawdown</th><th>Geschl. Trades</th></tr></thead>
      <tbody>{ranked.map(report => <tr key={report.name}>
        <td><button className="button small" type="button" disabled={disabled} onClick={() => {
          const store = useStrategyStore.getState();
          store.edit({ name: report.name, source: STRATEGY_EXAMPLES[report.name], inputs: {} });
          store.set({ inputSchema: [] });
        }}>{report.name}</button></td>
        <td>{(report.netProfit / report.initialCapital * 100).toFixed(2)} %</td>
        <td>{report.maxDrawdownPercent.toFixed(2)} %</td>
        <td>{report.closedTrades}</td>
      </tr>)}</tbody>
    </table></div>}
    {!!result?.failures.length && <p className="form-help">Fehlgeschlagen · {result.failures.join(", ")}</p>}
  </details>;
}
