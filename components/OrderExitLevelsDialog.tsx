"use client";
import {useRef,useState,type FormEvent} from "react";
import {createPortal} from "react-dom";
import {validateExitLevels,type ExitLevel} from "@/lib/trading/exitLevels";
import {symbolLabel} from "@/lib/symbolId";
import {Modal} from "./ui";
interface Row {key:number;quantity:string;takeProfit:string;stopLoss:string}
export function OrderExitLevelsDialog({symbol,quantity,levels,contextKey,onApply,onClose}:{symbol:string;quantity:number;levels?:ExitLevel[];contextKey:string;onApply:(levels:ExitLevel[]|undefined)=>void;onClose:()=>void}){
  const [initial]=useState(()=>({symbol,quantity,contextKey})),serial=useRef(5),[rows,setRows]=useState<Row[]>(()=>levels?.length?levels.map((l,key)=>({key,quantity:String(l.quantity),takeProfit:l.takeProfit===null?"":String(l.takeProfit),stopLoss:l.stopLoss===null?"":String(l.stopLoss)})):[{key:0,quantity:String(quantity),takeProfit:"",stopLoss:""}]),[error,setError]=useState("");
  const total=rows.reduce((sum,l)=>sum+Number(l.quantity),0),stale=contextKey!==initial.contextKey;
  const update=(key:number,field:"quantity"|"takeProfit"|"stopLoss",value:string)=>{setRows(current=>current.map(row=>row.key===key?{...row,[field]:value}:row));setError("");};
  // Portal form events still bubble through the React tree into the order ticket.
  const apply=(event:FormEvent)=>{event.preventDefault();event.stopPropagation();if(stale)return;const next=rows.map(row=>({quantity:Number(row.quantity),takeProfit:row.takeProfit===""?null:Number(row.takeProfit),stopLoss:row.stopLoss===""?null:Number(row.stopLoss)})),error=validateExitLevels(next,initial.quantity);if(error){setError(error);return;}onApply(next.length?next:undefined);};
  if(typeof document==="undefined")return null;
  return createPortal(<Modal title="Order exit levels" className="position-protection-modal" onClose={onClose}><form onSubmit={apply}><div className="form-body">
    <p>{symbolLabel(initial.symbol)} · Order quantity {initial.quantity}</p><div className="protection-levels">
      {rows.map((row,index)=><div className="protection-level" key={row.key}><div className="protection-level-title"><strong>Exit level {index+1}</strong><button type="button" className="button small" aria-label={`Remove order exit level ${index+1}`} onClick={()=>{setRows(current=>current.filter(l=>l.key!==row.key));setError("");}}>Remove</button></div><div className="protection-level-fields">{([['quantity','Quantity'],['takeProfit','Take profit'],['stopLoss','Stop loss']] as const).map(([field,label])=><label key={field}>{label}<input aria-label={`Order exit level ${index+1} ${label.toLowerCase()}`} type="number" min="0" step="any" required={field==="quantity"} value={row[field]} onInput={event=>update(row.key,field,event.currentTarget.value)} onChange={event=>update(row.key,field,event.target.value)}/></label>)}</div></div>)}
      <button type="button" className="button" disabled={rows.length>=4} onClick={()=>{const key=serial.current++;setRows(current=>[...current,{key,quantity:String(Math.max(0,Number((initial.quantity-total).toPrecision(12)))),takeProfit:"",stopLoss:""}]);setError("");}}>Add order exit level</button>
    </div><p className="protection-coverage">Configured exit quantity: {Number.isFinite(total)?Number(total.toPrecision(12)):"Invalid"} / {initial.quantity}</p><p className="form-help">These are entry-order settings. Exits activate when the entry fills; each pair cancels only its sibling. Multiple levels need both TP and SL. Entry-side prices are checked when the order is submitted. Remove every row to use regular brackets again.</p>
    {stale?<p className="form-error" role="alert">The order, ticket or account changed. Close this dialog and reopen its current settings.</p>:error?<p className="form-error" role="alert">{error}</p>:null}
  </div><div className="modal-actions"><button type="button" className="button" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={stale}>Apply exit levels</button></div></form></Modal>,document.getElementById("native-chart-dialog-host")??document.body);
}
