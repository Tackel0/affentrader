import type {Vela} from "@luxalgo/vela";
import {useChartStore} from "@/stores/useChartStore";
import {useWorkspaceStore} from "@/stores/useWorkspaceStore";
import {statusLineSettings} from "./statusLineSettings";
/** Host rows inside Vela's real settings dialog, backed by the workspace's persistent preferences. */
export function installTradingSettings(chart:Vela, cellId=useWorkspaceStore.getState().activeId){
  const host=typeof document!=="undefined"?document.getElementById("native-chart-dialog-host"):null;
  if(host)chart.renderer.set({dialogHost:host});
  chart.renderer.setSettingsSections([statusLineSettings(cellId),{id:"trading",title:"Trading",rows:[
    {kind:"heading",id:"general",label:"General"},
    {kind:"toggle",id:"buy-sell",label:"Buy/Sell buttons",get:()=>useChartStore.getState().chartTrading.showButtons,set:(showButtons:boolean)=>{const state=useChartStore.getState();state.set({chartTrading:{...state.chartTrading,showButtons}});}},
    {kind:"toggle",id:"instant",label:"Instant paper order placement",get:()=>useChartStore.getState().chartTrading.instantOrders,set:(instantOrders:boolean)=>{const state=useChartStore.getState();state.set({chartTrading:{...state.chartTrading,instantOrders}});}},
  ]}]);
}
