"use client";
import {useRef,useState,type FormEvent} from "react";
import {createPortal} from "react-dom";
import {activeAccount,usePaperStore} from "@/stores/usePaperStore";
import {paperCommands,type ProtectionReview} from "@/lib/trading/paperCommands";
import {protectionSignature} from "@/lib/trading/protection";
import {formatPrice} from "@/lib/symbols";
import {symbolLabel} from "@/lib/symbolId";
import {Modal} from "./ui";
interface Row {key:number;quantity:string;takeProfit:string;stopLoss:string}
export function PositionProtectionDialog({symbol,review,onClose}:{symbol:string;review:ProtectionReview;onClose:()=>void}){
  const size=Math.abs(review.position.quantity),[rows,setRows]=useState<Row[]>(()=>review.levels?.length?review.levels.map((l,key)=>({key,quantity:String(l.quantity),takeProfit:l.takeProfit===null?"":String(l.takeProfit),stopLoss:l.stopLoss===null?"":String(l.stopLoss)})):[{key:0,quantity:String(size),takeProfit:"",stopLoss:""}]),serial=useRef(5),[busy,setBusy]=useState(false),latch=useRef(false),[error,setError]=useState("");
  const account=usePaperStore(activeAccount),mode=usePaperStore(s=>s.mode),epoch=usePaperStore(s=>s.contextEpoch),last=usePaperStore(s=>s.prices[symbol]),position=account.positions.find(p=>p.symbol===symbol),expected=review.position;
  const stale=symbol!==review.symbol||mode!==review.mode||epoch!==review.epoch||!position||position.quantity!==expected.quantity||position.avgPrice!==expected.avgPrice||position.openedAt!==expected.openedAt||position.realizedPnl!==expected.realizedPnl||protectionSignature(account,symbol)!==review.signature;
  const total=rows.reduce((sum,row)=>sum+Number(row.quantity),0);
  const update=(key:number,field:"quantity"|"takeProfit"|"stopLoss",value:string)=>{setRows(current=>current.map(row=>row.key===key?{...row,[field]:value}:row));setError("");};
  const submit=async(event:FormEvent)=>{event.preventDefault();if(latch.current||stale)return;latch.current=true;setBusy(true);setError("");try{
    const levels=rows.map(row=>({quantity:Number(row.quantity),takeProfit:row.takeProfit===""?null:Number(row.takeProfit),stopLoss:row.stopLoss===""?null:Number(row.stopLoss)})),result=await paperCommands.protect(symbol,levels,review);
    if(result?.ok){onClose();return;}setError(result?.error??"Protection was not saved. Review the position and reopen this dialog if it changed.");
  }finally{latch.current=false;setBusy(false);}};
  if(typeof document==="undefined")return null;
  return createPortal(<Modal title="Protect position" className="position-protection-modal" onClose={()=>{if(!latch.current)onClose();}}>
    <form onSubmit={event=>void submit(event)}><div className="form-body">
      <p>{review.mode==="replay"?"Replay":"Paper"} · {symbolLabel(symbol)} · {expected.quantity>0?"Long":"Short"} {size} · Last {last?formatPrice(last):"unavailable"}</p>
      <fieldset disabled={busy} className="protection-levels">
        {rows.map((row,index)=><div className="protection-level" key={row.key}><div className="protection-level-title"><strong>Exit level {index+1}</strong><button type="button" className="button small" aria-label={`Remove exit level ${index+1}`} onClick={()=>{setRows(current=>current.filter(item=>item.key!==row.key));setError("");}}>Remove</button></div><div className="protection-level-fields">
          {([['quantity','Quantity'],['takeProfit','Take profit'],['stopLoss','Stop loss']] as const).map(([field,label])=><label key={field}>{label}<input aria-label={`Protection level ${index+1} ${label.toLowerCase()}`} type="number" min="0" step="any" required={field==="quantity"} value={row[field]} onInput={event=>update(row.key,field,event.currentTarget.value)} onChange={event=>update(row.key,field,event.target.value)}/></label>)}
        </div></div>)}
        <button type="button" className="button" disabled={rows.length>=4} onClick={()=>{const key=serial.current++;setRows(current=>[...current,{key,quantity:String(Math.max(0,Number((size-total).toPrecision(12)))),takeProfit:"",stopLoss:""}]);setError("");}}>Add exit level</button>
      </fieldset>
      <p className="protection-coverage">Covered: {Number.isFinite(total)?`${Number(total.toPrecision(12))} / ${size} (${(total/size*100).toFixed(1)}%)`:"Invalid quantity"}</p>
      <p className="form-help">Saving replaces {review.orderCount} working reduce-only exits on this symbol. Other entry orders stay in place. Each multi-level exit needs both TP and SL; one regular level may use only one side. Remove all rows and save to clear protection while keeping the position open.</p>
      {review.levels===null?<p className="form-help">Existing exits cannot be represented as four paired levels. Review a replacement configuration before saving.</p>:null}
      {stale?<p className="form-error" role="alert">The position, protective orders or account changed. Close this dialog and reopen it.</p>:error?<p className="form-error" role="alert">{error}</p>:null}
    </div><div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy||stale}>Save protection</button></div></form>
  </Modal>,document.getElementById("native-chart-dialog-host")??document.body);
}
