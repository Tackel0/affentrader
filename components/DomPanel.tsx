"use client";
import {WorkingOrderControls} from "./OrderModification";
import {PositionActions} from "./PositionActions";
import { symbolLabel } from "@/lib/symbolId";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Crosshair, Lock, SlidersHorizontal } from "lucide-react";
import { Modal } from "./ui";
import { useDomTrades } from "@/hooks/useDomTrades";
import { useDomNavigation } from "@/hooks/useDomNavigation";
import { useDomPriceGrid } from "@/hooks/useDomPriceGrid";
import { getPrimaryChart } from "@/hooks/useVelaChart";
import { domGridChoice } from "@/lib/orderflow/domPriceGrid";
import { formatOrderflowAmount } from "@/lib/orderflow/formatAmount";
import { useChartStore } from "@/stores/useChartStore";
import { activeAccount, usePaperStore } from "@/stores/usePaperStore";
import {captureDomOrderContext,paperCommands} from "@/lib/trading/paperCommands";
import {assertDomOrderReview,domOrderDraft,domOrderContextKey,workingDomOrders,type DomOrderReview} from "@/lib/trading/domOrder";
import {usePaperRole} from "@/hooks/usePaperOwnership";
import {paperSourceLabel} from "@/lib/trading/executionSource";
import { describeSymbol, formatPrice } from "@/lib/symbols";
import { DOM_COLUMNS,defaultDomColumns,shownDomColumns,shiftDomColumn,reorderDomColumn,requiredDomColumn,domPnlAtPrice,type DomColumnId,type DomColumns } from "@/lib/orderflow/domColumns";
import {domGrouping} from "@/lib/orderflow/domPreferences";
import {defaultDomHighlight,domLargeThresholds,domOrderTier} from "@/lib/orderflow/domLargeOrders";
import {DOM_ZOOMS,defaultDomColors,domStyle,validDomColor} from "@/lib/orderflow/domStyle";
import { bookTick, centeredLadder, depthBookStatus, groupedLadderStep, ladderIndex, ladderPrice } from "@/lib/orderflow/depthLadder";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";
import { PriceLevelMenu } from "./PriceLevelMenu";

export { bookTick, buildLadder } from "@/lib/orderflow/depthLadder";

const chartLineage = (state: ReturnType<typeof useChartStore.getState>) =>
  JSON.stringify([state.symbol, state.timeframe, state.feedMode, state.feedEpoch, state.marketEpochs[state.symbol] ?? 0, state.dataSources[`${state.symbol}:${state.timeframe}`]]);

export function DomPanel() {
  const role=usePaperRole();
  const symbol = useChartStore((s) => s.symbol);
  const priceSource=usePaperStore(s=>s.mode==="replay"?s.replaySource:s.liveSources[symbol]);
  const book = useChartStore((s) => s.orderBook);
  const lastTrade = useChartStore(s => s.trades?.find(t => t.symbol === s.symbol && !t.simulated));
  const lineage = useChartStore(chartLineage);
  const simulation = useChartStore(s => s.feedMode === "simulation");
  const dataSource = useChartStore(s => s.dataSources[`${s.symbol}:${s.timeframe}`]);
  const replay = useWorkspaceStore(s => s.replay.active);
  const mode = usePaperStore((s) => s.mode);
  const account = usePaperStore((s) => activeAccount(s));
  const paperEpoch=usePaperStore(s=>s.contextEpoch),activeCell=useWorkspaceStore(s=>s.activeId);
  const ticket = usePaperStore((s) => s.ticket);
  const domPreferences=useWorkspaceStore(s=>s.domPreferences),group=domGrouping(domPreferences,symbol);
  const highlight=domPreferences.highlight??defaultDomHighlight();
  const zoom=domPreferences.zoom??100,style=domStyle(zoom,domPreferences.colors??defaultDomColors());
  const [colorDraft,setColorDraft]=useState({bid:style.bid,ask:style.ask});
  useEffect(()=>setColorDraft({bid:style.bid,ask:style.ask}),[style.bid,style.ask]);
  const [amountDraft,setAmountDraft]=useState("");
  useEffect(()=>setAmountDraft(highlight.mode==="fixed"?String(highlight.value):""),[highlight.mode,highlight.mode==="fixed"?highlight.value:highlight.multiplier]);
  const setDomPreferences=useWorkspaceStore(s=>s.setDomPreferences);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paperOpen, setPaperOpen] = useState(false);
  const allColumns = domPreferences.view === "configured";
  const [message, setMessage] = useState("");
  const [busy,setBusy]=useState(false);
  const submitting=useRef(false);
  const [unlocked,setUnlocked]=useState(false),[askBefore,setAskBefore]=useState(true),[review,setReview]=useState<DomOrderReview|null>(null);
  useEffect(()=>{setUnlocked(false);setReview(null);},[lineage,replay,mode,paperEpoch,activeCell]);
  const [now, setNow] = useState(Date.now);
  const [observedGrid, setObservedGrid] = useState<{key:string;spacing:number} | null>(null);
  const executions = useDomTrades();
  const executionUnit=domPreferences.executionUnit;
  const [executionRevision, setExecutionRevision] = useState(0);
  const columnSettings=domPreferences.columns,draggedColumn=useRef<DomColumnId|null>(null);
  const setColumnSettings=(update:DomColumns|((current:DomColumns)=>DomColumns))=>setDomPreferences({columns:typeof update==="function"?update(useWorkspaceStore.getState().domPreferences.columns):update});
  const columnPointerCleanup=useRef<(()=>void)|null>(null);
  useEffect(()=>()=>columnPointerCleanup.current?.(),[]);
  const beginColumnDrag=(event:ReactPointerEvent<HTMLSpanElement>,from:DomColumnId)=>{
    if(event.button!==0)return;event.preventDefault();columnPointerCleanup.current?.();
    const list=event.currentTarget.closest(".dom-column-list"),pointer=event.pointerId;
    const cleanup=()=>{document.removeEventListener("pointerup",drop);document.removeEventListener("pointercancel",cleanup);columnPointerCleanup.current=null;};
    const drop=(up:PointerEvent)=>{
      if(up.pointerId!==pointer)return;
      const target=document.elementFromPoint(up.clientX,up.clientY)?.closest<HTMLElement>("[data-dom-column]");
      const id=target?.dataset.domColumn;
      if(target?.closest(".dom-column-list")===list && DOM_COLUMNS.some(c=>c.id===id))setColumnSettings(current=>reorderDomColumn(current,from,id as DomColumnId));
      cleanup();
    };
    columnPointerCleanup.current=cleanup;document.addEventListener("pointerup",drop);document.addEventListener("pointercancel",cleanup);
  };
  const venueGrid = useDomPriceGrid(symbol,lineage,!simulation && !replay && mode!=="replay" && dataSource==="exchange");
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  const unavailable = depthBookStatus(book, { symbol, replay: replay || mode === "replay", simulation, now });
  useEffect(() => {
    if (unavailable || !book) return;
    try { const spacing=bookTick(book); setObservedGrid(old=>old?.key===lineage ? old : {key:lineage,spacing}); } catch { /* The ordinary book status presents invalid depth. */ }
  },[lineage,book,unavailable]);
  const model = useMemo(() => {
    try {
      const price = lastTrade && lastTrade.time <= now && now-lastTrade.time < 5000 ? lastTrade.price : book?.bids[0] && book?.asks[0] ? (book.bids[0].price+book.asks[0].price)/2 : null;
      const observed=observedGrid?.key===lineage ? observedGrid.spacing : book ? bookTick(book) : .01;
      const grid=domGridChoice(symbol,venueGrid,price??undefined,observed),step=groupedLadderStep(grid.tick,group);
      if (book?.bids[0] && ladderIndex(book.bids[0].price,step,"bid") < 1) throw new Error("This grouping produces a nonpositive bid price. Reduce the grouping multiplier.");
      return {step,target:price === null ? null : ladderIndex(price,step),reference:price,error:"",grid};
    } catch (error) { return {step:.01,target:null,reference:null,error:error instanceof Error ? error.message : "Depth cannot be grouped.",grid:undefined}; }
  }, [book, group, lastTrade, now, observedGrid, lineage, symbol, venueGrid]);
  const { step } = model, reason = unavailable || model.error;
  const priceMenuContext = JSON.stringify([activeCell, lineage, replay, mode, step]);
  const drawPrice = (price: number) => {
    const state = useChartStore.getState();
    const chart = getPrimaryChart();
    const workspace = useWorkspaceStore.getState();
    if (!book || reason || chartLineage(state) !== lineage || workspace.activeId !== activeCell ||
      workspace.replay.active || chart?.replay.state.active || chart?.market.symbol !== symbol ||
      chart.market.timeframe !== state.timeframe) return;
    if (depthBookStatus(book, { symbol, replay: usePaperStore.getState().mode === "replay", simulation, now: Date.now() })) return;
    const reference = model.reference;
    const lineColor = reference === null || price === reference ? undefined : price < reference ? style.bid : style.ask;
    chart.drawings.add("hline", {
      paneId: "price",
      anchors: [{ time: book.time, price }],
      style: lineColor ? { lineColor } : undefined,
    });
  };
  useEffect(()=>setReview(null),[ticket.quantity,step]);
  const orders = useMemo(() => workingDomOrders(account.orders, symbol, step), [account.orders, symbol, step]);
  const touchRows = (unlocked || (allColumns && orders.hasWorking)) && typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const rowHeight = touchRows ? Math.max(37, style.row) : style.row;
  const navigation = useDomNavigation(JSON.stringify([lineage,replay,mode,step]),reason ? null : model.target,now,domPreferences.follow,domPreferences.delay,{row: rowHeight, head: style.head});
  const executed = useMemo(() => {
    try { return { rows: executions?.rows(step, executionUnit, now), error: executions?.error ?? "" }; }
    catch (error) { return { rows: undefined, error: error instanceof Error ? error.message : "Execution rows unavailable." }; }
  }, [executions, step, executionUnit, now, executionRevision]);
  const executionNumber = (value: number | undefined) => !executions || executed.error ? "—" : formatOrderflowAmount(value ?? 0);
  const viewport = useMemo(() => {
    if (reason || !book) return {rows:[],error:""};
    try { return {rows:centeredLadder(book,step,navigation.center,navigation.upperRows,navigation.visibleRows),error:""}; }
    catch(error){return {rows:[],error:error instanceof Error ? error.message : "DOM viewport unavailable."};}
  },[reason,book,step,navigation.center,navigation.upperRows,navigation.visibleRows]);
  const rows = viewport.rows;
  const largeThresholds=domLargeThresholds(rows,highlight);
  const maxSize = Math.max(Number.MIN_VALUE, ...rows.flatMap((r) => [r.bid, r.ask]));
  const position = useMemo(() => account.positions.find((p) => p.symbol === symbol), [account.positions, symbol]);
  const average = position?.avgPrice;
  const positionPrice = useMemo(() => {
    if (average === undefined) return null;
    try { return ladderPrice(average, step); } catch { return null; }
  }, [average, step]);
  const columns: DomColumnId[] = allColumns ? shownDomColumns(columnSettings, !!position, orders.hasWorking) : ["bid", "price", "ask"];
  const quote = describeSymbol(symbol).quote || "quote units";
  const columnWidths=columns.map(id=>DOM_COLUMNS.find(column=>column.id===id)!.width);
  const submit = async(next:DomOrderReview) => {
    const current = useChartStore.getState();
    const invalid = depthBookStatus(current.orderBook, { symbol, replay: useWorkspaceStore.getState().replay.active || usePaperStore.getState().mode === "replay", simulation: current.feedMode === "simulation", now: Date.now() });
    if (current.symbol !== symbol || invalid || reason) { setMessage(invalid || reason || "The selected market changed.");setReview(null);return; }
    try {assertDomOrderReview(next,captureDomOrderContext());if(next.ladder&&!unlocked)throw new Error("DOM click trading is locked.");}
    catch(error){setMessage(error instanceof Error?error.message:"Order context changed.");setReview(null);return;}
    if(submitting.current)return;submitting.current=true;setBusy(true);setMessage("");setReview(null);try{
    const result = await paperCommands.placeDomReviewed(next);
    if(!result)return;
    setMessage(
      result.ok
        ? `${next.order.side === "buy" ? "Buy" : "Sell"} ${next.order.type} ${next.order.quantity} @ ${formatPrice(result.order.fillPrice??next.order.price??next.order.stopPrice??0)}`
        : (result.order.reason ?? "Rejected"),
    );
    }finally{submitting.current=false;setBusy(false);}
  };
  const place=(side:"buy"|"sell",price?:number)=>{
    if(price!==undefined&&!unlocked){setMessage("Unlock Click to trade before placing a ladder order.");return;}
    try{
      const next:DomOrderReview={order:domOrderDraft(symbol,side,ticket.quantity,price,model.reference??undefined),context:captureDomOrderContext(),ladder:price!==undefined};
      assertDomOrderReview(next,captureDomOrderContext());
      if(askBefore)setReview(next);else void submit(next);
    }catch(error){setMessage(error instanceof Error?error.message:"Order unavailable.");}
  };
  const clickTitle=(side:"buy"|"sell",price:number)=>{
    if(!unlocked)return "Click to trade is locked";
    try{const order=domOrderDraft(symbol,side,ticket.quantity,price,model.reference??undefined);return `${side==="buy"?"Buy":"Sell"} ${order.type} · ${order.quantity} @ ${price} · No automatic SL/TP`;}
    catch{return "Enter a valid quantity and wait for a reference price";}
  };
  return (
    <div className="dom-panel" style={{"--dom-row":`${rowHeight}px`,"--dom-head":`${style.head}px`,"--dom-text":`${style.text}px`,"--dom-head-text":`${style.headText}px`,"--dom-chip":`${style.chip}px`,"--dom-chip-text":`${style.chipText}px`,"--dom-bid":style.bid,"--dom-ask":style.ask,"--dom-bid14":style.bid14,"--dom-bid30":style.bid30,"--dom-bid60":style.bid60,"--dom-ask14":style.ask14,"--dom-ask30":style.ask30,"--dom-ask60":style.ask60} as CSSProperties}>
      <header className="dom-heading">
        <div className="orderflow-title"><strong>DOM · {symbolLabel(symbol)}</strong><span>{reason ? "Depth unavailable" : `Live book · Step ${step}`}</span></div>
        <div className="flow-actions">
          <button className="button small" type="button" aria-label="Center DOM" title="Center on the reference price" disabled={!!reason || model.target === null} onClick={navigation.recenter}><Crosshair size={16} aria-hidden="true"/><span>Center</span></button>
          <button className="button small flow-icon-button" type="button" disabled={!!reason} onClick={() => navigation.move(1)} aria-label="Scroll DOM prices up"><ArrowUp size={16} aria-hidden="true"/></button>
          <button className="button small flow-icon-button" type="button" disabled={!!reason} onClick={() => navigation.move(-1)} aria-label="Scroll DOM prices down"><ArrowDown size={16} aria-hidden="true"/></button>
          <button className="button small" type="button" aria-label="DOM settings" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}><SlidersHorizontal size={14} aria-hidden="true"/> Settings</button>
          <button className="button small dom-paper-toggle" type="button" aria-expanded={paperOpen} aria-controls="dom-paper-tools" onClick={() => setPaperOpen(value => !value)}>Paper trade</button>
          {unlocked && <button className="button small dom-click-unlocked" type="button" onClick={() => { setUnlocked(false); setReview(null); }}><Lock size={14} aria-hidden="true"/> Lock ladder</button>}
        </div>
      </header>
      {paperOpen && <section id="dom-paper-tools" className="dom-paper-tools" aria-label="DOM paper trading">
        <div className="flow-actions">
          <span className={`mode-badge ${mode}`}>{mode === "replay" ? "REPLAY ACCOUNT" : "PAPER"}</span>
          <span className={`paper-source ${priceSource ?? "unknown"}`}>{priceSource ? paperSourceLabel(priceSource) : "Quote source unavailable"}</span>
        </div>
      <p className="paper-execution-status" role="status" data-testid="paper-execution-owner">{role.status==="primary"?"Live paper matching active in this tab":role.status==="standby"?"Live paper matching on standby":role.error}{mode==="replay"?" · Replay account belongs to this tab only":""}</p>
        <div className="flow-actions">
          <label>
            Size
            <input
              type="number"
              min={0}
              step="any"
              value={ticket.quantity}
              onChange={(e) => usePaperStore.getState().setTicket({ quantity: Number(e.target.value) })}
            />
          </label>
          <button
            className="button small buy"
            disabled={busy || !!reason} onClick={() => void place("buy")}
          >
            Buy market
          </button>
          <button
            className="button small sell"
            disabled={busy || !!reason} onClick={() => void place("sell")}
          >
            Sell market
          </button>
          <WorkingOrderControls symbol={symbol}/>
          <PositionActions symbol={symbol} closeLabel="Flatten" alwaysVisible/>
          <button className="button small" disabled={!orders.hasWorking} onClick={() => void paperCommands.cancelAll(symbol)}>
            Cancel orders
          </button>
        </div>
        <div className="flow-actions">
          <button className={`button small ${unlocked?"dom-click-unlocked":""}`} type="button" disabled={busy||!!reason} aria-pressed={unlocked} onClick={()=>{setUnlocked(value=>!value);setReview(null);}}>{unlocked?"Click to trade: unlocked":"Click to trade: locked"}</button>
          <label><input type="checkbox" checked={askBefore} onChange={event=>{setAskBefore(event.target.checked);setReview(null);}}/>Ask before placing</label>
        </div>
      </section>}
      {message && <p className="flow-status" role="status">{message}</p>}
      {reason && <p className="flow-status" role="status">{reason}</p>}
      {viewport.error && <p role="status" className="flow-status">{viewport.error}</p>}
      {settingsOpen && typeof document !== "undefined" && createPortal(
        <Modal title="DOM settings" className="flow-settings-dialog" onClose={() => { columnPointerCleanup.current?.(); setSettingsOpen(false); }}>
          <div className="form-body flow-settings-body">
            <div className="flow-option-fields">
              <label>Ladder view <select aria-label="DOM ladder view" value={domPreferences.view ?? "book"} onChange={event => setDomPreferences({ view: event.target.value === "configured" ? "configured" : "book" })}><option value="book">Bid · Price · Ask</option><option value="configured">Configured columns</option></select></label>
              <label>
                Group price step
                <select aria-label="Depth grouping" value={group} onChange={(e) => useWorkspaceStore.getState().setDomGroup(symbol,Number(e.target.value))}>
                  {[1, 5, 10, 50, 100].map((g) => (
                    <option key={g} value={g}>
                      ×{g}
                    </option>
                  ))}
                </select>
              </label>
              <label>Follow the market <select aria-label="DOM follow mode" value={navigation.mode} onChange={event=>setDomPreferences({follow:event.target.value as "auto"|"fixed"|"timed"})}><option value="auto">Auto</option><option value="fixed">Fixed</option><option value="timed">Timed</option></select></label>
              {navigation.mode === "timed" && <label>Recenter after <select aria-label="DOM recenter delay" value={navigation.delay} onChange={event=>setDomPreferences({delay:Number(event.target.value)})}>{[5,10,30,60].map(seconds=><option key={seconds} value={seconds*1000}>{seconds}s</option>)}</select></label>}
              <label>Execution units <select aria-label="DOM execution units" value={executionUnit} onChange={event => setDomPreferences({executionUnit:event.target.value as "base" | "quote"})}><option value="base">Base quantity</option><option value="quote">Quote value</option></select></label>
              <label>Highlight large orders <select aria-label="DOM large-order mode" value={highlight.mode} onChange={event=>setDomPreferences({highlight:event.target.value==="auto"?defaultDomHighlight():{mode:"fixed",value:largeThresholds?.large??1000}})}><option value="auto">Relative</option><option value="fixed">Set amount</option></select></label>
              {highlight.mode==="auto"?<label>Typical order × <select aria-label="DOM large-order multiple" value={highlight.multiplier} onChange={event=>setDomPreferences({highlight:{mode:"auto",multiplier:Number(event.target.value)}})}>{[2,3,5,10,20].map(value=><option key={value} value={value}>{value}×</option>)}</select></label>:<label>Quote amount <input aria-label="DOM large-order quote amount" type="number" min="0" step="any" value={amountDraft} onChange={event=>{const text=event.target.value;setAmountDraft(text);const value=Number(text);if(Number.isFinite(value)&&value>0)setDomPreferences({highlight:{mode:"fixed",value}});}}/></label>}
              {highlight.mode==="auto"&&!largeThresholds&&<span className="form-help">Relative highlighting needs six observed price levels in this viewport.</span>}
              {highlight.mode==="fixed"&&(!(Number(amountDraft)>0)||!Number.isFinite(Number(amountDraft)))&&<span className="form-help" role="status">Enter a positive quote amount; the previous threshold remains applied.</span>}
            </div>
            <details className="dom-column-settings dom-style-settings"><summary>Style</summary><div className="dom-column-list">
              <label>Zoom <select aria-label="DOM zoom" value={zoom} onChange={event=>setDomPreferences({zoom:Number(event.target.value)})}>{DOM_ZOOMS.map(value=><option key={value} value={value}>{value}%</option>)}</select></label>
              <button className="button small" type="button" aria-label="Zoom DOM out" disabled={zoom===70} onClick={()=>setDomPreferences({zoom:Math.max(70,zoom-10)})}>−</button><button className="button small" type="button" aria-label="Zoom DOM in" disabled={zoom===150} onClick={()=>setDomPreferences({zoom:Math.min(150,zoom+10)})}>+</button><button className="button small" type="button" onClick={()=>setDomPreferences({zoom:100})}>Reset DOM zoom</button>
              {(["bid","ask"] as const).map(side=><label className="dom-color-option" key={side}>{side==="bid"?"Bids and buys":"Asks and sells"}<input aria-label={`DOM ${side} color`} type="text" spellCheck={false} value={colorDraft[side]} onChange={event=>{const value=event.target.value;setColorDraft(current=>({...current,[side]:value}));if(validDomColor(value))setDomPreferences({colors:{...(useWorkspaceStore.getState().domPreferences.colors??defaultDomColors()),[side]:value}});}}/></label>)}
              <button className="button small" type="button" onClick={()=>{setDomPreferences({colors:defaultDomColors()});setColorDraft({bid:"#089981",ask:"#f23645"});}}>Reset DOM colors</button><p className="form-help">Colors use #RRGGBB. Incomplete edits keep the previous applied color.</p>
            </div></details>
            <details className="dom-column-settings"><summary>Columns</summary><div className="dom-column-list" role="list" aria-label="DOM column settings">
              {columnSettings.order.map((id,index)=>{const column=DOM_COLUMNS.find(c=>c.id===id)!;return <div role="listitem" data-dom-column={id} className="dom-column-option" key={id} draggable onDragStart={event=>{draggedColumn.current=id;event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",id);}} onDragEnd={()=>{draggedColumn.current=null;}} onDragOver={event=>{if(draggedColumn.current)event.preventDefault();}} onDrop={event=>{event.preventDefault();const from=draggedColumn.current;if(from)setColumnSettings(current=>reorderDomColumn(current,from,id));draggedColumn.current=null;}}>
                <span className="dom-column-handle" aria-hidden="true" title="Drag to reorder" onPointerDown={event=>beginColumnDrag(event,id)}>⋮⋮</span><label><input type="checkbox" aria-label={`Show DOM ${column.label}`} disabled={requiredDomColumn(id)} checked={requiredDomColumn(id)||columnSettings.visible[id]} onChange={event=>setColumnSettings(current=>({...current,visible:{...current.visible,[id]:event.target.checked}}))}/>{column.label}</label>
                <button className="button small" type="button" disabled={index===0} aria-label={`Move ${column.label} left`} onClick={()=>setColumnSettings(current=>shiftDomColumn(current,id,-1))}>↑</button><button className="button small" type="button" disabled={index===columnSettings.order.length-1} aria-label={`Move ${column.label} right`} onClick={()=>setColumnSettings(current=>shiftDomColumn(current,id,1))}>↓</button>
              </div>;})}
              <p className="form-help">Orders appear with an open position or working orders. P&amp;L appears with an open position, in {quote}, before fees.</p><button className="button small" type="button" onClick={()=>setColumnSettings(defaultDomColumns())}>Reset DOM columns</button>
            </div></details>
            <button className="button small" disabled={!executions} onClick={() => { executions?.reset(Date.now()); setNow(Date.now()); setExecutionRevision(value => value + 1); }}>Reset traded volume</button>
            <details className="flow-book-actions">
              <summary>Source details</summary>
              <div>
                <p className="form-help" role="status">{reason || `Observed top levels only · row spacing ${step} · book ${new Date(book!.time).toISOString()}. Offered quantities are not executed volume. ${model.grid?.source ?? "Grid unavailable"}${model.grid?.verified ? ` · last checked ${new Date(model.grid.checkedAt!).toISOString()}` : venueGrid.pending ? " · checking venue metadata" : ""}.${venueGrid.error ? ` Metadata refresh unavailable: ${venueGrid.error}` : ""}`}</p>
                <p className="form-help" role="status">{executed.error || (executions ? `Traded since ${new Date(executions.since).toISOString()} · ${executions.observations} collected live executions. Sold/Bought/Delta cover this panel interval only; gaps remain unknown. Executions use nearest grouped price; waiting orders remain outward-rounded base quantities.` : "Executed-volume counting requires a matching classified live exchange source. Replay, simulation and old retained trades are excluded.")}</p>
              </div>
            </details>
          </div>
        </Modal>, document.getElementById("native-chart-dialog-host") ?? document.body)}
      {!reason && <div ref={navigation.setElement} className={`dom-ladder dom-executions dom-navigable${allColumns ? "" : " dom-book-only"}`} role="table" aria-label="Depth of market" tabIndex={0} onPointerEnter={()=>navigation.hover(true)} onPointerLeave={()=>navigation.hover(false)} onKeyDown={event=>{
        if(event.target!==event.currentTarget)return;
        const delta=event.key==="ArrowUp"?1:event.key==="ArrowDown"?-1:event.key==="PageUp"?Math.max(1,navigation.halfRows):event.key==="PageDown"?-Math.max(1,navigation.halfRows):0;
        if(delta){event.preventDefault();navigation.move(delta);}else if(event.key==="Home"){event.preventDefault();navigation.recenter();}
      }} style={{ "--dom-columns":columnWidths.map(width=>`minmax(${width}px,1fr)`).join(" "),"--dom-min-width":`${columnWidths.reduce((sum,width)=>sum+width,0)}px` } as CSSProperties}>
        <div className="dom-row head" role="row">
          {columns.map(id=><span role="columnheader" data-column={id} key={id}>{id==="pnl"?`P&L (${quote})`:DOM_COLUMNS.find(c=>c.id===id)!.label}</span>)}
        </div>
        {rows.map((row) => {
          const prints = executed.rows?.get(row.price);
          const here = orders.byPrice.get(row.price) ?? [];
          const isPosition = position && positionPrice === row.price;
          const pnl=domPnlAtPrice(position,row.price);
          const cell=(id:DomColumnId)=>{
            if(id==="orders")return <span role="cell" className="dom-order-cell">{isPosition&&<span className="dom-position-label">{position.quantity>0?"Long":"Short"} {Math.abs(position.quantity)}</span>}{here.map(order=><button className={`dom-orders ${order.side}`} key={order.id} title={`Cancel ${order.side} ${order.type} ${order.quantity}`} onClick={()=>void paperCommands.cancelMany([order.id])}>{order.side==="buy"?"B":"S"} {({limit:"LMT",stop:"STP",stop_limit:"STP LMT",market:"MKT"}[order.type])} {order.quantity} ×</button>)}</span>;
            if(id==="pnl")return <span role="cell" className={`dom-executed ${(pnl??0)<0?"negative":"positive"}`} title={`Position mark-to-market in ${quote}, before fees and currency conversion`}>{pnl===null?"—":pnl.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}</span>;
            if (id === "bid" || id === "ask") {
              const side = id === "bid" ? "buy" : "sell";
              const size = id === "bid" ? row.bid : row.ask;
              const tier = domOrderTier(size, row.price, largeThresholds);
              const className = `dom-size ${id} ${tier > 0 ? "dom-large" : ""} ${tier === 2 ? "dom-block" : ""}`;
              const content = <><i style={{ width: `${size / maxSize * 100}%` }} aria-hidden="true"/><span>{size ? size.toLocaleString("en-US", { maximumSignificantDigits: 12 }) : ""}</span></>;
              return unlocked
                ? <button type="button" data-size-tier={tier} className={className} disabled={busy || !!reason} title={clickTitle(side, row.price)} onClick={() => place(side, row.price)}>{content}</button>
                : <span role="cell" data-size-tier={tier} className={className}>{content}</span>;
            }
            if(id==="price")return <PriceLevelMenu key={priceMenuContext} price={row.price} draw={() => drawPrice(row.price)}>{actions => <span className={`dom-price mono ${model.target!==null&&ladderIndex(row.price,step)===model.target?"dom-current-price":""}`}
              tabIndex={0} title="Right-click or press Shift+F10 for price actions"
              {...actions}>{String(row.price)}</span>}</PriceLevelMenu>;
            if(id==="last")return <span role="cell" className={`dom-executed ${prints?.lastSide==="sell"?"negative":"positive"}`}>{prints?.last==null?"—":executionNumber(prints.last)}</span>;
            const value=id==="sold"?prints?.sold:id==="bought"?prints?.bought:id==="delta"?prints?.delta:prints?.volume;
            return <span role="cell" className={`dom-executed ${id==="sold"||id==="delta"&&(value??0)<0?"negative":id==="bought"||id==="delta"?"positive":""}`}>{executionNumber(value)}</span>;
          };
          return (
            <Fragment key={row.price}>
            {row.omittedAbove && <div role="row" className="dom-spread-gap"><span role="cell">Spread gap · {row.omittedAbove} empty price rows omitted</span></div>}
            <div className={`dom-row ${row.bid ? "has-bid" : ""} ${row.ask ? "has-ask" : ""} ${isPosition ? "position" : ""}`} role="row" key={row.price}>
              {columns.map(id=><Fragment key={id}>{cell(id)}</Fragment>)}
            </div>
            </Fragment>
          );
        })}
      </div>}
      {review&&typeof document!=="undefined"&&createPortal(<Modal title="Place this paper order?" className="dom-order-review" onClose={()=>setReview(null)}><div className="form-body"><p><strong>{review.order.side==="buy"?"Buy":"Sell"} {review.order.type}</strong> · {symbolLabel(review.order.symbol)}</p><p>Quantity: {review.order.quantity}</p>{review.order.type!=="market"&&<p>{review.order.type==="stop"?"Trigger":"Limit"} price: {review.order.price??review.order.stopPrice}</p>}<p>No automatic stop loss or take profit.</p><p className="form-help">Paper account · simulated money</p></div><div className="modal-actions"><button type="button" className="button" onClick={()=>setReview(null)}>Cancel</button><button type="button" className="button primary" disabled={busy||!!reason||domOrderContextKey(review.context)!==domOrderContextKey(captureDomOrderContext())} onClick={()=>void submit(review)}>Place paper order</button></div></Modal>,document.getElementById("native-chart-dialog-host")??document.body)}
    </div>
  );
}
