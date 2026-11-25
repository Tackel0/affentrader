"use client";
import {useRef,useState} from "react";
import {useChartStore} from "@/stores/useChartStore";
import {usePaperStore} from "@/stores/usePaperStore";
import {useWorkspaceStore} from "@/stores/useWorkspaceStore";
import {usePaperQuote} from "@/hooks/usePaperQuotes";
import {tradeFromChart} from "@/lib/trading/chartTrading";
import {formatPrice} from "@/lib/symbols";
import type {Side} from "@/lib/trading/broker";
import {ChartPresetSelect} from "./OrderPresets";
import {useOrderPresetStore} from "@/stores/useOrderPresetStore";
export function ChartTrading({symbol,cellId}:{symbol:string;cellId:string}){
  const showButtons=useChartStore(s=>s.chartTrading.showButtons);
  if(!showButtons)return null;
  return <ChartTradingControls symbol={symbol} cellId={cellId}/>;
}
function ChartTradingControls({symbol,cellId}:{symbol:string;cellId:string}){
  const presets=useOrderPresetStore(s=>s.presets),selected=useOrderPresetStore(s=>s.selectedId),preset=presets.find(p=>p.id===selected);
  const settings=useChartStore(s=>s.chartTrading),last=usePaperStore(s=>s.prices[symbol]),quantity=usePaperStore(s=>s.ticket.quantity),mode=usePaperStore(s=>s.mode),active=useWorkspaceStore(s=>s.activeId);
  const book=usePaperQuote(symbol),lock=useRef(false),[busy,setBusy]=useState(false);
  const unavailable=!(last>0)||!Number.isFinite(last)||mode==="replay"&&active!==cellId;
  const submit=async(side:Side)=>{if(lock.current)return;lock.current=true;setBusy(true);try{await tradeFromChart(symbol,cellId,side);}catch(error){useChartStore.getState().toast("Chart order unavailable",error instanceof Error?error.message:String(error),"error");}finally{lock.current=false;setBusy(false);}};
  return <div className="chart-trading-controls" role="group" aria-label={`Chart trading ${symbol}`} onPointerDown={event=>event.stopPropagation()}>
    <ChartPresetSelect symbol={symbol}/>
    <button type="button" className="chart-side sell" aria-label={`Sell ${symbol} from chart`} disabled={busy||unavailable} title={`${mode==="replay"?"Replay":"Paper"} sell · ${settings.instantOrders?(preset?`place ${preset.name} now`:"place market order now"):(preset?`open ${preset.name} ticket`:"open order ticket")}${book?" at bid":" using last/bar price"}`} onClick={()=>void submit("sell")}><span>{Number.isFinite(last)?formatPrice(book?.bid??last):"—"}</span><small>SELL</small></button>
    {settings.instantOrders?<label className="chart-order-quantity"><span className="sr-only">Chart order quantity</span><input aria-label={`Chart order quantity ${symbol}`} type="number" min="0" step="any" value={quantity} onChange={event=>usePaperStore.getState().setTicket({quantity:Number(event.target.value)})}/></label>:<span className="chart-spread mono" title={book?"Bid/ask spread":"Last/bar-price model; no matching fresh depth"}>{book?formatPrice(book.ask-book.bid):mode==="replay"?"BAR":"LAST"}</span>}
    <button type="button" className="chart-side buy" aria-label={`Buy ${symbol} from chart`} disabled={busy||unavailable} title={`${mode==="replay"?"Replay":"Paper"} buy · ${settings.instantOrders?"place market order now":"open order ticket"}${book?" at ask":" using last/bar price"}`} onClick={()=>void submit("buy")}><span>{Number.isFinite(last)?formatPrice(book?.ask??last):"—"}</span><small>BUY</small></button>
  </div>;
}
