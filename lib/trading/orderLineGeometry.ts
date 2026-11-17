import type {Order} from "./broker";
export interface OrderLineLevel {id:string;order:Order;field:"price"|"stopPrice";price:number;label:string;color:string}
export interface OrderLinePlacement extends OrderLineLevel {y:number;labelY:number}
export function orderLineLevels(orders:readonly Order[],symbol:string):OrderLineLevel[]{
  return orders.filter(o=>o.symbol===symbol&&o.status==="working"&&o.type!=="market").flatMap(order=>{
    const color=order.note?.startsWith("Take profit")?"#089981":order.note?.startsWith("Stop loss")?"#f23645":order.side==="buy"?"#2962ff":"#ff9800";
    const fields:("price"|"stopPrice")[]=order.type==="limit"||order.triggered?["price"]:order.type==="stop"?["stopPrice"]:["stopPrice","price"];
    return fields.flatMap(field=>{const price=order[field];return price!==undefined&&Number.isFinite(price)&&price>0?[{id:`${order.id}:${field}`,order,field,price,color,label:`${order.note?.startsWith("Take profit")?"TP":order.note?.startsWith("Stop loss")?"SL":order.side.toUpperCase()} ${order.quantity} ${field==="stopPrice"?"STOP":"LIMIT"}`}]:[];});
  });
}
/** Pack visible labels without changing their underlying price coordinates. */
export function placeOrderLines(levels:readonly OrderLineLevel[],priceToY:(price:number)=>number,top:number,height:number,rowHeight=22):OrderLinePlacement[]{
  if(!Number.isFinite(top)||!Number.isFinite(height)||height<rowHeight||!Number.isFinite(rowHeight)||rowHeight<=0)return [];
  const low=top+rowHeight/2,high=top+height-rowHeight/2,capacity=Math.floor(height/rowHeight);
  const visible=levels.map(level=>({...level,y:priceToY(level.price),labelY:0})).filter(line=>Number.isFinite(line.y)&&line.y>=low&&line.y<=high).sort((a,b)=>a.y-b.y||a.id.localeCompare(b.id)).slice(0,capacity);
  for(let i=0;i<visible.length;i++)visible[i].labelY=Math.max(visible[i].y,i?visible[i-1].labelY+rowHeight:low);
  for(let i=visible.length-1;i>=0;i--)visible[i].labelY=Math.min(visible[i].labelY,i===visible.length-1?high:visible[i+1].labelY-rowHeight);
  return visible;
}
export function draggedOrderPrice(originalY:number,deltaY:number,yToPrice:(y:number)=>number):number|null{
  if(!Number.isFinite(originalY)||!Number.isFinite(deltaY))return null;
  const price=yToPrice(originalY+deltaY);return Number.isFinite(price)&&price>0?Number(price.toPrecision(12)):null;
}
