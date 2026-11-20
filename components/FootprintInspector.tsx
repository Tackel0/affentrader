"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { captureFootprintInspection, subscribeFootprintSurfaces } from "@/lib/orderflow/footprintReadout";
import {
  footprintInspectionCsv,
  footprintInspectionPage,
  footprintInspectionRowMetrics,
  footprintInspectionSummary,
  type FootprintInspection,
  type FootprintInspectionTarget,
  type FootprintRowFilter,
} from "@/lib/orderflow/footprintInspection";
import { rangeProfileSourceStamp } from "@/lib/orderflow/executionRangeSource";
import { formatOrderflowAmount as volume } from "@/lib/orderflow/formatAmount";
import { downloadFile } from "@/lib/files";
import { useChartStore } from "@/stores/useChartStore";
import { Modal } from "./ui";
const ratioLabel = (value: number | null) => value === null ? "" : !Number.isFinite(value) ? "∞" : `${value.toFixed(1)}×`;
export function FootprintInspector({ target }: { target?: FootprintInspectionTarget }) {
  const [snapshot, setSnapshot] = useState<FootprintInspection | null>(null), [error, setError] = useState("");
  const [filter, setFilter] = useState<FootprintRowFilter>("all"), [minimum, setMinimum] = useState("0"), [ascending, setAscending] = useState(false), [page, setPage] = useState(0);
  const [autoFollow, setAutoFollow] = useState(false);
  const capture = useCallback((silent = false) => {
    if (!target) return;
    try { const next = captureFootprintInspection(target, rangeProfileSourceStamp(target.symbol, target.timeframe));
      if (!next) { if (!silent) setError("The selected Footprint source or candle changed. Inspect the current chart values and capture again."); return; }
      setSnapshot(next); setError(""); if (!silent) setPage(0);
    } catch (failure) { if (!silent) setError(failure instanceof Error ? failure.message : "The Footprint capture is unavailable."); }
  }, [target]);
  const isOpen = snapshot !== null;
  const isReplaySnapshot = snapshot?.replayThrough !== undefined;
  useEffect(() => {
    if (!autoFollow || !isOpen || !target || target.replay || isReplaySnapshot) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; capture(true); }, 120);
    };
    schedule();
    const unsubscribe = subscribeFootprintSurfaces(schedule);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
    };
  }, [autoFollow, isOpen, isReplaySnapshot, target, capture]);
  const minimumValue = Number(minimum), validMinimum = Number.isFinite(minimumValue) && minimumValue >= 0;
  const view = useMemo(() => snapshot && validMinimum ? footprintInspectionPage(snapshot, filter, minimumValue, page, ascending) : null, [snapshot, filter, minimumValue, validMinimum, page, ascending]);
  const rowMetrics = useMemo(() => snapshot ? footprintInspectionRowMetrics(snapshot) : null, [snapshot]);
  const summary = useMemo(() => {
    if (!snapshot) return null;
    const state = useChartStore.getState();
    const candle = state.symbol === snapshot.symbol && state.timeframe === snapshot.timeframe
      ? state.candles.find(c => c.time === snapshot.time)
      : undefined;
    return footprintInspectionSummary(snapshot, candle);
  }, [snapshot]);
  const exportRows = (kind: "csv" | "json") => {
    if (!snapshot) return; const name = `footprint-${snapshot.symbol}-${snapshot.timeframe}-${new Date(snapshot.time).toISOString()}`.replace(/[^a-zA-Z0-9._-]/g, "_");
    downloadFile(`${name}.${kind}`, kind === "csv" ? footprintInspectionCsv(snapshot) : JSON.stringify(snapshot, null, 2), kind === "csv" ? "text/csv;charset=utf-8" : "application/json");
  };
  return <>
    {target && <button className="button" type="button" onClick={() => capture(false)}>Inspect footprint rows…</button>}
    {!snapshot && error && <p className="form-error" role="alert">{error}</p>}
    {snapshot && createPortal(<Modal title="Footprint row inspection" className="footprint-inspector" onClose={() => { setSnapshot(null); setAutoFollow(false); setError(""); }}>
      <div className="form-body">
        <p><strong>{snapshot.symbol} · {snapshot.timeframe}</strong> · {snapshot.simulated ? "SIMULATED · " : ""}{snapshot.replayThrough !== undefined ? "REPLAY · " : ""}{new Date(snapshot.time).toISOString()}</p>
        <p className="form-help">{autoFollow && !target?.replay ? "Live-following selected candle updates." : `Frozen at ${new Date(snapshot.capturedAt).toISOString()}. Capture the current candle again to refresh.`} {snapshot.coverage}</p>
        {snapshot.replayThrough !== undefined && <p className="form-help">Recorded executions strictly before {new Date(snapshot.replayThrough).toISOString()}.</p>}
        <p className="form-help">Rows {snapshot.settings.step} · diagonal ratio {snapshot.settings.ratio}:1 · minimum imbalance volume {volume(snapshot.settings.minimumVolume)} · {snapshot.settings.ignoreZeroOpposite ? "zero/missing opposite excluded" : "zero/missing opposite eligible"} · stacks require {snapshot.settings.minimumStackRows} adjacent rows.</p>
        <p className="form-help">Buy imbalance compares this row's Ask with Bid one row below; sell imbalance compares Bid with Ask one row above. Gaps and chart-filtered rows break stacks. Table filters below select which captured rows to browse.</p>
        {snapshot.rows.some(row => row.displayFiltered !== undefined) && <p className="form-help">{snapshot.rows.filter(row => row.displayFiltered).length} rows were blanked by chart display filters. Raw quantities and price slots remain in this capture and its exports; the stat table and projected references use unfiltered data.</p>}
        <p>Collected volume {volume(snapshot.volume)} · delta {volume(snapshot.delta)}{summary?.deltaPercent != null ? ` (${summary.deltaPercent.toFixed(1)}%)` : ""} · {snapshot.rows.length} price rows · {summary ? `${summary.buyImbalances}B / ${summary.sellImbalances}S imb · ` : ""}{snapshot.stacks.length} stacks</p>
        {summary && (summary.signals.length > 0 || summary.unfinishedHigh !== null || summary.unfinishedLow !== null || summary.trapped.summary) && (
          <p className="form-help">
            {[
              summary.signals.length ? `Signals: ${summary.signals.map(s => `${s.label} @ ${volume(s.price)} (${Math.round(s.strength * 100)}%)`).join(", ")}` : null,
              summary.unfinishedHigh !== null ? `Unfinished high: ${volume(summary.unfinishedHigh)}` : null,
              summary.unfinishedLow !== null ? `Unfinished low: ${volume(summary.unfinishedLow)}` : null,
              summary.trapped.summary,
            ].filter(Boolean).join(" · ")}
          </p>
        )}
        {snapshot.valueArea && <p className="form-help">Value area {snapshot.valueArea.percent}%: [{snapshot.valueArea.low}, {snapshot.valueArea.high}) · POC midpoint {snapshot.valueArea.pocMid}. Basis: {snapshot.valueArea.basis === "volume" ? "classified volume" : "known average trade sizes"}.</p>}
        {snapshot.pocReference && <p className="form-help">Projected POC midpoint {snapshot.pocReference.price} (unfiltered source rows). First observed revisit: {snapshot.pocReference.touched === null ? "none in revealed candles" : new Date(snapshot.pocReference.touched).toISOString()}. Later inclusive candle ranges determine contact; missing history remains unknown.</p>}
        {snapshot.stackedZones?.map(zone=><p className="form-help" key={`${zone.side}:${zone.lower}`}>Projected {zone.side} stack [{zone.lower}, {zone.upper}]: {zone.rows} rows. First observed range overlap: {zone.touched===null?"none in revealed candles":new Date(zone.touched).toISOString()}. Missing history remains unknown.</p>)}
        {snapshot.deltaPath ? <>
          <p>Observed delta maximum {volume(snapshot.deltaPath.high)} · minimum {volume(snapshot.deltaPath.low)} · ordered close {volume(snapshot.deltaPath.close)} · {snapshot.deltaPath.executions} executions</p>
          <p className="form-help">Delta starts at zero at the first observed execution of this candle, {new Date(snapshot.deltaPath.first).toISOString()}, through {new Date(snapshot.deltaPath.last).toISOString()}. Ordered by exchange timestamp, then sequence where available, then ID; this is not original network arrival order. Missing executions can change both extremes. Row totals and ordered close can differ by floating-point rounding.</p>
        </> : <p className="form-help">Execution-path extrema are unavailable for these legacy rows; final row delta cannot reconstruct them.</p>}
        <div className="footprint-inspector-controls">
          <label>Rows<select aria-label="Footprint row filter" value={filter} onChange={e => { setFilter(e.target.value as FootprintRowFilter); setPage(0); }}>
            <option value="all">All observed rows</option><option value="buy">Buy imbalance</option><option value="sell">Sell imbalance</option><option value="stacked">Stacked imbalance</option><option value="poc">POC</option>
          </select></label>
          <label>Minimum row volume<input aria-label="Minimum footprint row volume" type="number" min="0" step="any" value={minimum} onChange={e => { setMinimum(e.target.value); setPage(0); }}/></label>
          <label className="inline-check"><input type="checkbox" checked={ascending} onChange={e => { setAscending(e.target.checked); setPage(0); }}/>Ascending price</label>
          {target && !target.replay && snapshot.replayThrough === undefined && (
            <label className="inline-check"><input type="checkbox" checked={autoFollow} onChange={e => setAutoFollow(e.target.checked)}/>Auto-follow live</label>
          )}
        </div>
        {error && <p role="alert" className="form-error">{error}</p>}
        {!validMinimum && <p role="alert" className="form-error">Choose a finite, nonnegative minimum row volume.</p>}
        {view && <>
          <p className="form-help">{view.total} matching rows · page {view.page + 1} of {view.pages} · 50 rows per page</p>
          <div className="footprint-inspector-table"><table aria-label="Captured footprint price rows"><thead><tr><th>Price [lower, upper)</th><th>Bid (sells)</th><th>Ask (buys)</th><th>Total</th><th>Delta</th><th>Diag ratio</th><th>Conditions</th></tr></thead>
            <tbody>{view.rows.map(row => {
              const metrics = rowMetrics?.get(row.lower);
              const diag = [
                row.buyImbalance && metrics?.buyRatio !== null && metrics?.buyRatio !== undefined ? `↑ ${ratioLabel(metrics.buyRatio)}` : null,
                row.sellImbalance && metrics?.sellRatio !== null && metrics?.sellRatio !== undefined ? `↓ ${ratioLabel(metrics.sellRatio)}` : null,
              ].filter(Boolean).join(" / ") || (metrics ? [metrics.buyRatio !== null && metrics.buyRatio >= 1.5 ? `${ratioLabel(metrics.buyRatio)} B` : null, metrics.sellRatio !== null && metrics.sellRatio >= 1.5 ? `${ratioLabel(metrics.sellRatio)} S` : null].filter(Boolean).join(" / ") : "") || "—";
              return <tr key={row.lower} className={row.poc ? "footprint-poc" : ""}><td>[{String(row.lower)}, {String(row.upper)})</td><td>{volume(row.bid)}</td><td>{volume(row.ask)}</td><td>{volume(row.total)}</td><td className={row.delta < 0 ? "negative" : row.delta > 0 ? "positive" : ""}>{volume(row.delta)}</td><td>{diag}</td>
                <td>{[row.displayFiltered && "Filtered on chart", row.poc && "POC", row.inValueArea && "Value area", row.buyImbalance && "Buy imbalance", row.sellImbalance && "Sell imbalance", row.buyStack && "Buy stack", row.sellStack && "Sell stack"].filter(Boolean).join(" · ") || "—"}</td></tr>;
            })}</tbody></table></div>
          {!view.total && <p className="form-help">No captured rows match the selected filter.</p>}
          <div className="footprint-inspector-actions"><button className="button" type="button" disabled={!view.page} onClick={() => setPage(view.page - 1)}>Previous rows</button><button className="button" type="button" disabled={view.page + 1 >= view.pages} onClick={() => setPage(view.page + 1)}>Next rows</button></div>
        </>}
        <p className="form-help">Exports include all {snapshot.rows.length} captured rows and calculation/source metadata, independently of table filters.</p>
        <div className="footprint-inspector-actions"><button className="button" type="button" disabled={!target} onClick={() => capture(false)}>Capture current candle</button><button className="button" type="button" onClick={() => exportRows("csv")}>Export footprint CSV</button><button className="button" type="button" onClick={() => exportRows("json")}>Export footprint JSON</button></div>
      </div>
    </Modal>, document.body)}
  </>;
}
