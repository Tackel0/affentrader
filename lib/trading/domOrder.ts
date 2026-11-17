import type { NewOrder, Order, Side } from "./broker";
import { ladderGrid } from "@/lib/orderflow/depthLadder";

export function workingDomOrders(orders: readonly Order[], symbol: string, step: number) {
  const grid = ladderGrid(step);
  const byPrice = new Map<number, Order[]>();
  let hasWorking = false;
  for (const order of orders) {
    if (order.symbol !== symbol || order.status !== "working") continue;
    hasWorking = true;
    const level = order.type === "limit" || (order.type === "stop_limit" && order.triggered) ? order.price : order.stopPrice;
    if (level === undefined) continue;
    try {
      const price = grid.price(level, order.side === "buy" ? "bid" : "ask");
      const existing = byPrice.get(price);
      if (existing) existing.push(order);
      else byPrice.set(price, [order]);
    } catch { /* Unrepresentable orders have no row at this grouping. */ }
  }
  return { byPrice, hasWorking };
}
export interface DomOrderContext {
  symbol:string;timeframe:string;feedMode:string;feedEpoch:number;marketEpoch:number;source:string;
  replay:boolean;paperMode:string;paperEpoch:number;quantity:number;cellId:string;
}
export interface DomOrderReview { order:NewOrder; context:DomOrderContext; ladder:boolean }
export function domOrderDraft(symbol:string,side:Side,quantity:number,price?:number,reference?:number):NewOrder {
  if(!Number.isFinite(quantity)||quantity<=0)throw new Error("Enter a positive order quantity.");
  if(price===undefined)return {symbol,side,quantity,type:"market"};
  if(!Number.isFinite(price)||price<=0||typeof reference!=="number"||!Number.isFinite(reference)||reference<=0)throw new Error("A current reference price is required for a ladder order.");
  const stop=side==="buy"?price>reference:price<reference;
  return {symbol,side,quantity,type:stop?"stop":"limit",...(stop?{stopPrice:price}:{price})};
}
export function domOrderContextKey(c:DomOrderContext) {
  return JSON.stringify([c.symbol,c.timeframe,c.feedMode,c.feedEpoch,c.marketEpoch,c.source,c.replay,c.paperMode,c.paperEpoch,c.quantity,c.cellId]);
}
export function assertDomOrderReview(review:DomOrderReview,current:DomOrderContext) {
  if(domOrderContextKey(review.context)!==domOrderContextKey(current) || review.order.symbol!==current.symbol || review.order.quantity!==current.quantity)
    throw new Error("The chart, account or quantity changed. Review the current order again.");
  if(current.replay || current.paperMode!=="live" || current.feedMode==="simulation" || current.source!=="exchange")
    throw new Error("DOM orders require a matching classified live exchange source.");
}
