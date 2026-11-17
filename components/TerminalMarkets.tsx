"use client";
import { useEffect, useState } from "react";
import type { TerminalMarketRow } from "@/lib/terminal/markets";
import { formatPrice } from "@/lib/symbols";

const horizons = [1, 5, 20] as const;

export function TerminalMarkets({ openChart }: { openChart: (ticker: string) => void }) {
  const [rows, setRows] = useState<TerminalMarketRow[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const request = new AbortController();
    const load = async () => {
      try {
        const response = await fetch("/api/terminal-markets", { signal: request.signal });
        const data = (await response.json().catch(() => ({}))) as { rows?: TerminalMarketRow[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Market overview unavailable.");
        if (!request.signal.aborted) setRows(data.rows ?? []);
      } catch (error) {
        if (!request.signal.aborted) setError(error instanceof Error ? error.message : "Market overview unavailable.");
      } finally {
        if (!request.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => request.abort();
  }, [attempt]);
  return <section aria-label="Global markets">
    <div className="screener-toolbar">
      <button type="button" className="button small" disabled={loading} onClick={() => { setLoading(true); setError(""); setAttempt(attempt + 1); }}>Refresh markets</button>
      <span className="terminal-telemetry-chip mono" role="status">{loading ? "SYNCING MARKETS…" : `${rows.filter(row => row.quote).length}/${rows.length} LIVE · YAHOO`}</span>
    </div>
    {error && <p className="error-message screener-error" role="alert">{error}</p>}
    {!loading && !error && !rows.length && <div className="empty-table">No market quotes available.</div>}
    {!!rows.length && <div className="stock-base-results table-scroll"><table className="data-table" aria-label="Global market returns">
      <thead><tr><th>Market</th><th>Close</th>{horizons.map(n => <th key={n}>{n}D</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.ticker} title={row.quote ? `${row.group} · Session ${row.quote.session}` : row.group}>
        <td><button className="button small" type="button" onClick={() => openChart(row.ticker)}>{row.label}</button> <small className="muted mono">{row.group.slice(0, 3).toUpperCase()}</small></td>
        <td className="mono">{row.quote ? `${formatPrice(row.quote.close)}${row.group === "Indices" ? " pts" : ` ${row.quote.currency}`}` : "Unavailable"}</td>
        {horizons.map(n => {
          const value = row.quote?.changes[n];
          return <td key={n} className={`mono ${value == null || value === 0 ? "" : value > 0 ? "positive" : "negative"}`.trim()}>{value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`}</td>;
        })}
      </tr>)}</tbody>
    </table></div>}
    <div className="terminal-telemetry-chip">
      <span className="mono">DATA:</span> EOD Daily Candles{rows.find(r => r.quote?.session)?.quote?.session ? ` · ${rows.find(r => r.quote?.session)?.quote?.session}` : ""} · Continuous Futures Include Roll Effects
    </div>
  </section>;
}
