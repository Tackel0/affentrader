import {useChartStore} from "@/stores/useChartStore";
import {usePaperStore} from "@/stores/usePaperStore";
import {useWorkspaceStore} from "@/stores/useWorkspaceStore";
import {paperCommands} from "./paperCommands";
import type {NewOrder,Side} from "./broker";
import {useOrderPresetStore} from "@/stores/useOrderPresetStore";
import {ticketFromPreset} from "./presetActions";
export function chartMarketOrder(symbol:string,side:Side,quantity:number):NewOrder {
  if(!Number.isFinite(quantity)||quantity<=0)throw new Error("Enter a positive quantity before placing a chart order.");
  return {symbol,side,type:"market",quantity};
}
/** Resolve the clicked cell before staging an order; an inactive chart cannot consume another cell's Replay account. */
export function activateTradingChart(symbol:string,cellId:string){
  const chart=useChartStore.getState(),workspace=useWorkspaceStore.getState(),paper=usePaperStore.getState();
  const cell=workspace.cells.find(cell=>cell.id===cellId);
  if(!cell||cell.symbol!==symbol&&workspace.activeId!==cellId||workspace.activeId===cellId&&chart.symbol!==symbol)throw new Error("The chart changed. Review the symbol and try again.");
  if(paper.mode==="replay"&&workspace.activeId!==cellId)throw new Error("Finish Replay before trading from another chart.");
  if(workspace.activeId!==cellId)workspace.activate(cellId);
}
export async function tradeFromChart(symbol:string,cellId:string,side:Side){
  const chart=useChartStore.getState(),paper=usePaperStore.getState(),instant=chart.chartTrading.instantOrders;
  activateTradingChart(symbol,cellId);
  const selected=useOrderPresetStore.getState().selectedId;
  if(selected){
    const preset=useOrderPresetStore.getState().presets.find(p=>p.id===selected);if(!preset)throw new Error("The selected preset is unavailable. Reopen the preset menu.");
    const before=usePaperStore.getState(),key=JSON.stringify(before.ticket),ticket=await ticketFromPreset(preset,symbol,side,before.ticket.quantity),current=usePaperStore.getState();
    if(useWorkspaceStore.getState().activeId!==cellId||useChartStore.getState().symbol!==symbol||current.mode!==before.mode||current.contextEpoch!==before.contextEpoch||JSON.stringify(current.ticket)!==key||useOrderPresetStore.getState().selectedId!==selected||useChartStore.getState().chartTrading.instantOrders!==instant)throw new Error("The chart, ticket or preset changed while loading. Review it and try again.");
    if(!instant){current.setTicket(ticket);useChartStore.getState().set({bottomTab:"trading",bottomOpen:true});return "ticket" as const;}
    const result=await paperCommands.place({symbol,...ticket});if(result)useChartStore.getState().toast(result.ok?"Preset paper order accepted":"Preset paper order rejected",result.ok?`${preset.name} · ${side} ${result.order.quantity}`:result.order.reason??"Order rejected.",result.ok?"success":"error");return result;
  }
  if(!instant){
    usePaperStore.getState().setTicket({side,type:"market",price:undefined,stopPrice:undefined,takeProfit:undefined,stopLoss:undefined,exitLevels:undefined,reduceOnly:false});
    useChartStore.getState().set({bottomTab:"trading",bottomOpen:true});
    return "ticket" as const;
  }
  const order=chartMarketOrder(symbol,side,paper.ticket.quantity);
  const result=await paperCommands.place(order);
  if(result)useChartStore.getState().toast(result.ok?"Paper order filled":"Paper order rejected",result.ok?`${side==="buy"?"Bought":"Sold"} ${result.order.quantity} ${symbol} at ${result.order.fillPrice}`:result.order.reason??"Order rejected.",result.ok?"success":"error");
  return result;
}
