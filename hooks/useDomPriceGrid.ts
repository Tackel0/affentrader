"use client";
import { useEffect, useState } from "react";
import { loadPriceGridMetadata } from "@/lib/market/priceGridMetadata";
import { watchDomGrid, type DomGridState } from "@/lib/orderflow/domPriceGrid";
export function useDomPriceGrid(symbol:string,key:string,enabled:boolean):DomGridState {
  const [current,setCurrent]=useState<{key:string;value:DomGridState}|null>(null);
  useEffect(()=>{
    if(!enabled){setCurrent(null);return;}
    return watchDomGrid(symbol,loadPriceGridMetadata,value=>setCurrent({key,value}));
  },[symbol,key,enabled]);
  return enabled && current?.key===key ? current.value : {pending:enabled,error:""};
}
