"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { mergeStockBasePages, stockBaseLevelDistance as distance, STOCK_BASE_MARKETS, STOCK_BASE_PAGE_SIZE, type StockBaseScan, type StockBaseRow } from "@/lib/screener/stockBase";
import { displayTicker, isYahooTicker } from "@/lib/symbolId";
import { exchangeOfTicker } from "@/lib/markets";
import { formatPrice } from "@/lib/symbols";
import { useChartStore } from "@/stores/useChartStore";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { StockBaseChart } from "./StockBaseChart";
import { pendingRetestsCsv, stockBaseCsv } from "@/lib/screener/stockBaseCsv";
import { downloadFile } from "@/lib/files";

const stages = { forming: "Base forming", reclaimed: "Testing resistance", breakout: "Confirmed breakout" };
const statuses = { active: "Active", "support-lost": "Support lost", "breakout-failed": "Breakout failed", "out-of-screen": "No longer qualifies" };
const pct = (n: number) => `${n.toFixed(1)}%`;
const signedPct = (n: number) => `${n > 0 ? "+" : ""}${pct(n)}`;
const scoreLabels = { base: "Qualifying base", stage: "Structure stage", relativeStrength: "Relative strength", contraction: "Range contraction", latestVolume: "Latest volume", higherRetest: "Higher retest low", participation: "Recovery volume" } as const;
export function StockBaseScanner({ onCompare }: { onCompare?: (ticker: string, benchmark: string, retest: string) => void } = {}) {
  const [market, setMarket] = useState<string>("us"), [result, setResult] = useState<StockBaseScan | null>(null);
  const [selected, setSelected] = useState<StockBaseRow | null>(null);
  const [pendingSymbol, setPendingSymbol] = useState<string | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const [nearResistance, setNearResistance] = useState(false);
  const [stage, setStage] = useState<"all" | StockBaseRow["stage"]>("all");
  const [higherLow, setHigherLow] = useState(false);
  const [sort, setSort] = useState("score");
  const [scope, setScope] = useState("curated");
  const watchlist = useWatchlistStore(s => s.lists.find(list => list.id === s.activeId));
  const watchSymbols = watchlist?.symbols;
  const watchTickers = useMemo(() => [...new Set((watchSymbols ?? []).flatMap(symbol => {
    if (!symbol.startsWith("YF:")) return [];
    const ticker = symbol.slice(3);
    return isYahooTicker(ticker) && exchangeOfTicker(ticker).id === market ? [ticker] : [];
  }))], [watchSymbols, market]);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [scanContext, setScanContext] = useState<{ key: string; label: string } | null>(null);
  const scanKey = JSON.stringify([market, scope, scope === "watchlist" ? watchlist?.id : null, scope === "watchlist" ? watchTickers : []]);
  const canResume = !!result && retryKey === scanKey && result.page + 1 < result.pages;
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const scan = async (resume = false) => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    let combined = resume && canResume ? result : null;
    if (!combined) {
      setResult(null); setSelected(null); setPendingSymbol(null);
      setScanContext({ key: scanKey, label: scope === "watchlist" ? watchlist?.name ?? "Watchlist" : "Curated stocks" });
    }
    setRetryKey(null); setError(""); setStopped(false); setLoading(true);
    try {
      const custom = scope === "watchlist";
      const watchPages = Math.ceil(watchTickers.length / STOCK_BASE_PAGE_SIZE);
      for (let page = combined ? combined.page + 1 : 0; !combined || page < combined.pages; page++) {
        const start = page * STOCK_BASE_PAGE_SIZE;
        const response = await (custom ? fetch("/api/stock-base", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ market, tickers: watchTickers.slice(start, start + STOCK_BASE_PAGE_SIZE) }),
        }) : fetch(`/api/stock-base?${new URLSearchParams({ market, page: String(page) })}`, { signal: controller.signal })).catch(cause => {
          if (!controller.signal.aborted && combined) setRetryKey(scanKey);
          throw cause;
        });
        if (controller.signal.aborted) return;
        if (combined && (response.status === 429 || response.status >= 500)) setRetryKey(scanKey);
        const data = await response.json() as StockBaseScan & { error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(data.error ?? "Stock scan unavailable.");
        if (custom) Object.assign(data, { page, pages: watchPages, universe: watchTickers.length });
        combined = mergeStockBasePages(combined, data);
        setResult(combined);
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Stock scan unavailable.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  const stopScan = () => {
    request.current?.abort();
    setLoading(false);
    setStopped(true);
    setRetryKey(result && scanContext && result.page + 1 < result.pages ? scanContext.key : null);
  };
  const rows = result?.rows;
  const ranked = useMemo(() => (rows ?? []).map(row => ({ row, toResistance: distance(row.resistance, row.progress.latestClose) })), [rows]);
  const candidates = useMemo(() => {
    const matching = ranked.filter(({ row, toResistance }) => {
      if (!showRecent && row.progress.status !== "active") return false;
      if (stage !== "all" && row.stage !== stage) return false;
      if (higherLow && row.retest.price <= row.firstLow.price) return false;
      return !nearResistance || (toResistance >= 0 && toResistance <= 2);
    });
    if (sort === "strength") matching.sort((a, b) => b.row.relativeStrength - a.row.relativeStrength || b.row.score - a.row.score);
    if (sort === "retest-strength") matching.sort((a, b) => b.row.retestRelativeStrength - a.row.retestRelativeStrength || b.row.score - a.row.score);
    if (sort === "resistance") matching.sort((a, b) => Math.abs(a.toResistance) - Math.abs(b.toResistance) || b.row.score - a.row.score);
    return matching.map(({ row }) => row);
  }, [ranked, showRecent, stage, higherLow, nearResistance, sort]);
  const activeCount = useMemo(() => rows?.filter(row => row.progress.status === "active").length ?? 0, [rows]);
  const pendingPreview = result?.pendingRetests?.find(row => row.symbol === pendingSymbol);
  const benchmark = STOCK_BASE_MARKETS.find(item => item.id === result?.market)?.benchmark;
  const watchedSymbols = useMemo(() => new Set(watchSymbols), [watchSymbols]);
  const visibleUnwatched = useMemo(() => candidates.filter(row => !watchedSymbols.has(row.symbol)), [candidates, watchedSymbols]);
  const watchButton = (symbol: string) => {
    if (!watchlist) return null;
    const watched = watchedSymbols.has(symbol);
    return <button type="button" className="button small" disabled={watched} onClick={() => {
      const store = useWatchlistStore.getState();
      const added = store.addSymbols([symbol], watchlist.id);
      if (!added && !store.lists.find(list => list.id === watchlist.id)?.symbols.includes(symbol))
        useChartStore.getState().toast("Could not add symbol", "The selected watchlist is full or no longer available.", "error");
    }}>{watched ? `In ${watchlist.name}` : `Add to ${watchlist.name}`}</button>;
  };
  return <div className="screener-view stock-base-scanner">
    <div className="screener-toolbar">
      <label>Stock market<select value={market} onChange={event => { request.current?.abort(); setMarket(event.target.value); setResult(null); setSelected(null); setLoading(false); setStopped(false); setError(""); }}>
        {STOCK_BASE_MARKETS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select></label>
      <label>Universe<select value={scope} disabled={loading} onChange={e => { setScope(e.target.value); setResult(null); setSelected(null); setStopped(false); setError(""); }}><option value="curated">Curated stocks</option><option value="watchlist">Active watchlist</option></select></label>
      <button type="button" className="button small primary" onClick={() => void scan()} disabled={loading || scope === "watchlist" && !watchTickers.length}>{loading ? "Scanning…" : "Scan stock bases"}</button>
      {canResume && <button type="button" className="button small" disabled={loading} onClick={() => void scan(true)}>Resume incomplete scan</button>}
      {loading && <button type="button" className="button small" onClick={stopScan}>Stop scan</button>}
      <span className="screener-count">Yahoo Finance · completed daily sessions</span>
    </div>
    <div className="terminal-telemetry-chip" role="status">
      <span className="mono">SCANNER:</span> Base Formation &amp; Index Outperformance · {scope === "watchlist" ? `${watchlist?.name ?? "Watchlist"} (${watchTickers.length} symbols)` : `Curated (${STOCK_BASE_PAGE_SIZE}/group)`}
    </div>
    {loading && <p className="form-help" role="status">Checking price structure, volume and benchmark alignment…</p>}
    {stopped && <p className="form-help" role="status">{result ? "Scan stopped. Completed groups are shown below." : "Scan stopped before the first group completed."}</p>}
    {error && <p className="error-message screener-error" role="alert">{error}</p>}
    {(loading || result) && scanContext && <p className="form-help">Scan universe: {scanContext.label}{scanContext.key !== scanKey ? " · The active selection has changed. Start a new scan to use it." : ""}</p>}
    {result && <>
      {!!result.pendingRetests?.length && <details className="form-help">
        <summary>{result.pendingRetests.length} retests to monitor</summary>
        <button type="button" className="button small" disabled={loading}
          onClick={() => downloadFile(`pending-retests-${result.market}-${result.benchmarkSession}.csv`, pendingRetestsCsv(result), "text/csv;charset=utf-8")}>Export retests CSV</button>
        <div className="terminal-telemetry-chip">
          <span className="mono">STATUS:</span> Awaiting pivot confirmation, rebound threshold or index outperformance
        </div>
        <div className="stock-base-results table-scroll"><table className="data-table" aria-label="Retests to monitor">
          <thead><tr><th>Stock</th><th>First low date</th><th>Retest date</th><th>Retest low</th><th>Latest close</th><th>Resistance</th><th>Recovery close</th><th>To recovery level</th><th>Invalid below</th><th>vs. index (≥ 0.5%)</th><th>Since retest vs. index (&gt; 0%)</th><th>Still needed</th></tr></thead>
          <tbody>{result.pendingRetests.map(row => <tr key={row.symbol} className={pendingSymbol === row.symbol ? "selected-row" : undefined}>
            <td><button type="button" className="button small mono" aria-pressed={pendingSymbol === row.symbol} onClick={() => setPendingSymbol(pendingSymbol === row.symbol ? null : row.symbol)}>{displayTicker(row.symbol)}</button></td>
            <td className="mono">{row.firstLow}</td><td className="mono">{row.retest}</td><td className="mono">{formatPrice(row.price)} {row.currency}</td><td className="mono">{formatPrice(row.latestClose)}</td><td className="mono">{formatPrice(row.resistance)}</td>
            <td className="mono" title={String(row.recoveryLevel)}>{row.recoveryStrict ? ">" : "≥"} {formatPrice(row.recoveryLevel)}</td>
            <td className="mono">{row.latestClose > row.recoveryLevel || !row.recoveryStrict && row.latestClose === row.recoveryLevel ? "Met" : row.latestClose === row.recoveryLevel ? "Needs a higher close" : signedPct(distance(row.recoveryLevel, row.latestClose))}</td>
            <td className="mono" title={String(row.invalidation)}>{formatPrice(row.invalidation)}</td>
            <td className="mono">{row.strength ? signedPct(row.strength.window) : "—"}</td>
            <td className="mono">{row.strength ? signedPct(row.strength.sinceRetest) : "—"}</td>
            <td>{row.waitingFor === "recovery" ? "Stronger rebound" : row.waitingFor === "relative-strength" ? "Index outperformance" : `${row.sessionsNeeded} pivot confirmation session(s)`}</td>
          </tr>)}</tbody>
        </table></div>
        {pendingPreview && <div>
          <StockBaseChart row={{ ...pendingPreview, firstLow: { session: pendingPreview.firstLow }, retest: { session: pendingPreview.retest } }} />
          <div className="screener-toolbar">
            <button type="button" className="button small" onClick={() => useChartStore.getState().set({ symbol: pendingPreview.symbol, timeframe: "1D" })}>Open {displayTicker(pendingPreview.symbol)} daily chart</button>
            {watchButton(pendingPreview.symbol)}
            {onCompare && benchmark && <button type="button" className="button small"
              onClick={() => onCompare(pendingPreview.symbol.slice(3), benchmark, pendingPreview.retest)}>Compare with benchmark</button>}
          </div>
        </div>}
      </details>}
      <div className="screener-toolbar">
        <label><input type="checkbox" checked={showRecent} onChange={e => { setShowRecent(e.target.checked); setSelected(null); }}/> Include recent inactive setups</label>
        <label><input type="checkbox" checked={nearResistance} onChange={e => { setNearResistance(e.target.checked); setSelected(null); }}/> At or within 2% below resistance</label>
        <label><input type="checkbox" checked={higherLow} onChange={e => { setHigherLow(e.target.checked); setSelected(null); }}/> Higher retest low</label>
        <label>Structure stage<select value={stage} onChange={e => { setStage(e.target.value as typeof stage); setSelected(null); }}><option value="all">All stages</option>{Object.entries(stages).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label>Rank by<select value={sort} onChange={e => setSort(e.target.value)}><option value="score">Setup score</option><option value="strength">Relative strength</option><option value="retest-strength">Relative strength since retest</option><option value="resistance">Closest to resistance</option></select></label>
        <button className="button small" type="button" disabled={loading || !candidates.length} onClick={() => downloadFile(`stock-bases-${result.market}-${result.benchmarkSession}.csv`, stockBaseCsv(result, candidates), "text/csv;charset=utf-8")}>Export visible setups</button>
        {watchlist && <button className="button small" type="button" disabled={loading || !visibleUnwatched.length} onClick={() => {
          const added = useWatchlistStore.getState().addSymbols(visibleUnwatched.map(row => row.symbol), watchlist.id);
          const skipped = visibleUnwatched.length - added;
          useChartStore.getState().toast(
            added ? `Added ${added} to ${watchlist.name}` : "No symbols added",
            skipped ? `${skipped} could not be added. The watchlist is full or no longer available.` : "The visible symbols are now on your watchlist.",
            added ? "success" : "error",
          );
        }}>Add {visibleUnwatched.length} visible to {watchlist.name}</button>}
        <span className="screener-count" role="status">Groups {result.page + 1}/{result.pages} · {result.benchmark} through {result.benchmarkSession} · {result.evaluated}/{result.universe} evaluated · {candidates.length} shown · {activeCount} active · {result.rows.length - activeCount} recently inactive{result.excluded ? ` · ${result.excluded} non-stocks excluded` : ""}</span>
      </div>
      {result.unavailable.length > 0 && <details className="form-help"><summary>{result.unavailable.length} unavailable</summary><ul>{result.unavailable.map(row => <li key={row.symbol}>{displayTicker(row.symbol)} · {row.reason}</li>)}</ul></details>}
      {!loading && !candidates.length && <p className="form-help">{result.evaluated ? "No setups match this view." : "No stock could be evaluated."}</p>}
      {!!candidates.length && <div className="stock-base-results table-scroll"><table className="data-table" aria-label="Stock base candidates">
        <thead><tr><th>Stock</th><th>Structure</th><th>Status</th><th>Score</th><th>Latest close</th><th>To resistance</th><th>To invalidation</th><th>vs {result.benchmark}</th><th>vs {result.benchmark} since retest</th><th>Last qualified</th></tr></thead>
        <tbody>{candidates.map(row => <tr key={row.symbol} className={selected?.symbol === row.symbol ? "selected-row" : undefined}>
          <td><button type="button" className="button small mono" aria-pressed={selected?.symbol === row.symbol} onClick={() => setSelected(row)} title={row.name}>{displayTicker(row.symbol)}</button></td><td>{stages[row.stage]}</td><td>{statuses[row.progress.status]}</td><td className="mono">{row.score}</td><td className="mono">{formatPrice(row.progress.latestClose)} {row.currency}</td>
          <td className="mono">{formatPrice(row.resistance)} ({signedPct(distance(row.resistance, row.progress.latestClose))})</td>
          <td className="mono">{formatPrice(row.invalidation)} ({signedPct(distance(row.invalidation, row.progress.latestClose))})</td>
          <td className="mono positive">+{pct(row.relativeStrength)}</td><td className="mono positive">{signedPct(row.retestRelativeStrength)}</td><td className="mono">{row.session}</td>
        </tr>)}</tbody>
      </table></div>}
    </>}
    {selected && <section className="stock-base-evidence" aria-label="Selected setup evidence">
      <StockBaseChart row={selected} />
      <div className="screener-toolbar"><strong>{displayTicker(selected.symbol)} · {selected.name} · {stages[selected.stage]}</strong><button type="button" className="button small" onClick={() => useChartStore.getState().set({ symbol: selected.symbol, timeframe: "1D" })}>Open daily chart</button>
        {watchButton(selected.symbol)}
        {onCompare && benchmark && <button type="button" className="button small"
          onClick={() => onCompare(selected.symbol.slice(3), benchmark, selected.retest.session)}>Compare with benchmark</button>}
      </div>
      <dl>
        <div><dt>Setup status</dt><dd>{statuses[selected.progress.status]} · {selected.progress.statusSince}</dd></div>
        {selected.progress.status === "support-lost" && selected.progress.breakoutFailedOn && <div>
          <dt>Breakout failed</dt><dd>{selected.progress.breakoutFailedOn}</dd>
        </div>}
        <div><dt>First seen in last 12 sessions</dt><dd>{selected.progress.firstSeen}</dd></div>
        <div><dt>Latest completed close</dt><dd>{formatPrice(selected.progress.latestClose)} {selected.currency} · {selected.progress.latestSession}</dd></div>
        {selected.session !== selected.progress.latestSession && <div>
          <dt>Last qualifying close</dt>
          <dd>{formatPrice(selected.close)} {selected.currency} · {selected.session}</dd>
        </div>}
        <div><dt>Prior drawdown</dt><dd>{pct(selected.drawdown)}</dd></div>
        {selected.drawdownPeak && <div>
          <dt>Prior peak</dt><dd>{formatPrice(selected.drawdownPeak.price)} {selected.currency} · {selected.drawdownPeak.session}</dd>
        </div>}
        <div><dt>First low</dt><dd>{formatPrice(selected.firstLow.price)} · {selected.firstLow.session}</dd></div>
        <div><dt>Retest low</dt><dd>{formatPrice(selected.retest.price)} · {selected.retest.session}</dd></div>
        <div><dt>Resistance / invalidation</dt><dd>{formatPrice(selected.resistance)} / {formatPrice(selected.invalidation)}</dd></div>
        <div><dt>Relative strength</dt><dd>+{pct(selected.relativeStrength)} over {selected.relativeSessions} matched sessions</dd></div>
        <div><dt>Since retest through last qualifying close</dt><dd>{signedPct(selected.retestReturn)} stock · {signedPct(selected.retestRelativeStrength)} vs benchmark</dd></div>
        {selected.session !== selected.progress.latestSession && selected.progress.latestRetestRelativeStrength !== undefined && <div>
          <dt>Since retest through latest close</dt><dd>{signedPct(selected.progress.latestRetestRelativeStrength)} vs benchmark</dd>
        </div>}
        <div><dt>Retest range / selloff range</dt><dd>{selected.contraction.toFixed(2)}×</dd></div>
        <div><dt>Qualifying session volume / prior 20-day mean</dt><dd>{selected.volumeRatio.toFixed(2)}×</dd></div>
        {selected.breakoutEvidence && <div><dt>Breakout evidence</dt><dd>First clearance {selected.breakoutEvidence.session} · Confirmed {selected.breakoutEvidence.confirmedOn} by {selected.breakoutEvidence.confirmation === "volume" ? "volume" : "two consecutive closes"} · {selected.breakoutEvidence.volumeRatio > 0 ? selected.breakoutEvidence.volumeRatio.toFixed(2) + "× breakout-day volume · " : ""}{selected.breakoutEvidence.consecutiveCloses} qualifying close(s)</dd></div>}
        <div><dt>Mean volume on up vs. down days since retest</dt><dd>{selected.recoveryVolume.ratio === null ? "Needs 2 days in each direction" : `${selected.recoveryVolume.ratio.toFixed(2)}×`} · {selected.recoveryVolume.upSessions} up / {selected.recoveryVolume.downSessions} down</dd></div>
        <div><dt>RSI at first low</dt><dd>{selected.rsiAtLow?.toFixed(1) ?? "—"}</dd></div>
      </dl>
      <ol aria-label="Setup milestones" className="form-help">{selected.progress.milestones.map(item => <li key={item.session}>{item.session} · {stages[item.stage]} · score {item.score}</li>)}</ol>
      <p className="form-help">Observed performance after the first match in this scan window ({selected.progress.firstSeen}). Changes use its closing price and breaches use its invalidation level of {formatPrice(selected.progress.firstInvalidation)}.</p>
      {selected.followThrough.length ? <div className="stock-base-results table-scroll"><table className="data-table" aria-label="Performance after first setup observation">
        <thead><tr><th>Sessions later</th><th>Through</th><th>Stock</th><th>Benchmark</th><th>Relative</th><th>Lowest move</th><th>Highest move</th><th>First breach</th></tr></thead>
        <tbody>{selected.followThrough.map(item => <tr key={item.sessions}><td className="mono">{item.sessions}</td><td className="mono">{item.through}</td><td className="mono">{signedPct(item.stockChange)}</td><td className="mono">{signedPct(item.benchmarkChange)}</td><td className="mono">{signedPct(item.relativeChange)}</td><td className="mono">{signedPct(item.lowChange)}</td><td className="mono">{signedPct(item.highChange)}</td><td className="mono">{item.invalidatedOn ?? "—"}</td></tr>)}</tbody>
      </table></div> : <p className="form-help">No later completed session is available yet.</p>}
      <details><summary>Setup score breakdown · {selected.score}/100</summary>
        <dl>{Object.entries(selected.scoreComponents).map(([key, points]) => <div key={key}><dt>{scoreLabels[key as keyof typeof scoreLabels]}</dt><dd>{points > 0 ? "+" : ""}{points.toFixed(1)}</dd></div>)}</dl>
        <p className="form-help">The total is rounded after adding all contributions. The score ranks structural evidence and has no probability interpretation.</p>
      </details>
      <p className="form-help">Distances show the percentage move from the latest completed close to each level. Levels use dividend-adjusted prices.</p>
    </section>}
  </div>;
}
