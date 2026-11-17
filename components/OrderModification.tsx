"use client";
import {createPortal} from "react-dom";
import {useRef,useState,type FormEvent} from "react";
import {activeAccount,usePaperStore} from "@/stores/usePaperStore";
import {paperCommands} from "@/lib/trading/paperCommands";
import type {Order,OrderPatch} from "@/lib/trading/broker";
import {formatPrice} from "@/lib/symbols";
import {symbolLabel} from "@/lib/symbolId";
import {Modal} from "./ui";
import {OrderExitLevelsDialog} from "./OrderExitLevelsDialog";
import type {ExitLevel} from "@/lib/trading/exitLevels";
export function OrderModification({order,onClose,draft,reviewContext}:{order:Order;onClose:()=>void;draft?:OrderPatch;reviewContext?:{mode:"live"|"replay";epoch:number}}){
  const [context]=useState(()=>{const state=usePaperStore.getState();return reviewContext??{mode:state.mode,epoch:state.contextEpoch};}),[quantity,setQuantity]=useState(String(order.quantity)),[price,setPrice]=useState((draft?.price??order.price)===undefined?"":String(draft?.price??order.price)),[stop,setStop]=useState((draft?.stopPrice??order.stopPrice)===undefined?"":String(draft?.stopPrice??order.stopPrice)),[tp,setTp]=useState(order.takeProfit===undefined?"":String(order.takeProfit)),[sl,setSl]=useState(order.stopLoss===undefined?"":String(order.stopLoss)),[error,setError]=useState(""),[busy,setBusy]=useState(false),latch=useRef(false);
  const current=usePaperStore(s=>activeAccount(s).orders.find(o=>o.id===order.id)),mode=usePaperStore(s=>s.mode),epoch=usePaperStore(s=>s.contextEpoch);
  const [exitLevels,setExitLevels]=useState<ExitLevel[]|undefined>(()=>order.exitLevels?structuredClone(order.exitLevels):undefined),[levelsOpen,setLevelsOpen]=useState(false);
  const stale=mode!==context.mode||epoch!==context.epoch||!current||current.status!=="working"||(current.revision??0)!==(order.revision??0);
  const update=(setter:(value:string)=>void,value:string)=>{setter(value);setError("");};
  const submit=async(event:FormEvent)=>{event.preventDefault();if(latch.current)return;latch.current=true;setBusy(true);setError("");try{
    const patch:OrderPatch={quantity:Number(quantity)};
    if(order.type!=="stop")patch.price=price===""?null:Number(price);
    if(order.type!=="limit")patch.stopPrice=stop===""?null:Number(stop);
    if(!order.reduceOnly){patch.takeProfit=exitLevels?.length||tp===""?null:Number(tp);patch.stopLoss=exitLevels?.length||sl===""?null:Number(sl);patch.exitLevels=exitLevels?.length?exitLevels:null;}
    const result=await paperCommands.amend(order.id,patch,order.revision??0,context);
    if(!result){setError("The modification was not saved. Review the account and try again.");return;}
    if(!result.ok){setError(result.error??"The order could not be modified.");return;}onClose();
  }finally{latch.current=false;setBusy(false);}};
  if(typeof document==="undefined")return null;
  if(levelsOpen)return <OrderExitLevelsDialog symbol={order.symbol} quantity={Number(quantity)} levels={exitLevels} contextKey={JSON.stringify([mode,epoch,current?.id,current?.revision,current?.status,quantity,price,stop,tp,sl])} onClose={()=>setLevelsOpen(false)} onApply={levels=>{setExitLevels(levels);if(levels?.length){setTp("");setSl("");}setError("");setLevelsOpen(false);}}/>;
  return createPortal(<Modal title="Modify order" className="modify-order-modal" onClose={()=>{if(!latch.current)onClose();}}>
    <form onSubmit={event=>void submit(event)}>
      <div className="form-body">
        <p>{context.mode==="replay"?"Replay":"Paper"} · {symbolLabel(order.symbol)} · {order.side.toUpperCase()} {order.type.replace("_"," ")} · {order.id}</p>
        <label>Quantity<input aria-label="Modified order quantity" type="number" min="0" step="any" required value={quantity} onInput={event=>update(setQuantity,event.currentTarget.value)} onChange={event=>update(setQuantity,event.target.value)}/></label>
        {order.type!=="stop"?<label>Limit price<input aria-label="Modified limit price" type="number" min="0" step="any" required value={price} onInput={event=>update(setPrice,event.currentTarget.value)} onChange={event=>update(setPrice,event.target.value)}/></label>:null}
        {order.type!=="limit"?<label>Stop price<input aria-label="Modified stop price" type="number" min="0" step="any" required disabled={Boolean(order.triggered)} value={stop} onInput={event=>update(setStop,event.currentTarget.value)} onChange={event=>update(setStop,event.target.value)}/></label>:null}
        {!order.reduceOnly&&!exitLevels?.length?<><label>Take profit<input aria-label="Modified take profit" type="number" min="0" step="any" value={tp} onInput={event=>update(setTp,event.currentTarget.value)} onChange={event=>update(setTp,event.target.value)}/></label><label>Stop loss<input aria-label="Modified stop loss" type="number" min="0" step="any" value={sl} onInput={event=>update(setSl,event.currentTarget.value)} onChange={event=>update(setSl,event.target.value)}/></label></>:null}
        {!order.reduceOnly?<button type="button" className="button" disabled={busy||stale} onClick={()=>setLevelsOpen(true)}>{exitLevels?.length?`Edit ${exitLevels.length} exit levels`:"Configure exit levels"}</button>:null}
        {order.triggered?<p className="form-help">The stop-limit has triggered; its trigger cannot be moved.</p>:null}
        <p className="form-help">Saving a marketable price can fill this order immediately. Paired protective exits share quantity. Symbol, direction and order type stay fixed.</p>
        {stale?<p role="alert" className="form-error">The order or account changed. Close this dialog and reopen the current order.</p>:error?<p role="alert" className="form-error">{error}</p>:null}
      </div>
      <div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy||stale}>Save modification</button></div>
    </form>
  </Modal>,document.getElementById("native-chart-dialog-host")??document.body);
}
export function WorkingOrderControls({symbol}:{symbol:string}){
  const orders=usePaperStore(s=>activeAccount(s).orders),[open,setOpen]=useState(false),[editing,setEditing]=useState<Order|null>(null),working=orders.filter(o=>o.symbol===symbol&&o.status==="working");
  if(!working.length&&!editing)return null;
  return <div className="working-order-controls">
    <button type="button" aria-expanded={open} onClick={()=>setOpen(!open)} aria-label={`Manage working orders ${symbol}`}>Orders ({working.length})</button>
    {open&&typeof document!=="undefined"?createPortal(<Modal title="Working orders" onClose={()=>setOpen(false)}><div className="form-body working-order-list">{working.map(order=><button type="button" className="button" key={order.id} onClick={()=>{setEditing({...order});setOpen(false);}}>{order.side.toUpperCase()} {order.type.replace("_"," ")} {order.quantity} @ {formatPrice(order.price??order.stopPrice??0)} · Modify {order.id}</button>)}</div></Modal>,document.getElementById("native-chart-dialog-host")??document.body):null}
    {editing?<OrderModification order={editing} onClose={()=>setEditing(null)}/>:null}
  </div>;
}
