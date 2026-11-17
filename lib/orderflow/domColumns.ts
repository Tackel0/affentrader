import { unrealizedPnl, type Position } from "@/lib/trading/broker";
export const DOM_COLUMNS = [
  {id:"orders",label:"Orders",width:100}, {id:"pnl",label:"P&L",width:85},
  {id:"sold",label:"Sold",width:65}, {id:"bid",label:"Bid size",width:65},
  {id:"price",label:"Price",width:88}, {id:"ask",label:"Ask size",width:65},
  {id:"bought",label:"Bought",width:65}, {id:"delta",label:"Delta",width:65},
  {id:"volume",label:"Volume",width:65}, {id:"last",label:"Last (5s)",width:65},
] as const;
export type DomColumnId=typeof DOM_COLUMNS[number]["id"];
export interface DomColumns {order:DomColumnId[];visible:Record<DomColumnId,boolean>}
export const requiredDomColumn=(id:DomColumnId)=>id==="bid"||id==="price"||id==="ask";
export function defaultDomColumns():DomColumns {
  return {order:DOM_COLUMNS.map(c=>c.id),visible:{orders:true,pnl:false,sold:true,bid:true,price:true,ask:true,bought:true,delta:true,volume:false,last:false}};
}
export function shownDomColumns(value:DomColumns,hasPosition:boolean,hasOrders:boolean) {
  return value.order.filter(id=>(requiredDomColumn(id)||value.visible[id]) && (id!=="pnl"||hasPosition) && (id!=="orders"||hasPosition||hasOrders));
}
export function reorderDomColumn(value:DomColumns,id:DomColumnId,before:DomColumnId):DomColumns {
  if(id===before||!value.order.includes(id)||!value.order.includes(before))return value;
  const order=value.order.filter(item=>item!==id);order.splice(order.indexOf(before),0,id);return {...value,order};
}
export function shiftDomColumn(value:DomColumns,id:DomColumnId,offset:-1|1):DomColumns {
  const index=value.order.indexOf(id),target=index+offset;if(index<0||target<0||target>=value.order.length)return value;
  const order=[...value.order];[order[index],order[target]]=[order[target],order[index]];return {...value,order};
}
export function domPnlAtPrice(position:Position|undefined,price:number):number|null {
  if(!position||!Number.isFinite(position.quantity)||position.quantity===0||!Number.isFinite(position.avgPrice)||position.avgPrice<=0||!Number.isFinite(price)||price<=0)return null;
  const value=unrealizedPnl(position,price);return Number.isFinite(value)?value===0?0:value:null;
}
