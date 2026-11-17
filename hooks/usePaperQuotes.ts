"use client";
import {useEffect,useState,useMemo} from "react";
import {usePaperStore} from "@/stores/usePaperStore";
import {executableQuote,liquidationPrices} from "@/lib/trading/quotes";
import {activeAccount} from "@/stores/usePaperStore";
/** Expire idle books in the visible ticket even when the feed stops delivering events. */
export function usePaperQuote(symbol:string){
  const book=usePaperStore(s=>s.liveBooks[symbol]),source=usePaperStore(s=>s.liveSources[symbol]),mode=usePaperStore(s=>s.mode);
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  return mode==="live"?executableQuote(book,symbol,source===undefined?undefined:source==="simulation",Math.max(now,Date.now())):undefined;
}
export function usePaperMarkPrices(){
  const prices=usePaperStore(s=>s.prices),books=usePaperStore(s=>s.liveBooks),sources=usePaperStore(s=>s.liveSources),mode=usePaperStore(s=>s.mode),account=usePaperStore(activeAccount);
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  return useMemo(()=>mode==="live"?liquidationPrices(account,prices,books,sources,Math.max(now,Date.now())):prices,[account,prices,books,sources,mode,now]);
}
