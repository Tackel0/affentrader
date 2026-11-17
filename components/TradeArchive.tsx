"use client";
import { useEffect, useRef, useState } from "react";
import { useTradeArchiveStore } from "@/stores/useTradeArchiveStore";
import { useChartStore } from "@/stores/useChartStore";
import { useStudyArchiveStore } from "@/stores/useStudyArchiveStore";
import { MAX_STUDY_ARCHIVE_TRADES } from "@/lib/orderflow/studyTradeSource";
import { marketService } from "@/lib/market/service";
import { ARCHIVE_MAX_TRADES, archiveCsv, archiveUtcInput as isoInput, parseArchiveUtcInput as utcTime, tradeArchiveDb } from "@/lib/orderflow/tradeArchive";
import type { TradeArchiveRead, TradeArchiveStats } from "@/types/tradeArchive";
import { Modal } from "./ui";
const date = (time: number | null) => time === null ? "—" : new Date(time).toISOString().replace("T", " ").replace(".000Z", " UTC");
function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime })), anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function TradeArchive() {
  const open = useTradeArchiveStore(state => state.open);
  return open ? <ArchiveDialog/> : null;
}
function ArchiveDialog() {
  const studies = useStudyArchiveStore();
  const state = useTradeArchiveStore(), [stats, setStats] = useState<TradeArchiveStats>(), [symbol, setSymbol] = useState(useChartStore.getState().symbol),
    [from, setFrom] = useState(isoInput(Date.now() - 3_600_000)), [to, setTo] = useState(isoInput(Date.now() + 60_000)), [result, setResult] = useState<TradeArchiveRead>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const generation = useRef(0), abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => { generation.current++; abort.current?.abort(); }, []);
  const inspect = async () => {
    const token = ++generation.current; abort.current?.abort(); setBusy(true); setError("");
    try { const next = await tradeArchiveDb.stats(); if (token === generation.current) { setStats(next); if (!next.symbols.some(item => item.symbol === symbol) && next.symbols[0]) setSymbol(next.symbols[0].symbol); } }
    catch (error) { if (token === generation.current) setError(error instanceof Error ? error.message : "Archive unavailable."); }
    finally { if (token === generation.current) setBusy(false); }
  };
  useEffect(() => { void inspect(); }, []);
  const clearResult = () => { generation.current++; abort.current?.abort(); setBusy(false); setResult(undefined); setError(""); };
  const load = async () => {
    const token = ++generation.current; abort.current?.abort(); const controller = new AbortController(); abort.current = controller; setBusy(true); setError(""); setResult(undefined);
    try { const next = await tradeArchiveDb.read({ symbol, from: utcTime(from), to: utcTime(to) }, ARCHIVE_MAX_TRADES, controller.signal); if (token === generation.current) setResult(next); }
    catch (error) { if (token === generation.current) setError(error instanceof Error ? error.message : "Archive read failed."); }
    finally { if (token === generation.current) setBusy(false); }
  };
  const snapshotName = `classified-trades-${result?.selection.symbol.replace(/[^\w.-]/g, "-") ?? "selection"}`;
  return <Modal title="Local orderflow archive" onClose={() => useTradeArchiveStore.setState({ open: false })} className="trade-archive-modal">
    <div className="form-body">
      <label className="checkbox-row"><input type="checkbox" checked={state.enabled} onChange={event => state.setEnabled(event.target.checked)}/>Record real classified trades on this device</label>
      <p className="form-help">Records observed classified buy/sell executions from Binance, Kraken and Hyperliquid delivered to this tab. Simulation, Yahoo and unclassified IEX data are excluded. At most {ARCHIVE_MAX_TRADES.toLocaleString()} executions are kept for 7 days across all markets; older records expire automatically. Browser storage can be cleared or evicted. Pending data can be lost when closing the tab.</p>
      <p role="status">{state.status.error ? "Recording stopped" : state.status.writing ? "Saving…" : state.enabled ? "Recording observed trades" : "Recording paused"} · {state.status.pending} pending · {state.status.committed.toLocaleString()} new committed in this tab{state.status.retained === null ? "" : ` · ${state.status.retained.toLocaleString()} retained at last save`}{state.status.evicted ? ` · ${state.status.evicted.toLocaleString()} expired/evicted` : ""}</p>
      {state.status.error && <p role="alert" className="negative">{state.status.error}</p>}
      <p className="form-help">Observed records do not prove continuous feed coverage, a complete session or full exchange history. Queries and exports are frozen snapshots. Load a selection explicitly into Footprint, Session Volume Profile and CVD for this market across chart cells. Live executions continue and overlapping IDs count once. Selections last until removed or the page reloads; missing periods remain unknown. On exchange-source charts, Replay uses only these archived observations before the end of the last completed candle. Live buffers are excluded; forming Replay candles show no classified executions. Missing periods remain unknown.</p>
      {studies.loaded.length > 0 && <section aria-label="Loaded study archives"><strong>Loaded study observations</strong>{studies.loaded.map(item => <div key={item.selection.symbol}><p>{item.selection.symbol} · {item.count.toLocaleString()} archived executions · {date(item.first)} → {date(item.last)}</p><button className="button" onClick={() => studies.remove(item.selection.symbol)}>Remove {item.selection.symbol} from studies</button></div>)}<p className="form-help">Removing a selection resets live studies to the current buffer and leaves Replay without recorded quantities. It does not delete recordings. Simulation uses its own source. CVD extrema at equal timestamps use exchange sequence where available, then ID order; this does not establish original network arrival order.</p></section>}
      <div className="archive-summary"><strong>{stats ? `Last inspected: ${stats.count.toLocaleString()} stored executions` : busy ? "Reading archive…" : "Archive unavailable"}</strong><button className="button" disabled={busy} onClick={() => void inspect()}>Refresh archive</button></div>
      {stats && <p className="form-help">Retained observations: {date(stats.first)} → {date(stats.last)}</p>}
      <label>Market<select aria-label="Archived market" value={symbol} onChange={event => { clearResult(); setSymbol(event.target.value); }}><option value={symbol}>{symbol}{stats?.symbols.some(item => item.symbol === symbol) ? "" : " · no stored records"}</option>{stats?.symbols.filter(item => item.symbol !== symbol).map(item => <option key={item.symbol} value={item.symbol}>{item.symbol} · {item.count.toLocaleString()}</option>)}</select></label>
      <button className="button" disabled={busy || !stats?.symbols.some(item => item.symbol === symbol)} onClick={() => { const bounds = stats?.symbols.find(item => item.symbol === symbol); if (bounds) { clearResult(); setFrom(isoInput(bounds.first)); setTo(isoInput(bounds.last + 1)); } }}>Use stored market range</button>
      <div className="archive-range"><label>From (UTC, inclusive)<input aria-label="Archive start UTC" type="datetime-local" step="0.001" value={from} onChange={event => { clearResult(); setFrom(event.target.value); }}/></label><label>To (UTC, exclusive)<input aria-label="Archive end UTC" type="datetime-local" step="0.001" value={to} onChange={event => { clearResult(); setTo(event.target.value); }}/></label></div>
      <button className="button" disabled={busy || !stats?.symbols.length} onClick={() => void load()}>Read recorded interval</button>
      {result && <p className="form-help">Native studies accept at most {MAX_STUDY_ARCHIVE_TRADES.toLocaleString()} archived plus buffered live executions per market. Larger queries remain fully exportable; choose a shorter interval to load them into studies.</p>}
      {error && <p role="alert" className="negative">{error}</p>}
      {result && <section aria-label="Recorded interval results"><strong>{result.selection.symbol} · {result.trades.length.toLocaleString()} executions · observed only</strong><p className="form-help">Snapshot interval: {date(result.selection.from)} → {date(result.selection.to)} (end excluded)</p><dl className="archive-totals"><dt>Buy quantity</dt><dd>{result.buyVolume}</dd><dt>Sell quantity</dt><dd>{result.sellVolume}</dd><dt>Delta</dt><dd>{result.delta}</dd><dt>First observed</dt><dd>{date(result.first)}</dd><dt>Last observed</dt><dd>{date(result.last)}</dd></dl><p className="form-help">Quantities are provider-native units for this one symbol. Preview shows the last 50 executions; exports include all {result.trades.length.toLocaleString()} selected records.</p><div className="archive-table"><table><thead><tr><th>UTC time</th><th>Price</th><th>Quantity</th><th>Aggressor</th></tr></thead><tbody>{result.trades.slice(-50).map(tick => <tr key={tick.id}><td>{date(tick.time)}</td><td>{tick.price}</td><td>{tick.quantity}</td><td>{tick.side}</td></tr>)}</tbody></table></div></section>}
    </div>
    <div className="modal-actions">{result && <><button className="button" disabled={!result.trades.length || result.trades.length > MAX_STUDY_ARCHIVE_TRADES} onClick={() => { try { studies.load(result, marketService.tradesFor(result.selection.symbol)); setError(""); } catch (error) { setError(error instanceof Error ? error.message : "Study archive could not be loaded."); } }}>Load selection into native studies</button><button className="button" onClick={() => download(`${snapshotName}.csv`, archiveCsv(result), "text/csv;charset=utf-8")}>Export trades CSV</button><button className="button" onClick={() => download(`${snapshotName}.json`, JSON.stringify({ version: 2, ...result }, null, 2), "application/json")}>Export trades JSON</button></>}<button className="button primary" onClick={() => useTradeArchiveStore.setState({ open: false })}>Close archive</button></div>
  </Modal>;
}
