"use client";
import {useEffect} from "react";
import {marketService} from "@/lib/market/service";
import {usePaperStore} from "@/stores/usePaperStore";
import {useWorkspaceStore} from "@/stores/useWorkspaceStore";
import {useChartStore} from "@/stores/useChartStore";
import {usePaperOwnership} from "./usePaperOwnership";
import {paperExecutionOwner,editLivePaper} from "@/lib/trading/paperOwnership";
import {executableQuote} from "@/lib/trading/quotes";
import {PaperPricePump} from "@/lib/trading/paperPricePump";
/** Quote displays and Replay are local. One independently elected owner matches the shared live account. */
export function usePaperTrading(){
  const role=usePaperOwnership();
  const feedEpoch=useChartStore(s=>s.feedEpoch);
  useEffect(()=>{
    const update=(symbol:string,price:number,simulated:boolean)=>usePaperStore.getState().observePrice(symbol,price,simulated);
    const offTick=marketService.onTick(t=>update(t.symbol,t.price,t.simulated)),offQuote=marketService.onQuote(q=>update(q.symbol,q.price,q.simulated));
    const offBook=marketService.onBook(book=>usePaperStore.getState().observeBook(book));
    const initialBook=useChartStore.getState().orderBook;if(initialBook)usePaperStore.getState().observeBook(initialBook);
    const offFeed=useChartStore.subscribe((state,before)=>{if(state.feedEpoch!==before.feedEpoch)usePaperStore.getState().clearObservedPrices();});
    const mode=(active:boolean)=>{const state=usePaperStore.getState(),chart=useChartStore.getState();if(active&&state.mode!=="replay")state.startReplay(chart.dataSources[`${chart.symbol}:${chart.timeframe}`]==="simulation");else if(!active)state.setMode("live");};
    mode(useWorkspaceStore.getState().replay.active);
    const offReplay=useWorkspaceStore.subscribe((state,before)=>{if(state.replay.active!==before.replay.active)mode(state.replay.active);});
    return()=>{offTick();offQuote();offReplay();offFeed();offBook();};
  },[]);
  useEffect(()=>{
    if(role.status!=="primary")return;
    const lease=paperExecutionOwner(),valid=()=>lease.owns(role.epoch)&&useChartStore.getState().feedEpoch===feedEpoch;
    const pump=new PaperPricePump({valid,write:(batch,guard)=>editLivePaper(state=>{for(const observation of batch)state.tick(observation.symbol,observation.price,observation.time,observation.simulated,observation.quote);},guard),failed:error=>{lease.fail(error);useChartStore.getState().toast("Paper matching stopped",error instanceof Error?error.message:String(error),"error");}});
    const observe=(symbol:string,price:number,simulated:boolean)=>{const account=usePaperStore.getState().live;if(account.positions.some(p=>p.symbol===symbol)||account.orders.some(o=>o.symbol===symbol&&o.status==="working")){const time=Date.now(),quote=executableQuote(usePaperStore.getState().liveBooks[symbol],symbol,simulated,time);pump.push({symbol,price,time,simulated,quote});}};
    const offOwnership=lease.subscribe(()=>{if(!valid())pump.stop();});
    const offTick=marketService.onTick(t=>observe(t.symbol,t.price,t.simulated)),offQuote=marketService.onQuote(q=>observe(q.symbol,q.price,q.simulated));
    const offBook=marketService.onBook(book=>{const paper=usePaperStore.getState(),price=paper.livePrices[book.symbol],source=paper.liveSources[book.symbol];if(price&&source!==undefined&&book.simulated===(source==="simulation"))observe(book.symbol,price,book.simulated);});
    return()=>{offTick();offQuote();offBook();offOwnership();pump.stop();};
  },[role.status,role.epoch,feedEpoch]);
}
