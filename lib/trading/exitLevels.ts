export interface ExitLevel {quantity:number;takeProfit:number|null;stopLoss:number|null}
/** Shared draft/order validation; omit quantity only for stored ticket structure. */
export function validateExitLevels(value:unknown,quantity?:number):string|null{
  if(!Array.isArray(value)||value.length>4||Array.from(value).some(l=>!l||typeof l!=="object"||Object.keys(l).some(k=>!["quantity","takeProfit","stopLoss"].includes(k))))return "Use up to four valid exit levels.";
  const levels=value as ExitLevel[];
  if(levels.some(l=>!Number.isFinite(l.quantity)||l.quantity<1e-12||[l.takeProfit,l.stopLoss].some(v=>v!==null&&(!Number.isFinite(v)||!(v!>0)))||l.takeProfit===null&&l.stopLoss===null))return "Each exit needs a positive quantity and at least one positive price.";
  if(levels.length>1&&levels.some(l=>l.takeProfit===null||l.stopLoss===null))return "Multiple exit levels require both take profit and stop loss in every pair.";
  const total=levels.reduce((sum,l)=>sum+l.quantity,0);
  if(!Number.isFinite(total)||quantity!==undefined&&(!Number.isFinite(quantity)||total>quantity&&total-quantity>Math.max(total,quantity)*Number.EPSILON*8))return "Exit quantities cannot exceed the order quantity.";
  return null;
}
