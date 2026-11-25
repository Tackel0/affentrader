"use client";
import {useRef,useState,type FormEvent} from "react";
import {createPortal} from "react-dom";
import {activeAccount,usePaperStore} from "@/stores/usePaperStore";
import {paperCommands,type CloseReview} from "@/lib/trading/paperCommands";
import {usePaperQuote} from "@/hooks/usePaperQuotes";
import {formatPrice} from "@/lib/symbols";
import {symbolLabel} from "@/lib/symbolId";
import {Modal} from "./ui";

export function ClosePositionDialog({symbol,review,onClose}:{symbol:string;review:CloseReview;onClose:()=>void}){
  const [partial,setPartial]=useState(false),[quantity,setQuantity]=useState(String(Math.abs(review.position.quantity))),[error,setError]=useState(""),[busy,setBusy]=useState(false),latch=useRef(false);
  const account=usePaperStore(activeAccount),mode=usePaperStore(s=>s.mode),epoch=usePaperStore(s=>s.contextEpoch),last=usePaperStore(s=>s.prices[symbol]),book=usePaperQuote(symbol);
  const position=account.positions.find(p=>p.symbol===symbol),expected=review.position,size=Math.abs(expected.quantity),amount=partial?Number(quantity):size;
  const stale=symbol!==review.symbol||mode!==review.mode||epoch!==review.epoch||!position||position.quantity!==expected.quantity||position.avgPrice!==expected.avgPrice||position.openedAt!==expected.openedAt||position.realizedPnl!==expected.realizedPnl;
  const valid=Number.isFinite(amount)&&amount>=1e-12&&amount<=size&&!(size-amount>0&&size-amount<1e-12),long=expected.quantity>0;
  const raw=book?(long?book.bid:book.ask):last,price=raw&&Number.isFinite(raw)&&raw>0?raw*(1+(long?-1:1)*account.slippageBps/10000):undefined;
  const fee=price&&valid?price*amount*account.feeRate:undefined,pnl=price&&valid?(price-expected.avgPrice)*amount*(long?1:-1)-(fee??0):undefined;
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(latch.current||stale||!valid)return;latch.current=true;setBusy(true);setError("");
    try{const result=await paperCommands.close(symbol,amount,review);if(result?.ok){onClose();return;}setError(result?.order.reason??"The close was not saved. Review the position and try again.");}
    finally{latch.current=false;setBusy(false);}
  };
  if(typeof document==="undefined")return null;
  return createPortal(<Modal title="Close position" className="close-position-modal" onClose={()=>{if(!latch.current)onClose();}}>
    <form onSubmit={event=>void submit(event)}><div className="form-body">
      <p>{review.mode==="replay"?"Replay":"Paper"} · {symbolLabel(symbol)} · {long?"Long":"Short"} {size}</p>
      <label className="close-partial-toggle"><input type="checkbox" checked={partial} onChange={event=>{setPartial(event.target.checked);setError("");}}/>Partial close</label>
      {partial?<label>Quantity<input aria-label="Close position quantity" type="number" min="0" max={size} step="any" required value={quantity} onInput={event=>{setQuantity(event.currentTarget.value);setError("");}} onChange={event=>{setQuantity(event.target.value);setError("");}}/></label>:null}
      {partial?<div className="close-fractions">{[25,50,75,100].map(percent=><button type="button" className="button small" key={percent} onClick={()=>{setQuantity(percent===100?String(size):String(Number((size*percent/100).toPrecision(12))));setError("");}}>{percent}%</button>)}</div>:null}
      <dl className="close-preview"><dt>Market action</dt><dd>{long?"Sell":"Buy"} {valid?amount:"—"}</dd><dt>Remaining position</dt><dd>{valid?Number((size-amount).toPrecision(12)):"—"}</dd><dt>Estimated fill</dt><dd>{price?formatPrice(price):"Unavailable"}</dd><dt>Estimated fee</dt><dd>{fee===undefined?"—":`${fee.toFixed(4)} USDT`}</dd><dt>Estimated realized P&L</dt><dd className={pnl===undefined?"":pnl>=0?"positive":"negative"}>{pnl===undefined?"—":`${pnl>=0?"+":""}${pnl.toFixed(2)} USDT`}</dd></dl>
      <p className="form-help">{book?"Bid/ask":"Last / historical bar"} estimate includes configured slippage and exit fee. Execution uses the quote available when saved. Partial closes retain entry orders and cap protective quantities to remaining exposure; a full close cancels this symbol's working orders.</p>
      {stale?<p className="form-error" role="alert">The position or account changed. Close this dialog and review the current position.</p>:!valid?<p className="form-error" role="alert">Enter a positive quantity within the position size and paper-engine precision.</p>:error?<p className="form-error" role="alert">{error}</p>:null}
    </div><div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy||stale||!valid||!price}>Confirm close</button></div></form>
  </Modal>,document.getElementById("native-chart-dialog-host")??document.body);
}
