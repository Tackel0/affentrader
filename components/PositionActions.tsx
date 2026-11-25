"use client";
import {useRef,useState} from "react";
import {useChartStore} from "@/stores/useChartStore";
import {activeAccount,usePaperStore} from "@/stores/usePaperStore";
import {useWorkspaceStore} from "@/stores/useWorkspaceStore";
import {paperCommands,captureCloseReview,captureProtectionReview,type CloseReview,type ProtectionReview} from "@/lib/trading/paperCommands";
import {ClosePositionDialog} from "./ClosePositionDialog";
import {PositionProtectionDialog} from "./PositionProtectionDialog";
import {activateTradingChart} from "@/lib/trading/chartTrading";
import {symbolLabel} from "@/lib/symbolId";
import {usePaperQuote} from "@/hooks/usePaperQuotes";
import {formatPrice,formatVolume} from "@/lib/symbols";
import {unrealizedPnl,type Position} from "@/lib/trading/broker";
export function PositionActions({symbol,cellId,closeLabel="Close",alwaysVisible=false}:{symbol:string;cellId?:string;closeLabel?:string;alwaysVisible?:boolean}){
  const mode=usePaperStore(s=>s.mode),position=usePaperStore(s=>activeAccount(s).positions.find(p=>p.symbol===symbol)),active=useWorkspaceStore(s=>s.activeId);
  const lock=useRef(false),[busy,setBusy]=useState(false),[review,setReview]=useState<CloseReview|null>(null),[protection,setProtection]=useState<ProtectionReview|null>(null);
  if(!position&&!alwaysVisible&&!review&&!protection)return null;
  const disabled=!position||busy||mode==="replay"&&cellId!==undefined&&active!==cellId;
  const run=async(kind:"reverse"|"close"|"protect")=>{
    if(lock.current)return;lock.current=true;setBusy(true);
    try{if(cellId)activateTradingChart(symbol,cellId);if(kind==="protect"){setProtection(captureProtectionReview(symbol));return;}if(kind==="close"&&!useChartStore.getState().chartTrading.instantOrders){setReview(captureCloseReview(symbol));return;}await paperCommands[kind](symbol);}
    catch(error){useChartStore.getState().toast("Position action unavailable",error instanceof Error?error.message:String(error),"error");}
    finally{lock.current=false;setBusy(false);}
  };
  return <span className="position-action-buttons">
    <button type="button" className="button small" aria-label={`Manage ${symbolLabel(symbol)} ${mode==="replay"?"Replay":"paper"} protection`} disabled={disabled} onClick={()=>void run("protect")}>TP/SL</button>
    <button type="button" className="button small" aria-label={`Reverse ${symbolLabel(symbol)} ${mode==="replay"?"Replay":"paper"} position`} disabled={disabled} title="Reverse with a double-size market order. Old protective exits are canceled only on success." onClick={()=>void run("reverse")}>Reverse</button>
    <button type="button" className="button small" aria-label={`Close ${symbolLabel(symbol)} ${mode==="replay"?"Replay":"paper"} position`} disabled={disabled} onClick={()=>void run("close")}>{closeLabel}</button>
    {review?<ClosePositionDialog symbol={symbol} review={review} onClose={()=>setReview(null)}/>:null}
    {protection?<PositionProtectionDialog symbol={symbol} review={protection} onClose={()=>setProtection(null)}/>:null}
  </span>;
}
export function ChartPositionBar({symbol,cellId}:{symbol:string;cellId:string}){
  const position=usePaperStore(s=>activeAccount(s).positions.find(p=>p.symbol===symbol));
  if(!position)return null;
  return <ChartPositionBarContent symbol={symbol} cellId={cellId} position={position}/>;
}
function ChartPositionBarContent({symbol,cellId,position}:{symbol:string;cellId:string;position:Position}){
  const last=usePaperStore(s=>s.prices[symbol]),mode=usePaperStore(s=>s.mode),book=usePaperQuote(symbol);
  const mark=book?(position.quantity>0?book.bid:book.ask):last,pnl=mark?unrealizedPnl(position,mark):undefined;
  return <div className="chart-position-bar" aria-label={`Position ${symbol}`}>
    <span className={position.quantity>0?"positive":"negative"}>{position.quantity>0?"LONG":"SHORT"} {formatVolume(Math.abs(position.quantity))}</span>
    <span className="mono" title={`${mode==="replay"?"Replay":"Paper"} · entry ${formatPrice(position.avgPrice)} · ${book?"bid/ask exit mark":"last/bar exit mark"}`}>{pnl===undefined?"—":`${pnl>=0?"+":""}${pnl.toFixed(2)}`} USDT</span>
    <PositionActions symbol={symbol} cellId={cellId}/>
  </div>;
}
