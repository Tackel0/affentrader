"use client";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, CircleHelp, SlidersHorizontal } from "lucide-react";
import { Modal } from "./ui";
import { useChartStore } from "@/stores/useChartStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { bookLastTrade, captureTimeSales, combineTapeRows, countNewRetainedTrades, filterTimeSales, timeSalesCsv, timeSalesHighlight, timeSalesMinuteBalance, timeSalesPage, timeSalesTotals, validTapeFilters } from "@/lib/orderflow/timeSales";
import { depthBookStatus, depthTimestampStatus } from "@/lib/orderflow/depthLadder";
import { describeSymbol, getSymbol } from "@/lib/symbols";
import { downloadFile } from "@/lib/files";
import type { FeedMode, OrderBook, Tick, TimeSalesFilters, TimeSalesSnapshot } from "@/types/trading";
import { studyTradeSource } from "@/lib/orderflow/studyTradeSource";
import { recordedTapeSource } from "@/lib/orderflow/recordedTapeSource";
import { useChartReadout } from "@/hooks/useChartReadout";
import { getPrimaryChart } from "@/hooks/useVelaChart";
import { completedReplayBoundary } from "@/lib/chart/replayClock";
import { clusterTimeSales, timeSalesClustersCsv } from "@/lib/orderflow/timeSalesClusters";
import { TapeClusterTable } from "./TapeClusterTable";
import { replayDepth, REPLAY_DEPTH_RETENTION_MS } from "@/lib/orderflow/replayDepth";
import { depthMetrics } from "@/lib/orderflow/depthMetrics";
import { depthSnapshotCsv } from "@/lib/orderflow/depthSnapshotCsv";
import { domStyle } from "@/lib/orderflow/domStyle";
import { BookView } from "./BookView";
import { defaultBookView } from "@/lib/orderflow/bookView";
import { useKrakenBook } from "@/hooks/useKrakenBook";
import { useBinanceBook } from "@/hooks/useBinanceBook";
import { combinedBookCsv, combineVenueBooks } from "@/lib/orderflow/combinedBook";
import { useDomPriceGrid } from "@/hooks/useDomPriceGrid";
import { priceGridTick } from "@/lib/market/priceGridMetadata";
import { PriceLevelMenu } from "./PriceLevelMenu";
import { intervalMs } from "@/lib/market/intervals";
import { defaultTapePreferences, readTapePreferences, tapeHighlightMultipliers } from "@/lib/orderflow/tapePreferences";
import { formatOrderflowAmount as number } from "@/lib/orderflow/formatAmount";
const LIVE_TAPE_REFRESH_MS = 100;
const emptyRevision = () => 0;
const subscribeNothing = () => () => {};

export function OrderFlowPanel() {
  const [pane, setPane] = useState<"tape" | "book">("tape");
  const switchRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const element = switchRef.current;
    if (!element) return;
    // The container query shows the switch only when one view fits.
    const measure = () => setCompact(element.getBoundingClientRect().width > 0);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const tapeVisible = !compact || pane === "tape";
  const bookVisible = !compact || pane === "book";
  const [tapeDialog, setTapeDialog] = useState<"settings" | "details" | null>(null);
  const [preferences, setPreferences] = useState(defaultTapePreferences);
  const { tapeView, milliseconds, combine, pauseOnHover, sizeDisplay, highlightAt, highlightMode, highlightMultiplier, side, unit, minimum, maximumValue } = preferences;
  useEffect(() => {
    try {
      const saved = localStorage.getItem("affentrader-tape-view-v1");
      if (saved) setPreferences(readTapePreferences(JSON.parse(saved)));
    } catch { /* Defaults remain usable when storage is unavailable. */ }
  }, []);
  const updatePreferences = (patch: Partial<typeof defaultTapePreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    savePreferences(next);
  };
  const savePreferences = (next: typeof defaultTapePreferences) => {
    try { localStorage.setItem("affentrader-tape-view-v1", JSON.stringify(readTapePreferences(next))); } catch { /* Keep the change in this view. */ }
  };
  const updateFilters = (patch: Partial<Pick<typeof defaultTapePreferences, "side" | "unit" | "minimum" | "maximumValue">>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    savePreferences(next);
    setPage(0);
  };
  const [hoveredTape, setHoveredTape] = useState<{ key: string; value: TimeSalesSnapshot } | null>(null);
  useEffect(() => { if (!tapeVisible) setHoveredTape(null); }, [tapeVisible]);
  const clusterInterval = tapeView === "second" ? 1000 : tapeView === "minute" ? 60000 : null;
  const symbol = useChartStore(s => s.symbol),
    type = useChartStore(s => s.chartType), mode = useChartStore(s => s.feedMode), epoch = useChartStore(s => s.feedEpoch);
  const source = useChartStore(s => s.dataSources[`${s.symbol}:${s.timeframe}`]);
  const timeframe = useChartStore(s => s.timeframe), marketEpoch = useChartStore(s => s.marketEpochs[s.symbol] ?? 0);
  const replay = useWorkspaceStore(s => s.replay.active);
  const activeCell = useWorkspaceStore(s => s.activeId);
  const tapeZoom = useWorkspaceStore(s => s.domPreferences.zoom);
  const tapeColors = useWorkspaceStore(s => s.domPreferences.colors);
  const tapeStyle = useMemo(() => domStyle(tapeZoom ?? 100, tapeColors), [tapeZoom, tapeColors]);
  const readout = useChartReadout(replay);
  const archiveRevision = useSyncExternalStore(useCallback((changed: () => void) => studyTradeSource.subscribe(symbol, changed), [symbol]), () => studyTradeSource.revision(symbol), () => 0);
  const [page, setPage] = useState(0), [frozen, setFrozen] = useState<{ key: string; value: TimeSalesSnapshot } | null>(null);
  const simulated = mode === "simulation" || source === "simulation";
  const depthKey = JSON.stringify([activeCell, symbol, timeframe, mode, source, epoch, marketEpoch, replay]);
  const through = replay && readout?.symbol === symbol && readout.timeframe === timeframe && readout.replay ? readout.replayThrough ?? null : null;
  const replayReady = replay && readout?.status === "ready" && readout.symbol === symbol && readout.timeframe === timeframe && readout.marketEpoch === marketEpoch;
  const key = JSON.stringify([depthKey, archiveRevision, through, replayReady]), paused = frozen?.key === key;
  useEffect(() => { setFrozen(null); setHoveredTape(null); setPage(0); }, [key]);
  const [current, setCurrent] = useState<{ key: string; value: TimeSalesSnapshot | null; error: string }>({ key: "", value: null, error: "" });
  useEffect(() => {
    if (replay) {
      const result = recordedTapeSource({ symbol, timeframe, replay, simulated, source, ready: replayReady, through, revision: archiveRevision }, studyTradeSource);
      setCurrent({ key, ...result }); return;
    }
    let previous: ReturnType<typeof useChartStore.getState>["trades"] | undefined;
    let sampledAt = -Infinity;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const sample = () => {
      const trades = useChartStore.getState().trades;
      if (trades === previous) return;
      previous = trades;
      sampledAt = performance.now();
      try { setCurrent({ key, value: captureTimeSales(trades, { symbol, simulated, replay }), error: "" }); }
      catch (error) { setCurrent({ key, value: null, error: error instanceof Error ? error.message : "Tape unavailable." }); }
    };
    const schedule = () => {
      if (refresh !== undefined) return;
      refresh = setTimeout(() => {
        refresh = undefined;
        sample();
      }, Math.max(0, LIVE_TAPE_REFRESH_MS - (performance.now() - sampledAt)));
    };
    sample();
    const off = useChartStore.subscribe(state => { if (state.trades !== previous) schedule(); });
    return () => { off(); clearTimeout(refresh); };
  }, [key, symbol, simulated, replay, timeframe, source, replayReady, through, archiveRevision]);
  const hoverPaused = !replay && pauseOnHover && hoveredTape?.key === key;
  const snapshot = tapeVisible || tapeDialog
    ? paused ? frozen.value : hoverPaused ? hoveredTape.value : current.key === key ? current.value : null
    : null;
  const newWhilePaused = useMemo(() => {
    if (!tapeVisible || !paused || current.key !== key || !current.value) return 0;
    return countNewRetainedTrades(frozen.value, current.value);
  }, [tapeVisible, paused, frozen, current, key]);
  const highlight = useMemo(() => !snapshot || highlightMode === "off" ? null : timeSalesHighlight(snapshot.trades,
    highlightMode === "auto" ? { mode: "auto", multiplier: highlightMultiplier } : { mode: "fixed", value: Number(highlightAt) }),
  [snapshot, highlightMode, highlightMultiplier, highlightAt]);
  const filters: TimeSalesFilters = useMemo(() => ({ side, minimum: Number(minimum), unit, maximumValue: Number(maximumValue) }), [side, minimum, unit, maximumValue]);
  const valid = validTapeFilters(filters);
  const matching = useMemo(() => snapshot && valid ? filterTimeSales(snapshot, filters) : [], [snapshot, valid, filters]);
  const clusters = useMemo(() => snapshot && valid && clusterInterval
    ? clusterTimeSales(snapshot, filters, clusterInterval)
    : [], [snapshot, valid, filters, clusterInterval]);
  const combined = useMemo(() => combine && !clusterInterval && snapshot
    ? combineTapeRows(snapshot.trades, new Set(matching)) : null, [combine, clusterInterval, matching, snapshot]);
  const displayedPage = useMemo(() => timeSalesPage(combined ?? matching, page), [combined, matching, page]);
  const totals = useMemo(() => tapeDialog === "details" && matching.length ? timeSalesTotals(matching) : null, [matching, tapeDialog]);
  const minuteBalance = useMemo(() => snapshot ? timeSalesMinuteBalance(snapshot) : null, [snapshot]);
  const latest = snapshot?.trades[0], about = describeSymbol(symbol);
  const bookTrades = bookVisible && current.key === key ? current.value?.trades : undefined;
  const sourceError = current.key === key ? current.error : "";
  const tapeStatus = tapeDialog !== "details" ? "" : replay ? sourceError || (!snapshot ? "Waiting for the current recorded tape." :
    `${matching.length} matching / ${snapshot.trades.length} recorded observations strictly before ${new Date(snapshot.replayThrough!).toISOString()}. ${snapshot.coverage} Live trades excluded; missing periods remain unknown.`) : sourceError ||
    `${paused ? `PAUSED at ${new Date(snapshot!.capturedAt).toISOString()}. ` : ""}${matching.length} matching / ${snapshot?.trades.length ?? 0} retained observations${snapshot?.rejected ? ` · ${snapshot.rejected} invalid, duplicate or other-source rows excluded` : ""}. `;
  const currentContext = useCallback((boundary: number | null | undefined) => {
    const chart = getPrimaryChart(), state = useChartStore.getState();
    if (useWorkspaceStore.getState().activeId !== activeCell ||
      state.symbol !== symbol || state.timeframe !== timeframe || state.feedMode !== mode || state.feedEpoch !== epoch ||
      (state.marketEpochs[symbol] ?? 0) !== marketEpoch || state.dataSources[`${symbol}:${timeframe}`] !== source) return false;
    if (replay) {
      return !!chart && useWorkspaceStore.getState().replay.active && chart.replay.state.active &&
        chart.market.symbol === symbol && chart.market.timeframe === timeframe && source === "exchange" &&
        completedReplayBoundary(chart.replay.state, timeframe) === boundary;
    }
    return !useWorkspaceStore.getState().replay.active && !chart?.replay.state.active;
  }, [activeCell, symbol, timeframe, mode, epoch, marketEpoch, source, replay]);
  const drawPriceLevel = useCallback((price: number, time: number | undefined, lineColor: string, boundary: number | null | undefined) => {
    const chart = getPrimaryChart();
    if (time === undefined || !currentContext(boundary) || chart?.market.symbol !== symbol || chart.market.timeframe !== timeframe) return;
    chart.drawings.add("hline", { paneId: "price", anchors: [{ time, price }], style: { lineColor } });
  }, [currentContext, symbol, timeframe]);
  const replayThrough = snapshot?.replayThrough;
  const drawTrade = useCallback((trade: Readonly<Tick>) => {
    if (studyTradeSource.revision(symbol) !== archiveRevision) return;
    const preferences = useWorkspaceStore.getState().domPreferences;
    const colors = domStyle(preferences.zoom ?? 100, preferences.colors);
    drawPriceLevel(trade.price, trade.time, trade.side === "buy" ? colors.bid : colors.ask, replayThrough);
  }, [symbol, archiveRevision, replayThrough, drawPriceLevel]);
  const exportTape = () => {
    if (!snapshot || !valid || studyTradeSource.revision(symbol) !== archiveRevision || !currentContext(snapshot.replayThrough)) return;
    const prefix = clusterInterval ? `tape-clusters-${clusterInterval / 1000}s` : "time-sales";
    const filename = `${prefix}-${symbol}-${snapshot.capturedAt}.csv`.replace(/[^a-zA-Z0-9._-]/g, "_");
    const csv = clusterInterval ? timeSalesClustersCsv(snapshot, filters, clusterInterval) : timeSalesCsv(snapshot, filters);
    downloadFile(filename, csv, "text/csv;charset=utf-8");
  };
  const filtered = side !== "all" || Number(minimum) > 0 || Number(maximumValue) > 0;
  return <div className="orderflow-dock">
    <div className="orderflow-panel detailed-orderflow" data-pane={pane}>
      <header className="flow-nav">
        <div ref={switchRef} className="flow-switch" role="group" aria-label="Order flow views">
          <button type="button" className="button" aria-pressed={pane === "tape"} onClick={() => setPane("tape")}>Time &amp; sales</button>
          <button type="button" className="button" aria-pressed={pane === "book"} onClick={() => setPane("book")}>Order book</button>
        </div>
        <details className="flow-chart-tools">
          <summary>Chart tools <ChevronDown size={14} aria-hidden="true"/></summary>
          <div>
            <button type="button" className="button small" aria-pressed={type === "footprint"} onClick={() => useChartStore.getState().set({ chartType: type === "footprint" ? "candles" : "footprint" })}>Footprint</button>
            <button type="button" className="button small" aria-pressed={type === "tpo"} onClick={() => useChartStore.getState().set({ chartType: type === "tpo" ? "candles" : "tpo" })}>TPO profile</button>
          </div>
        </details>
      </header>
      {tapeVisible && <section className="trade-tape" aria-label="Time and sales" style={{
        "--tape-buy": tapeStyle.bid,
        "--tape-sell": tapeStyle.ask,
        "--tape-font": `${tapeStyle.text}px`,
        "--tape-row": `${tapeStyle.row}px`,
      } as CSSProperties}>
        <div className="orderflow-title"><strong>Time &amp; sales · {symbol}</strong></div>
        <div className="flow-actions">
          <button type="button" className="button small" aria-label="Tape settings" aria-haspopup="dialog" onClick={() => setTapeDialog("settings")}>
            <SlidersHorizontal size={14} aria-hidden="true"/>{filtered ? "Filters on" : "Filters"}
          </button>
          {!replay && <button className="button small" type="button" disabled={!snapshot} onClick={() => {
            setFrozen(paused ? null : { key, value: snapshot! });
            setHoveredTape(null);
            setPage(0);
          }}>{paused ? "Resume tape" : "Pause tape"}</button>}
          <button type="button" className="button small" aria-label="Tape details" aria-haspopup="dialog" onClick={() => setTapeDialog("details")}>
            <CircleHelp size={14} aria-hidden="true"/> Details
          </button>
        </div>
        {!valid && !tapeDialog && <p className="flow-status" role="alert">Check the tape filter limits.</p>}
        {sourceError ? <p className="flow-status" role="status">{sourceError}</p> : <div className="flow-status tape-summary">
          <span>{paused ? "Paused · " : hoverPaused ? "Held · " : ""}{replay ? "Recorded" : simulated ? "Simulation" : "Observed"} · {matching.length.toLocaleString("en-US")} trades</span>
          {!replay && latest && <TapeTradeAge time={latest.time} />}
        </div>}
        {minuteBalance && <div className="tape-minute-balance">
          <div className="depth-balance-labels"><span className="positive">Buy {(minuteBalance.buyShare * 100).toFixed(1)}% · {number(minuteBalance.buy)}</span><span className="negative">Sell {((1 - minuteBalance.buyShare) * 100).toFixed(1)}% · {number(minuteBalance.sell)}</span></div>
          <div className="depth-balance-track" aria-hidden="true"><span style={{ width: `${minuteBalance.buyShare * 100}%` }}/></div>

        </div>}
        {(!replay || snapshot) && (clusterInterval ?
          <div onPointerEnter={event => { if (event.pointerType === "mouse" && !replay && pauseOnHover && !paused && snapshot) setHoveredTape({ key, value: snapshot }); }} onPointerLeave={() => setHoveredTape(null)}><TapeClusterTable rows={clusters} page={page} onPage={setPage}/></div> : <>
          <div className="filtered-tape-table" onPointerEnter={event => { if (event.pointerType === "mouse" && !replay && pauseOnHover && !paused && snapshot) setHoveredTape({ key, value: snapshot }); }} onPointerLeave={() => setHoveredTape(null)}><table aria-label="Filtered time and sales"><thead><tr><th>Time (UTC)</th><th>Price</th>{sizeDisplay !== "value" && <th><span className="tape-wide-label">Quantity</span><span className="tape-compact-label">{sizeDisplay === "both" ? "Size / value" : "Size"}</span></th>}{sizeDisplay !== "quantity" && <th className={sizeDisplay === "both" ? "tape-value-separate" : undefined}>Value</th>}<th>Side</th><th className="tape-print-count">Prints</th></tr></thead><tbody>
            {displayedPage.trades.map(trade => {
              const value = trade.price * trade.quantity;
              const tier = highlight && Number.isFinite(value) ? value >= highlight.block ? "Block" : value >= highlight.large ? "Large" : null : null;
              return <TapeTradeRow key={trade.id} trade={trade} quote={about.quote} tier={tier}
                milliseconds={milliseconds} sizeDisplay={sizeDisplay} replay={replay} contextKey={key} drawTrade={drawTrade} />;
            })}
          </tbody></table></div>

          {!matching.length && <p className="form-help">No retained executions match these filters. This does not mean zero market volume.</p>}
          <div className="tape-pagination"><button className="button small" type="button" disabled={!displayedPage.page} onClick={() => setPage(displayedPage.page - 1)}>Previous trades</button><span>Page {displayedPage.page + 1} of {displayedPage.pages} · 100 / page</span><button className="button small" type="button" disabled={displayedPage.page + 1 >= displayedPage.pages} onClick={() => setPage(displayedPage.page + 1)}>Next trades</button></div>
        </>)}
        {paused && newWhilePaused > 0 && <button className="button small" type="button" onClick={() => {
          setFrozen(null);
          setHoveredTape(null);
          setPage(0);
        }}>Resume with {newWhilePaused.toLocaleString("en-US")} new retained {newWhilePaused === 1 ? "observation" : "observations"}</button>}

      </section>}
      <ObservedOrderBook active={bookVisible} symbol={symbol} timeframe={timeframe} mode={mode} source={source} replay={replay}
        replayReady={replayReady} simulated={simulated} through={through} depthKey={depthKey} trades={bookTrades}
        currentContext={currentContext} drawPriceLevel={drawPriceLevel} />
    </div>
    {tapeDialog && createPortal(<Modal title={tapeDialog === "settings" ? "Tape filters & display" : "Tape details"} className="flow-settings-dialog" onClose={() => setTapeDialog(null)}>
      <div className="form-body flow-settings-body">
        {tapeDialog === "settings" ? <>
          <div className="flow-option-fields">
            {!clusterInterval && <label><input type="checkbox" checked={milliseconds} onChange={e => updatePreferences({ milliseconds: e.target.checked })} /> Milliseconds</label>}
            {!clusterInterval && <label><input type="checkbox" checked={combine} onChange={e => { updatePreferences({ combine: e.target.checked }); setPage(0); }} /> Combine nearby trades</label>}
            {!replay && <label><input type="checkbox" checked={pauseOnHover} onChange={e => { updatePreferences({ pauseOnHover: e.target.checked }); setHoveredTape(null); }} /> Pause on hover</label>}
            <label>Trade grouping<select aria-label="Tape view" value={tapeView} onChange={e => {
              updatePreferences({ tapeView: e.target.value as typeof tapeView });
              setHoveredTape(null);
              setPage(0);
            }}>
              <option value="trades">Executions</option><option value="second">1s clusters</option><option value="minute">1m clusters</option>
            </select></label>
            <label>Side<select aria-label="Trade side filter" value={side} onChange={e => { updateFilters({ side: e.target.value as TimeSalesFilters["side"] }); }}><option value="all">All</option><option value="buy">Aggressor buys</option><option value="sell">Aggressor sells</option></select></label>
            <label>Trade value preset ({about.quote || "quote"})<select value={unit === "price-times-quantity" && !Number(maximumValue) && ["0", "1000", "10000", "50000", "100000", "1000000"].includes(minimum) ? minimum : "custom"} onChange={e => {
              updateFilters({ unit: "price-times-quantity", minimum: e.target.value, maximumValue: "" });
            }}>
              <option value="custom" disabled>Custom</option>
              <option value="0">All sizes</option>
              <option value="1000">1K+</option>
              <option value="10000">10K+</option>
              <option value="50000">50K+</option>
              <option value="100000">100K+</option>
              <option value="1000000">1M+</option>
            </select></label>
            <label>Minimum size<input aria-label="Minimum trade size" type="number" min="0" step="any" value={minimum} onChange={e => { updateFilters({ minimum: e.target.value }); }}/></label>
            <label>Maximum value ({about.quote || "quote"})<input aria-label="Maximum trade value" type="number" min="0" step="any" placeholder="Unlimited" value={maximumValue} onChange={e => { updateFilters({ maximumValue: e.target.value }); }}/></label>
            {!clusterInterval && <>
              <label>Trade highlights<select value={highlightMode} onChange={e => updatePreferences({ highlightMode: e.target.value as typeof highlightMode })}><option value="off">Off</option><option value="fixed">Fixed</option><option value="auto">Automatic</option></select></label>
              {highlightMode === "fixed" && <label>Highlight at ({about.quote || "quote"})<input aria-label="Highlight trade value threshold" type="number" min="0" step="any" placeholder="Off" value={highlightAt} onChange={e => updatePreferences({ highlightAt: e.target.value })} /></label>}
              {highlightMode === "auto" && <label>Mean trade value multiplier<select value={highlightMultiplier} onChange={e => updatePreferences({ highlightMultiplier: Number(e.target.value) })}>{tapeHighlightMultipliers.map(n => <option key={n} value={n}>{n}×</option>)}</select></label>}
            </>}
            <label>Filter unit<select aria-label="Trade size unit" value={unit} onChange={e => { updateFilters({ unit: e.target.value as TimeSalesFilters["unit"] }); }}><option value="quantity">Provider quantity</option><option value="price-times-quantity">Price × quantity</option></select></label>
            <button type="button" className="button small" disabled={side === "all" && unit === "quantity" && minimum === "0" && maximumValue === ""} onClick={() => {
              const { side, unit, minimum, maximumValue } = defaultTapePreferences;
              updateFilters({ side, unit, minimum, maximumValue });
            }}>Reset trade filters</button>
            {!clusterInterval && <label>Size columns<select value={sizeDisplay} onChange={e => updatePreferences({ sizeDisplay: e.target.value as typeof sizeDisplay })}><option value="both">Quantity and value</option><option value="quantity">Quantity</option><option value="value">Price × quantity</option></select></label>}
            <button className="button small" type="button" disabled={!snapshot || !valid} onClick={exportTape}>{paused ? "Export paused tape CSV" : clusterInterval ? "Export tape clusters CSV" : "Export filtered trades CSV"}</button>
          </div>
          {!valid && <p className="form-help" role="alert">Use finite, nonnegative limits. A maximum must be at least the minimum.</p>}
        </> : <>
          <p className="form-help">{tapeStatus}</p>
          {!clusterInterval && highlightMode === "auto" && <p className="form-help">{highlight ? `Large ≥ ${number(highlight.large)} · Block ≥ ${number(highlight.block)} ${about.quote}` : "Automatic highlighting requires at least 30 usable observations."} Based on the unfiltered tape.</p>}
          {minuteBalance && <p className="form-help">Observed price × quantity ({about.quote || "provider units"}) · Unfiltered 60s through {new Date(minuteBalance.through).toISOString()}</p>}
          {clusterInterval && <p className="form-help">{clusters.length} observed UTC windows. Filters apply to executions before grouping. Delta is buy quantity minus sell quantity. Empty windows and missing periods remain unknown.</p>}
          {combined && <p className="form-help">Consecutive matching trades in the original tape share a row when they have the same price and side and occur in the same millisecond on Binance or within 10 ms on other feeds and in simulation. Grouping is an estimate. CSV exports individual observations.</p>}
          <p className="form-help">{replay ? "Recorded archive prefix: at most 100,000 selected observations. Use chart Replay controls to advance or pause. This is completed-candle review, not original-arrival or tick-by-tick playback." : "Rolling buffer: at most 5,000 observed executions, not full session history. Pausing freezes only this tape; collection continues."} CSV includes all filtered source rows, not just this page. Price × quantity is a raw product in provider units, not a verified contract turnover. All displayed times are UTC.</p>
          {totals && (() => {
            const buyNum = Number(totals.buyVolume), sellNum = Number(totals.sellVolume), totalNum = buyNum + sellNum;
            const deltaPct = Number.isFinite(totalNum) && totalNum > 0 ? Number(totals.delta) / totalNum * 100 : null;
            return <div className="flow-totals" aria-label="Totals across all matching executions">
              <span className="positive">Buy quantity <strong>{totals.buyVolume}</strong> ({totals.buys} observations)</span>
              <span className="negative">Sell quantity <strong>{totals.sellVolume}</strong> ({totals.sells} observations)</span>
              <span>Quantity delta <strong>{totals.delta}</strong>{deltaPct !== null ? <> (<strong className={deltaPct > 0 ? "positive" : deltaPct < 0 ? "negative" : ""}>{deltaPct > 0 ? "+" : ""}{deltaPct.toFixed(1)}%</strong>)</> : null}</span>
              <span>Weighted buy price <strong>{totals.buyAverage === null ? "—" : `${number(totals.buyAverage)} ${about.quote}`}</strong></span>
              <span>Weighted sell price <strong>{totals.sellAverage === null ? "—" : `${number(totals.sellAverage)} ${about.quote}`}</strong></span>
              <span>All matching executions · provider units</span>
            </div>;
          })()}
        </>}
      </div>
    </Modal>, document.getElementById("native-chart-dialog-host") ?? document.body)}
  </div>;
}

interface TapeTradeRowProps {
  trade: Readonly<Tick> & { observations?: number };
  quote: string;
  tier: "Large" | "Block" | null;
  milliseconds: boolean;
  sizeDisplay: typeof defaultTapePreferences["sizeDisplay"];
  replay: boolean;
  contextKey: string;
  drawTrade(trade: Readonly<Tick>): void;
}

const TapeTradeRow = memo(function TapeTradeRow({
  trade, quote, tier, milliseconds, sizeDisplay, replay, contextKey, drawTrade,
}: TapeTradeRowProps) {
  const value = trade.price * trade.quantity;
  const side = trade.side === "buy" ? "positive" : "negative";
  const iso = new Date(trade.time).toISOString();
  const displayTime = milliseconds ? iso : iso.replace(/\.\d{3}Z$/, "Z");
  const draw = () => drawTrade(trade);
  return <tr className={tier ? `tape-highlight ${side}${tier === "Block" ? " tape-block" : ""}` : undefined}>
    <td><time dateTime={iso} title={iso}>{replay ? displayTime : displayTime.split("T")[1].slice(0, -1)}</time></td>
    <td><PriceLevelMenu key={contextKey} price={trade.price} draw={draw}>
      {actions => <button type="button" className="button small" aria-label={`Draw trade price ${trade.price} ${quote}`}
        onClick={draw} {...actions}>{String(trade.price)}</button>}
    </PriceLevelMenu></td>
    {sizeDisplay !== "value" && <td>{number(trade.quantity)}
      {sizeDisplay === "both" && <small className="tape-compact-label" title={`Notional in ${quote}`}>{Number.isFinite(value) ? number(value) : "—"}</small>}
    </td>}
    {sizeDisplay !== "quantity" && <td className={sizeDisplay === "both" ? "tape-value-separate" : undefined}>{Number.isFinite(value) ? number(value) : "—"}</td>}
    <td className={side}>{trade.side === "buy" ? "Buy" : "Sell"}
      {(trade.observations ?? 0) > 1 && <small> · {trade.observations} observations</small>}
      {tier && <span className="tape-highlight-label"> {tier}</span>}
      {trade.tradeCount !== undefined && <small className="tape-compact-label">{trade.tradeCount} {trade.tradeCount === 1 ? "print" : "prints"}</small>}
    </td>
    <td className="tape-print-count">{trade.tradeCount ?? "—"}</td>
  </tr>;
});

function TapeTradeAge({ time }: { time: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <time dateTime={new Date(time).toISOString()} title={new Date(time).toISOString()}>{Math.max(0, Math.floor((now - time) / 1000))}s ago</time>;
}

interface ObservedOrderBookProps {
  active: boolean;
  symbol: string;
  timeframe: string;
  mode: FeedMode;
  source: "exchange" | "simulation" | undefined;
  replay: boolean;
  simulated: boolean;
  replayReady: boolean;
  through: number | null;
  depthKey: string;
  trades: readonly Readonly<Tick>[] | undefined;
  currentContext: (boundary: number | null | undefined) => boolean;
  drawPriceLevel: (price: number, time: number | undefined, lineColor: string, boundary: number | null | undefined) => void;
}

const ObservedOrderBook = memo(function ObservedOrderBook({
  active, symbol, timeframe, mode, source, replay, simulated, replayReady, through, depthKey, trades, currentContext, drawPriceLevel,
}: ObservedOrderBookProps) {
  const [depthLevels, setDepthLevels] = useState(6);
  const [liveNow, setNow] = useState(Date.now);
  const depthPreferences = useWorkspaceStore(s => s.domPreferences.book);
  const [frozenDepth, setFrozenDepth] = useState<{
    key: string;
    book: OrderBook;
    capturedAt: number;
    lastTrade: ReturnType<typeof bookLastTrade>;
  } | null>(null);
  useEffect(() => { setFrozenDepth(null); }, [depthKey]);
  const pausedDepth = !replay && !simulated && frozenDepth?.key === depthKey ? frozenDepth : null;
  const book = useChartStore(s => !active || replay || pausedDepth ? null : s.orderBook);
  useSyncExternalStore(active ? replayDepth.subscribe : subscribeNothing,
    active ? replay ? replayDepth.getRevision : replayDepth.getStatusRevision : emptyRevision, emptyRevision);
  const liveClock = active && !replay && !pausedDepth && !simulated;
  useEffect(() => {
    if (!liveClock) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [liveClock]);
  const now = replay ? Date.now() : liveNow;
  const matchedBase = /^(?:KRK:)?(BTC|ETH)\/?USDT$/.exec(symbol)?.[1];
  const combinedBase = matchedBase === "BTC" || matchedBase === "ETH" ? matchedBase : "";
  const combineBooks = !!combinedBase && (depthPreferences?.combinedMarkets?.includes(combinedBase) ?? false);
  const binanceSymbol = `${combinedBase}USDT`, krakenPair = `${combinedBase}/USDT`, krakenSymbol = `KRK:${krakenPair}`;
  const binanceChart = symbol === binanceSymbol, krakenChart = symbol === krakenSymbol;
  const canCombineBooks = active && !replay && mode !== "simulation" && source === "exchange" && !!combinedBase && (binanceChart || krakenChart);
  const [compareVenue, setCompareVenue] = useState(false);
  const loadSecondaryBook = canCombineBooks && !pausedDepth && (combineBooks || compareVenue);
  const secondaryKrakenBook = useKrakenBook(loadSecondaryBook && binanceChart ? krakenPair : null);
  const secondaryBinanceBook = useBinanceBook(loadSecondaryBook && krakenChart ? binanceSymbol : null);
  const binanceBook = binanceChart ? book : secondaryBinanceBook;
  const krakenBook = krakenChart ? book : secondaryKrakenBook;
  const { metadata: binanceGrid, error: binanceGridError } = useDomPriceGrid(binanceSymbol, binanceSymbol, canCombineBooks && combineBooks);
  const { metadata: krakenGrid, error: krakenGridError } = useDomPriceGrid(krakenSymbol, krakenSymbol, canCombineBooks && combineBooks);
  const recordedDepth = active && replayReady && source === "exchange" && !simulated && through !== null
    ? replayDepth.before(symbol, through, now)
    : undefined;
  useEffect(() => {
    if (!active || !replayReady || through === null) return;
    const now = Date.now();
    const refreshAt = recordedDepth ? recordedDepth.observedAt + REPLAY_DEPTH_RETENTION_MS + 1 : through;
    if (refreshAt <= now) return;
    const timer = setTimeout(() => setNow(Date.now()), refreshAt - now);
    return () => clearTimeout(timer);
  }, [active, replayReady, recordedDepth, through]);
  const displayedDepth = !active ? null : replay ? recordedDepth : pausedDepth?.book ?? book;
  const comparisonSymbol = binanceChart ? krakenSymbol : binanceSymbol;
  const comparisonBook = binanceChart ? secondaryKrakenBook : secondaryBinanceBook;
  const comparisonReason = canCombineBooks && compareVenue && !pausedDepth
    ? depthBookStatus(comparisonBook, { symbol: comparisonSymbol, replay: false, simulation: false, now })
    : null;
  const binanceTiming = binanceBook && depthTimestampStatus(binanceBook.time, now);
  const krakenTiming = krakenBook && depthTimestampStatus(krakenBook.time, now);
  const combinedDepth = useMemo(() => {
    if (!canCombineBooks || !combineBooks || pausedDepth) return null;
    if (binanceBook?.symbol !== binanceSymbol || krakenBook?.symbol !== krakenSymbol) return { error: `Waiting for Binance and Kraken ${krakenPair} depth.` };
    if (!binanceGrid || !krakenGrid)
      return { error: binanceGridError || krakenGridError || "Waiting for verified Binance and Kraken price increments." };
    if (binanceTiming) return { error: `${binanceSymbol}: ${binanceTiming}` };
    if (krakenTiming) return { error: `${krakenSymbol}: ${krakenTiming}` };
    try {
      // The timestamps have passed the wall-clock check. This instant is fixed for these two snapshots.
      const validationTime = Math.max(binanceBook.time, krakenBook.time) - 1000;
      return { value: combineVenueBooks([
        { book: binanceBook, symbol: binanceSymbol, base: combinedBase, quote: "USDT", tick: priceGridTick(binanceGrid) },
        { book: krakenBook, symbol: krakenSymbol, base: combinedBase, quote: "USDT", tick: priceGridTick(krakenGrid) },
      ], validationTime) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Combined depth unavailable." };
    }
  }, [canCombineBooks, combineBooks, pausedDepth, binanceBook, krakenBook, binanceTiming, krakenTiming,
    binanceGrid, krakenGrid, binanceGridError, krakenGridError, binanceSymbol, krakenSymbol, krakenPair, combinedBase]);
  const depthReason = replay
    ? recordedDepth ? null : "No retained depth snapshot within three seconds before the completed Replay boundary."
    : pausedDepth ? null : depthBookStatus(book, { symbol, replay, simulation: simulated, now });
  const recordingDepth = replayDepth.recording === symbol;
  const metrics = useMemo(() => displayedDepth && !depthReason ? depthMetrics(displayedDepth, depthLevels) : null,
    [displayedDepth, depthReason, depthLevels]);
  const bookTrades = pausedDepth ? undefined : trades;
  const lastBookTrade = useMemo(() => pausedDepth ? pausedDepth.lastTrade : bookTrades && bookLastTrade(bookTrades, recordedDepth?.exchangeTime),
    [pausedDepth, bookTrades, recordedDepth]);
  const about = describeSymbol(symbol);
  const depthIsCurrent = () => {
    if (depthReason || !currentContext(through)) return false;
    if (replay) return !!recordedDepth && through !== null && replayDepth.before(symbol, through, Date.now()) === recordedDepth;
    return !!pausedDepth || !depthBookStatus(book, { symbol, replay, simulation: simulated, now: Date.now() });
  };
  const exportDepth = () => {
    if (!displayedDepth || !depthIsCurrent()) return;
    const snapshotTime = recordedDepth?.exchangeTime ?? (pausedDepth?.book ?? book)!.time;
    const csv = depthSnapshotCsv(displayedDepth, { symbol, snapshotTime, observedAt: recordedDepth?.observedAt, replayThrough: through ?? undefined, pausedAt: pausedDepth?.capturedAt });
    const filename = `depth-${replay ? "replay" : "live"}-${symbol}-${snapshotTime}.csv`.replace(/[^a-zA-Z0-9._-]/g, "_");
    downloadFile(filename, csv, "text/csv;charset=utf-8");
  };
  if (!active) return null;
  return (
    <section className="orderbook" aria-label="Observed order book">
      <div className="orderflow-title"><strong>Depth of market</strong><span>{depthReason ? "UNAVAILABLE" : replay ? "RECORDED TOP LEVELS" : pausedDepth ? "PAUSED SNAPSHOT" : "OBSERVED TOP LEVELS"}</span></div>
      <div className="flow-actions">
        {!replay && !simulated && <button className="button small" type="button" disabled={!pausedDepth && !!depthReason} onClick={() => {
          if (pausedDepth) {
            setFrozenDepth(null);
            return;
          }
          const capturedAt = Date.now();
          if (!book || !currentContext(null) || depthBookStatus(book, { symbol, replay, simulation: simulated, now: capturedAt })) return;
          const lastTrade = bookTrades && bookLastTrade(bookTrades, book.time);
          setFrozenDepth({ key: depthKey, capturedAt, lastTrade, book: {
            ...book, bids: book.bids.map(level => ({ ...level })), asks: book.asks.map(level => ({ ...level })),
          } });
        }}>{pausedDepth ? "Resume depth view" : "Pause depth view"}</button>}
        <details className="flow-book-actions">
          <summary>Book options <ChevronDown size={14} aria-hidden="true"/></summary>
          <div>
            {canCombineBooks && <label><input type="checkbox" checked={combineBooks} onChange={event => {
              if (!combinedBase) return;
              const workspace = useWorkspaceStore.getState();
              const settings = workspace.domPreferences.book ?? defaultBookView();
              const markets = (settings.combinedMarkets ?? []).filter(market => market !== combinedBase);
              if (event.target.checked) markets.push(combinedBase);
              workspace.setDomPreferences({ book: { ...settings, combinedMarkets: markets } });
            }} /> Compare combined Binance and Kraken depth</label>}
            {canCombineBooks && <label><input type="checkbox" checked={compareVenue} onChange={event => setCompareVenue(event.target.checked)} />
              Show {binanceChart ? "Kraken" : "Binance"} depth separately
            </label>}
            {!replay && !simulated && <button className="button small" type="button" disabled={!recordingDepth && !!depthReason} onClick={() => {
              replayDepth.recording = recordingDepth ? null : symbol;
            }}>{recordingDepth ? "Pause depth capture" : "Capture depth for Replay"}</button>}
            {metrics && <label>Balance depth <select aria-label="Depth balance levels" value={depthLevels} onChange={event => setDepthLevels(Number(event.target.value))}>
              <option value={1}>Top 1</option><option value={3}>Top 3</option><option value={6}>Top 6</option>
            </select></label>}
            {!depthReason && <button className="button small" type="button" onClick={exportDepth}>Export depth snapshot CSV</button>}
            <p className="form-help">Depth capture saves up to one book per second locally for 10 minutes. Replay uses samples before the completed candle boundary.</p>
            {recordingDepth && <p className="form-help" role="status">Depth capture is active.</p>}
            {replayDepth.storageError && <p className="form-help" role="status">{replayDepth.storageError}</p>}
          </div>
        </details>
        {recordingDepth && <span className="flow-status">Recording depth</span>}
      </div>
      {depthReason ? <p className="depth-empty" role="status">{depthReason}</p> : <>
        {metrics && <div className="depth-summary">
          <div className="depth-balance-track" aria-hidden="true"><span style={{ width: `${metrics.bidShare * 100}%` }}/></div>
          <div className="depth-balance-labels">
            <span className="positive">Bid {(metrics.bidShare * 100).toFixed(1)}%</span>
            <span>{metrics.levels} lvls · Spread {number(metrics.spread)} ({metrics.spreadBps.toFixed(1)} bps)</span>
            <span className="negative">Ask {((1 - metrics.bidShare) * 100).toFixed(1)}%</span>
          </div>
        </div>}
        <BookView key={`${depthKey}:${pausedDepth?.capturedAt ?? "live"}:${through ?? ""}`} book={displayedDepth!} symbol={symbol} base={getSymbol(symbol).base.split("/")[0]} quote={about.quote} contextKey={depthKey} live={!replay && !pausedDepth} lastTrade={lastBookTrade} onDrawLevel={(price, lineColor) => {
          if (!depthIsCurrent()) return;
          const time = replay ? recordedDepth?.exchangeTime : (pausedDepth?.book ?? book)?.time;
          drawPriceLevel(price, time, lineColor, through);
        }} onDrawArea={(best, price, color) => {
          const chart = getPrimaryChart();
          const time = replay ? recordedDepth?.exchangeTime : (pausedDepth?.book ?? book)?.time;
          if (time === undefined || !depthIsCurrent() || chart?.market.symbol !== symbol || chart.market.timeframe !== timeframe) return;
          const duration = intervalMs(timeframe);
          let start = time - duration, end = time;
          if (!duration) {
            const candles = useChartStore.getState().candles;
            const index = candles.findLastIndex(candle => candle.time <= time);
            end = candles[index]?.time ?? time;
            const previous = candles.findLastIndex(candle => candle.time < end);
            if (index < 0 || previous < 0) {
              useChartStore.getState().toast("Could not draw area", "Two tick candles with distinct timestamps are required at or before the snapshot.", "error");
              return;
            }
            start = candles[previous].time;
          }
          chart.drawings.add("box", {
            paneId: "price",
            anchors: [{ time: start, price: best }, { time: end, price }],
            style: { lineColor: color, fillColor: color, fillOpacity: .15 },
          });
        }}/>
        <p className="form-help">
          {pausedDepth && `Paused at ${new Date(pausedDepth.capturedAt).toISOString()}. `}
          {recordedDepth ? `Received ${new Date(recordedDepth.observedAt).toISOString()}. Snapshot ${new Date(recordedDepth.exchangeTime).toISOString()}. ` : `Snapshot ${new Date((pausedDepth?.book ?? book)!.time).toISOString()}. `}
          Observed top levels only.
        </p>
      </>}
      {canCombineBooks && compareVenue && !pausedDepth && <section aria-label="Secondary venue order book">
        <strong>{binanceChart ? "Kraken" : "Binance"} {krakenPair} depth</strong>
        {comparisonReason || !comparisonBook ? <p role="status">{comparisonReason}</p>
          : <BookView key={comparisonSymbol} book={comparisonBook} symbol={comparisonSymbol} base={combinedBase}
            quote="USDT" contextKey={comparisonSymbol} live />}
      </section>}
      {combinedDepth && <section aria-label="Combined order book">
        <strong>Combined {krakenPair} depth</strong>
        {combinedDepth.value ? <>
          <p className="form-help">
            {combinedDepth.value.tick} USDT base increment · Received locally (UTC) ·{" "}
            {combinedDepth.value.sources.map(({ symbol: market, time, bidLevels, askLevels }, index) => {
              const timestamp = new Date(time).toISOString();
              return <span key={market}>{index > 0 && " · "}
                {market === binanceSymbol ? "Binance" : "Kraken"}{" "}
                <time dateTime={timestamp} title={timestamp}>{timestamp.slice(11, 23)}</time>
                {" "}({(Math.max(0, now - time) / 1000).toFixed(1)} s ago; {bidLevels} bid / {askLevels} ask levels received)
              </span>;
            })}{" · "}
            {Math.abs(combinedDepth.value.sources[0].time - combinedDepth.value.sources[1].time).toLocaleString("en-US")} ms between receipts
          </p>
          <BookView key={depthKey} book={combinedDepth.value} symbol={symbol} base={combinedBase} quote="USDT" contextKey={depthKey} live={false} fixedTick={combinedDepth.value.tick} observedTop={combinedDepth.value.observedTop} />
          <button type="button" className="button small" onClick={() => {
            const now = Date.now();
            const value = combinedDepth.value;
            if (!value || !currentContext(null) || value.sources.some(source => depthTimestampStatus(source.time, now))) return;
            downloadFile(`combined-depth-${combinedBase}-USDT.csv`, combinedBookCsv(value), "text/csv;charset=utf-8");
          }}>Export combined depth CSV</button>
        </> : <p role="status">{combinedDepth.error}</p>}
      </section>}
    </section>
  );
});
