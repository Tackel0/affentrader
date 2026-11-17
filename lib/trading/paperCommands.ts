"use client";
import {editPaper} from "./paperOwnership";
import {useChartStore} from "@/stores/useChartStore";
import {useWorkspaceStore} from "@/stores/useWorkspaceStore";
import {depthBookStatus} from "@/lib/orderflow/depthLadder";
import {assertDomOrderReview,type DomOrderContext,type DomOrderReview} from "./domOrder";
import type {NewOrder,Account,OrderPatch,Position} from "./broker";
import {activeAccount,usePaperStore} from "@/stores/usePaperStore";
import {protectionSignature,protectionLevels,protectiveOrders,type PositionExitLevel} from "./protection";
const command=async<T>(action:Parameters<typeof editPaper<T>>[0])=>{try{return await editPaper(action);}catch(error){useChartStore.getState().toast("Paper command not saved",error instanceof Error?error.message:String(error),"error");}};
const frozenCommand=async<I,R>(input:I,action:(state:ReturnType<typeof usePaperStore.getState>,input:I)=>R)=>{try{const frozen=structuredClone(input);return await command(state=>action(state,frozen));}catch(error){useChartStore.getState().toast("Paper command not saved",error instanceof Error?error.message:String(error),"error");}};
export function captureDomOrderContext(paper=usePaperStore.getState()):DomOrderContext {
  const chart=useChartStore.getState(),workspace=useWorkspaceStore.getState();
  return {symbol:chart.symbol,timeframe:chart.timeframe,feedMode:chart.feedMode,feedEpoch:chart.feedEpoch,marketEpoch:chart.marketEpochs[chart.symbol]??0,
    source:chart.dataSources[`${chart.symbol}:${chart.timeframe}`]??"",replay:workspace.replay.active,paperMode:paper.mode,paperEpoch:paper.contextEpoch,quantity:paper.ticket.quantity,cellId:workspace.activeId};
}
export interface CloseReview {symbol:string;mode:"live"|"replay";epoch:number;position:Pick<Position,"quantity"|"avgPrice"|"openedAt"|"realizedPnl">}
export function captureCloseReview(symbol:string):CloseReview|null{
  const state=usePaperStore.getState(),position=activeAccount(state).positions.find(p=>p.symbol===symbol);
  return position?{symbol,mode:state.mode,epoch:state.contextEpoch,position:{quantity:position.quantity,avgPrice:position.avgPrice,openedAt:position.openedAt,realizedPnl:position.realizedPnl}}:null;
}
export interface ProtectionReview extends CloseReview {signature:string;levels:PositionExitLevel[]|null;orderCount:number}
export function captureProtectionReview(symbol:string):ProtectionReview|null{
  const review=captureCloseReview(symbol),account=activeAccount(usePaperStore.getState());return review?{...review,signature:protectionSignature(account,symbol),levels:protectionLevels(account,symbol),orderCount:protectiveOrders(account,symbol).length}:null;
}
function assertPositionReview(state:ReturnType<typeof usePaperStore.getState>,symbol:string,review:CloseReview|null){
  const position=activeAccount(state).positions.find(p=>p.symbol===symbol),expected=review?.position;
  if(!review||symbol!==review.symbol||state.mode!==review.mode||state.contextEpoch!==review.epoch||!position||!expected||position.quantity!==expected.quantity||position.avgPrice!==expected.avgPrice||position.openedAt!==expected.openedAt||position.realizedPnl!==expected.realizedPnl)throw new Error("The position or account changed. Reopen the dialog before submitting.");
}
export const paperCommands={
  protect:(symbol:string,levels:readonly PositionExitLevel[],review:ProtectionReview)=>command(state=>{
    assertPositionReview(state,symbol,review);
    if(protectionSignature(activeAccount(state),symbol)!==review.signature)throw new Error("Protective orders changed. Reopen the position protection dialog.");
    return state.protect(symbol,levels);
  }),
  amend:(id:string,patch:OrderPatch,revision:number,context:{mode:"live"|"replay";epoch:number})=>frozenCommand({patch,context},(state,{patch,context})=>{
    if(state.mode!==context.mode||state.contextEpoch!==context.epoch)throw new Error("The account or feed changed. Close the editor and reopen the order.");
    return state.amend(id,patch,revision);
  }),
  place:(order:NewOrder)=>frozenCommand(order,(state,order)=>state.place(order)),
  placeDomReviewed:(review:DomOrderReview)=>frozenCommand(review,(state,review)=>{
    assertDomOrderReview(review,captureDomOrderContext(state));
    const chart=useChartStore.getState();
    const invalid=depthBookStatus(chart.orderBook,{symbol:review.order.symbol,replay:useWorkspaceStore.getState().replay.active||state.mode==="replay",simulation:chart.feedMode==="simulation",now:Date.now()});
    if(invalid)throw new Error(invalid);
    return state.place(review.order);
  }),
  cancel:(id:string)=>command(state=>state.cancel(id)),
  cancelReviewed:(id:string,revision:number,context:{mode:"live"|"replay";epoch:number})=>command(state=>{
    const order=activeAccount(state).orders.find(o=>o.id===id);
    if(state.mode!==context.mode||state.contextEpoch!==context.epoch||!order||order.status!=="working"||(order.revision??0)!==revision)throw new Error("The order or account changed. Review the current order before canceling.");
    state.cancel(id);return true;
  }),
  cancelMany:(ids:string[])=>command(state=>{for(const id of ids)state.cancel(id);}),
  cancelAll:(symbol?:string)=>command(state=>state.cancelAll(symbol)),
  close:async(symbol:string,quantity?:number,review=captureCloseReview(symbol))=>{const result=await command(state=>{
    assertPositionReview(state,symbol,review);
    return state.close(symbol,quantity);
  });if(result&&!result.ok)useChartStore.getState().toast("Paper position not closed",result.order.reason??"No market price is available.","error");return result;},
  reverse:async(symbol:string)=>{
    const initial=usePaperStore.getState(),label=initial.mode==="replay"?"Replay":"Paper",position=activeAccount(initial).positions.find(p=>p.symbol===symbol);
    if(!position)return null;
    const expected={quantity:position.quantity,avgPrice:position.avgPrice,openedAt:position.openedAt};
    const result=await command(state=>{
      const current=activeAccount(state).positions.find(p=>p.symbol===symbol);
      if(!current||current.quantity!==expected.quantity||current.avgPrice!==expected.avgPrice||current.openedAt!==expected.openedAt)throw new Error("The position changed while waiting. Review it before reversing.");
      return state.reverse(symbol);
    });
    if(result)useChartStore.getState().toast(result.ok?`${label} position reversed`:`${label} position not reversed`,result.ok?`${symbol}: ${result.order.side==="buy"?"Long":"Short"} ${result.order.quantity/2}`:result.order.reason??"Order rejected.",result.ok?"success":"error");
    return result;
  },
  reset:(patch?:Partial<Account>)=>command(state=>state.reset(patch)),
};
