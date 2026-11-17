import {positionOf,type Account,type Order,type Prices} from "./broker";
import {validExecutionQuote,type ExecutableQuote} from "./quotes";
import type {PaperExecutionSource} from "./executionSource";
export interface PositionExitLevel {quantity:number;takeProfit:number|null;stopLoss:number|null}
export interface ProtectionResult {account:Account;ok:boolean;error?:string;orders:Order[]}
export const protectiveOrders=(account:Account,symbol:string)=>account.orders.filter(o=>o.symbol===symbol&&o.status==="working"&&o.reduceOnly);
export function protectionSignature(account:Account,symbol:string){return JSON.stringify(protectiveOrders(account,symbol).map(o=>({id:o.id,revision:o.revision??0,side:o.side,type:o.type,quantity:o.quantity,price:o.price,stopPrice:o.stopPrice,oco:o.oco,triggered:o.triggered})).sort((a,b)=>a.id.localeCompare(b.id)));}
export function protectionLevels(account:Account,symbol:string):PositionExitLevel[]|null{
  const groups=new Map<string,Order[]>(),position=positionOf(account,symbol);
  for(const order of protectiveOrders(account,symbol)){const key=order.oco??order.id;groups.set(key,[...(groups.get(key)??[]),order]);}
  if(groups.size>4)return null;
  const result:PositionExitLevel[]=[];
  for(const orders of groups.values()){
    const tp=orders.filter(o=>o.type==="limit"),sl=orders.filter(o=>o.type==="stop");
    if(!position||orders.length!==tp.length+sl.length||tp.length>1||sl.length>1||orders.some(o=>o.side!==(position.quantity>0?"sell":"buy")||o.quantity!==orders[0].quantity))return null;
    result.push({quantity:orders[0].quantity,takeProfit:tp[0]?.price??null,stopLoss:sl[0]?.stopPrice??null});
  }
  return result.length>1&&result.some(l=>l.takeProfit===null||l.stopLoss===null)?null:result;
}
const normalized=(levels:readonly PositionExitLevel[])=>JSON.stringify(levels.map(l=>({quantity:l.quantity,takeProfit:l.takeProfit,stopLoss:l.stopLoss})).sort((a,b)=>a.quantity-b.quantity||(a.takeProfit??0)-(b.takeProfit??0)||(a.stopLoss??0)-(b.stopLoss??0)));
/** Replace reviewed protection atomically. Invalid edits retain all existing orders. */
export function setPositionProtection(source:Account,symbol:string,levels:readonly PositionExitLevel[],prices:Prices,time:number,executionSource?:PaperExecutionSource,quote?:ExecutableQuote):ProtectionResult{
  const fail=(error:string):ProtectionResult=>({account:source,ok:false,error,orders:[]}),position=positionOf(source,symbol),old=protectiveOrders(source,symbol);
  if(!position||!Number.isFinite(position.quantity)||Math.abs(position.quantity)<1e-12)return fail("No open position is available to protect.");
  if(!Array.isArray(levels)||levels.length>4||Array.from(levels).some(l=>!l||typeof l!=="object"||Object.keys(l).some(k=>!["quantity","takeProfit","stopLoss"].includes(k))))return fail("Use up to four valid exit levels.");
  if(levels.some(l=>!Number.isFinite(l.quantity)||l.quantity<1e-12||[l.takeProfit,l.stopLoss].some(v=>v!==null&&(!Number.isFinite(v)||!(v!>0)))||l.takeProfit===null&&l.stopLoss===null))return fail("Each exit needs a positive quantity and at least one positive price.");
  if(levels.length>1&&levels.some(l=>l.takeProfit===null||l.stopLoss===null))return fail("Multiple exit levels require both take profit and stop loss in every pair.");
  const total=levels.reduce((sum,l)=>sum+l.quantity,0),size=Math.abs(position.quantity);
  if(!Number.isFinite(total)||total>size&&total-size>Math.max(total,size)*Number.EPSILON*8)return fail("Exit quantities cannot exceed the current position size.");
  if(!Number.isFinite(time)||time<Math.max(position.openedAt,...old.map(o=>Math.max(o.createdAt,o.modifiedAt??o.createdAt))))return fail("The protection clock is older than the position or its exits.");
  const existing=protectionLevels(source,symbol);if(existing&&normalized(existing)===normalized(levels))return{account:source,ok:true,orders:old};
  if(levels.length){
    const last=prices[symbol];if(!Number.isFinite(last)||last<=0)return fail("A current market observation is required to set protection.");
    const book=validExecutionQuote(quote,time)&&((executionSource==="market"&&!quote.simulated)||(executionSource==="simulation"&&quote.simulated))?quote:undefined,long=position.quantity>0,tpReference=book?(long?Math.max(last,book.bid):Math.min(last,book.ask)):last;
    if(levels.some(l=>l.takeProfit!==null&&(long?l.takeProfit<=tpReference:l.takeProfit>=tpReference)))return fail("Take profit must be beyond the current market on the exit side.");
    if(levels.some(l=>l.stopLoss!==null&&(long?l.stopLoss>=last:l.stopLoss<=last)))return fail("Stop loss must be on the opposite side of the current last price.");
  }
  const count=levels.reduce((sum,l)=>sum+Number(l.takeProfit!==null)+Number(l.stopLoss!==null),0);
  if(!Number.isSafeInteger(source.seq+count))return fail("The account reached its order identifier limit.");
  const account=structuredClone(source);for(const order of protectiveOrders(account,symbol))order.status="canceled";
  const orders:Order[]=[];levels.forEach((level,index)=>{
    const base={symbol,side:position.quantity>0?"sell" as const:"buy" as const,quantity:level.quantity,reduceOnly:true,status:"working" as const,createdAt:time,createdSource:executionSource,oco:`oco-position-${symbol}-${source.seq+1}-${index}`};
    if(level.takeProfit!==null)orders.push({...base,id:`ord-${++account.seq}`,type:"limit",price:level.takeProfit,note:`Take profit for position ${symbol}`});
    if(level.stopLoss!==null)orders.push({...base,id:`ord-${++account.seq}`,type:"stop",stopPrice:level.stopLoss,note:`Stop loss for position ${symbol}`});
  });account.orders.push(...orders);return{account,ok:true,orders};
}
