"use client";
import {useEffect,useState} from "react";
import {bindOrderLineEditor,type OrderLineReview} from "@/lib/trading/chartOrderLines";
import {activateTradingChart} from "@/lib/trading/chartTrading";
import {useChartStore} from "@/stores/useChartStore";
import {OrderModification} from "./OrderModification";
export function ChartOrderEditor({layerCellId,cellId,symbol}:{layerCellId:string;cellId:string;symbol:string}){
  const [review,setReview]=useState<OrderLineReview|null>(null);
  useEffect(()=>bindOrderLineEditor(layerCellId,next=>{try{activateTradingChart(symbol,cellId);setReview(next);}catch(error){useChartStore.getState().toast("Order unavailable",error instanceof Error?error.message:String(error),"error");}}),[layerCellId,cellId,symbol]);
  return review?<OrderModification order={review.order} draft={review.draft} reviewContext={review.context} onClose={()=>setReview(null)}/>:null;
}
