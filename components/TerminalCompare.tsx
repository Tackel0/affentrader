"use client";
import { useEffect, useRef, useState } from "react";
import { closingDrawdowns } from "@/lib/terminal/drawdown";
import { downloadFile } from "@/lib/files";
import { csvEscape } from "@/lib/watchlist";

interface Comparison {
  tickers: [string, string];
  asOf: string;
  observations: number;
  latestSessions: string[];
  unmatchedInstrumentDates: [number, number];
  missingFxSessions: number;
  basis: string;
  currencies: string[];
  rows: { sessions: number; start: string; a: number; b: number; relative: number; localA: number; localB: number; maxDrawdownA: number; maxDrawdownB: number }[];
  retestRow: Comparison["rows"][number] | null;
  series: { session: string; a: number; b: number }[];
}

function ComparisonChart({ result, retest }: { result: Comparison; retest?: string }) {
  const retestIndex = result.series.findIndex(bar => bar.session === retest);
  const hasRetest = retestIndex >= 0 && retestIndex < result.series.length - 1;
  const [horizon, setHorizon] = useState(hasRetest ? "retest" : String(result.rows.at(-1)!.sessions));
  const [inspection, setInspection] = useState<number | null>(null);
  const [view, setView] = useState("return");
  const bars = horizon === "retest" ? result.series.slice(retestIndex) : result.series.slice(-Number(horizon) - 1);
  const drawdownsA = closingDrawdowns(bars.map(bar => bar.a));
  const drawdownsB = closingDrawdowns(bars.map(bar => bar.b));
  const points = bars.map((bar, index) => {
    const a = bar.a / bars[0].a, b = bar.b / bars[0].b;
    return {
      session: bar.session, a: 100 * (a - 1), b: 100 * (b - 1), relative: 100 * (a / b - 1),
      drawdownA: drawdownsA[index].percent, drawdownB: drawdownsB[index].percent,
    };
  });
  const lines = view === "relative" ? ["relative"] as const
    : view === "drawdown" ? ["drawdownA", "drawdownB"] as const : ["a", "b"] as const;
  const values = points.flatMap(point => lines.map(key => point[key]));
  const low = Math.min(-.1, ...values);
  const high = Math.max(.1, ...values);
  const dates = points.map(point => Date.parse(point.session));
  const firstDate = dates[0], duration = dates.at(-1)! - firstDate;
  const x = (i: number) => 52 + 530 * (dates[i] - firstDate) / duration;
  const y = (value: number) => 12 + 120 * (high - value) / (high - low);
  const selected = inspection ?? points.length - 1, point = points[selected];
  const describeWorst = (ticker: string, drawdowns: typeof drawdownsA) => {
    const troughIndex = drawdowns.reduce((worst, item, index) => item.percent < drawdowns[worst].percent ? index : worst, 0);
    const trough = drawdowns[troughIndex];
    if (trough.percent === 0) return `${ticker} had no closing drawdown`;
    return `${ticker} ${trough.percent.toFixed(2)}% from ${bars[trough.peakIndex].session} to ${bars[troughIndex].session}`;
  };
  return <figure className="terminal-compare-chart">
    <div className="screener-toolbar"><label>Chart range<select value={horizon} onChange={event => { setHorizon(event.target.value); setInspection(null); }}>{hasRetest && <option value="retest">Since retest ({retest})</option>}{result.rows.map(row => <option key={row.sessions} value={row.sessions}>{row.sessions} sessions</option>)}</select></label>
      <label>Measure<select value={view} onChange={event => setView(event.target.value)}>
        <option value="return">Cumulative return</option><option value="relative">Relative performance</option><option value="drawdown">Drawdown</option>
      </select></label>
      {view === "relative" ? <span className="compare-first mono">{result.tickers[0]} vs {result.tickers[1]}</span> : <><span className="compare-first mono">{result.tickers[0]}</span><span className="compare-second mono">{result.tickers[1]}</span></>}
      <span className="mono muted">{result.basis === "local" ? "Local currencies" : result.basis}</span>
      <button type="button" className="button small" onClick={() => {
        const [a, b] = result.tickers;
        const [currencyA, currencyB] = result.basis === "local" ? result.currencies : [result.basis, result.basis];
        const rows = [["session", "symbol_a", "symbol_b", "currency_a", "currency_b", "close_a", "close_b", "return_a_pct", "return_b_pct", "relative_pct", "drawdown_a_pct", "drawdown_b_pct"],
          ...points.map((point, index) => [point.session, a, b, currencyA, currencyB, bars[index].a, bars[index].b, point.a, point.b, point.relative, point.drawdownA, point.drawdownB])];
        const csv = rows.map(row => row.map(value => csvEscape(typeof value === "string" && /^[=+\-@]/.test(value) ? `'${value}` : value)).join(",")).join("\r\n");
        downloadFile(`terminal-comparison-${result.asOf}.csv`, `${csv}\r\n`, "text/csv;charset=utf-8");
      }}>Download chart CSV</button>
    </div>
    {retest && !hasRetest && <p className="form-help">A comparison from the retest on {retest} requires a shared close on that date and at least one later shared close within the chart history.</p>}
    <svg viewBox="0 0 600 150" role="img" aria-label={view === "drawdown" ? "Drawdown from the highest close so far in the chart range" : view === "relative" ? `Relative performance of ${result.tickers[0]} versus ${result.tickers[1]}` : "Cumulative returns from the same starting session"} onPointerMove={event => {
      const transform = event.currentTarget.getScreenCTM();
      if (!transform) return;
      const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse()).x;
      setInspection(dates.reduce((nearest, _, index) => Math.abs(x(index) - position) < Math.abs(x(nearest) - position) ? index : nearest, 0));
    }}>
      <line x1="52" x2="582" y1={y(0)} y2={y(0)} stroke="currentColor" opacity=".35" strokeDasharray="4 4" />
      <text x="4" y="13">{high.toFixed(1)}%</text><text x="4" y="133">{low.toFixed(1)}%</text>
      <text x="52" y="147">{points[0].session}</text><text x="582" y="147" textAnchor="end">{points.at(-1)!.session}</text>
      <line x1={x(selected)} x2={x(selected)} y1="12" y2="132" stroke="currentColor" opacity=".4" />
      {lines.map((key, index) => <polyline key={key} className={index === 0 ? "compare-first" : "compare-second"} points={points.map((p, i) => `${x(i)},${y(p[key])}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" />)}
    </svg>
    <label>Inspect session <input type="range" min={0} max={points.length - 1} value={selected} aria-valuetext={point.session} onChange={event => setInspection(Number(event.target.value))} /></label>
    <figcaption>{point.session} · {view === "drawdown"
      ? `${result.tickers[0]} ${point.drawdownA.toFixed(2)}% · ${result.tickers[1]} ${point.drawdownB.toFixed(2)}% from their respective closing peaks`
      : `${result.tickers[0]} ${point.a.toFixed(2)}% · ${result.tickers[1]} ${point.b.toFixed(2)}% · Relative ${point.relative.toFixed(2)}%`}
      {view === "drawdown" && <div>Largest drawdowns · {describeWorst(result.tickers[0], drawdownsA)} · {describeWorst(result.tickers[1], drawdownsB)}</div>}
    </figcaption>
  </figure>;
}

export function TerminalCompare({ setupComparison }: { setupComparison?: readonly [string, string, string] }) {
  const [a, setA] = useState(setupComparison?.[0] ?? "AAPL"), [b, setB] = useState(setupComparison?.[1] ?? "^GSPC");
  const [basis, setBasis] = useState("local");
  const [result, setResult] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const clearComparison = () => {
    request.current?.abort();
    request.current = null;
    setLoading(false);
    setResult(null);
    setError("");
  };

  const compare = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setResult(null); setError("");
    try {
      const params = new URLSearchParams({ a, b, basis });
      if (setupComparison && a.trim().toUpperCase() === setupComparison[0] && b.trim().toUpperCase() === setupComparison[1]) params.set("retest", setupComparison[2]);
      const response = await fetch(`/api/terminal-compare?${params}`, { signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error(data?.error ?? "Comparison unavailable.");
      if (!controller.signal.aborted) setResult(data);
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Comparison unavailable.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  const percent = (value: number) => <td className={`mono ${value > 0 ? "positive" : value < 0 ? "negative" : ""}`.trim()}>{value > 0 ? "+" : ""}{value.toFixed(2)}%</td>;
  return <section aria-label="Relative performance comparison">
    <form className="screener-toolbar" onSubmit={event => { event.preventDefault(); void compare(); }}>
      <label>First symbol<input value={a} onChange={event => { setA(event.target.value); clearComparison(); }} maxLength={24} required /></label>
      <label>Second symbol<input value={b} onChange={event => { setB(event.target.value); clearComparison(); }} maxLength={24} required /></label>
      <label>Return currency<select value={basis} onChange={event => { setBasis(event.target.value); clearComparison(); }}><option value="local">Local currencies</option><option>EUR</option><option>USD</option><option>GBP</option></select></label>
      <button type="submit" className="button small primary" disabled={loading}>{loading ? "Comparing…" : "Compare"}</button>
    </form>
    {error && <p className="error-message screener-error" role="alert">{error}</p>}
    {!result && !error && (
      <div className="empty-table">
        {loading
          ? `Comparing ${a.trim().toUpperCase()} vs ${b.trim().toUpperCase()}…`
          : "Select two symbols and press Compare to run normalized return & drawdown analytics."}
      </div>
    )}
    {result && <>
      {result.latestSessions.some(session => session > result.asOf) && (
        <div className="terminal-telemetry-chip">
          <span className="mono">ASYNC CLOSES:</span> {result.tickers[0]} ({result.latestSessions[0]}) · {result.tickers[1]} ({result.latestSessions[1]}) · Synchronized through {result.asOf}
        </div>
      )}
      {result.missingFxSessions > 0 && (
        <div className="terminal-telemetry-chip">
          <span className="mono">FX TELEMETRY:</span> {result.missingFxSessions} session(s) omitted due to missing FX close
        </div>
      )}
      {result.unmatchedInstrumentDates?.some(count => count > 0) && (
        <div className="terminal-telemetry-chip">
          <span className="mono">UNMATCHED DATES:</span> {result.tickers[0]} ({result.unmatchedInstrumentDates[0]}) · {result.tickers[1]} ({result.unmatchedInstrumentDates[1]})
        </div>
      )}
      <ComparisonChart result={result} retest={setupComparison && result.tickers[0] === setupComparison[0] && result.tickers[1] === setupComparison[1] ? setupComparison[2] : undefined} />
      <div className="stock-base-results table-scroll"><table className="data-table" aria-label="Matched session returns">
        <thead><tr><th>Session intervals</th><th>Start date</th><th>{result.tickers[0]} ({result.basis === "local" ? result.currencies[0] : result.basis})</th><th>{result.tickers[1]} ({result.basis === "local" ? result.currencies[1] : result.basis})</th><th>Relative performance</th><th>{result.tickers[0]} max drawdown</th><th>{result.tickers[1]} max drawdown</th>{result.basis !== "local" && <><th>{result.tickers[0]} local</th><th>{result.tickers[1]} local</th></>}</tr></thead>
        <tbody>{[...(result.retestRow ? [{ ...result.retestRow, isRetest: true }] : []), ...result.rows.map(row => ({ ...row, isRetest: false }))].map(row => <tr key={row.isRetest ? "retest" : row.sessions}><td className="mono">{row.isRetest ? `Since retest (${row.sessions})` : row.sessions}</td><td className="mono">{row.start}</td>{percent(row.a)}{percent(row.b)}{percent(row.relative)}{percent(row.maxDrawdownA)}{percent(row.maxDrawdownB)}{result.basis !== "local" && <>{percent(row.localA)}{percent(row.localB)}</>}</tr>)}</tbody>
      </table></div>
    </>}
    <div className="terminal-telemetry-chip">
      <span className="mono">BASIS:</span> Dividend-Adjusted Daily Candles · EOD FX Normalization
    </div>
  </section>;
}
