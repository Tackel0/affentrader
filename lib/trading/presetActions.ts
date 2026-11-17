import {usePaperStore} from "@/stores/usePaperStore";
import {useChartStore} from "@/stores/useChartStore";
import {executableQuote} from "./quotes";
import {loadPresetRules} from "./presetRules";
import {createPresetDefinition,resolvePreset,type OrderPreset,type PresetDistanceUnit} from "./orderPresets";
import {readPresetLibrary} from "@/stores/useOrderPresetStore";
function baseline(symbol:string,side:"buy"|"sell"){
  const state=usePaperStore.getState(),source=state.liveSources[symbol],book=state.mode==="live"?executableQuote(state.liveBooks[symbol],symbol,source===undefined?undefined:source==="simulation"):undefined,value=book?(side==="buy"?book.ask:book.bid):state.prices[symbol];
  if(!Number.isFinite(value)||value<=0)throw new Error("A current price observation is required to resolve a preset.");return value;
}
export async function definitionFromCurrentTicket(unit:PresetDistanceUnit){
  const state=usePaperStore.getState(),symbol=useChartStore.getState().symbol,ticket=structuredClone(state.ticket),key=JSON.stringify(ticket),rules=await loadPresetRules(symbol,fetch,useChartStore.getState().feedMode!=="simulation"),current=usePaperStore.getState();
  if(current.mode!==state.mode||current.contextEpoch!==state.contextEpoch||useChartStore.getState().symbol!==symbol||JSON.stringify(current.ticket)!==key)throw new Error("The ticket or account changed while loading instrument rules. Review it and try again.");
  return createPresetDefinition(ticket,baseline(symbol,ticket.side),rules,unit);
}
export async function ticketFromPreset(preset:OrderPreset,symbol:string,side:"buy"|"sell",quantity:number){
  const initial=usePaperStore.getState(),rules=await loadPresetRules(symbol,fetch,useChartStore.getState().feedMode!=="simulation"),state=usePaperStore.getState();
  if(state.mode!==initial.mode||state.contextEpoch!==initial.contextEpoch)throw new Error("The account or feed changed. Reapply the preset.");
  const current=readPresetLibrary().find(p=>p.id===preset.id);if(!current||current.revision!==preset.revision)throw new Error("The preset changed. Select its current version.");
  return resolvePreset(current.definition,side,quantity,baseline(symbol,side),rules);
}
export async function applyPresetToTicket(preset:OrderPreset){
  const before=usePaperStore.getState(),symbol=useChartStore.getState().symbol,key=JSON.stringify(before.ticket),ticket=await ticketFromPreset(preset,symbol,before.ticket.side,before.ticket.quantity);
  if(useChartStore.getState().symbol!==symbol||JSON.stringify(usePaperStore.getState().ticket)!==key)throw new Error("The ticket changed. Review it before applying this preset.");usePaperStore.getState().setTicket(ticket);
}
