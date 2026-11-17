"use client";
import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {ORDER_PRESETS_KEY,useOrderPresetStore} from "@/stores/useOrderPresetStore";
import {useChartStore} from "@/stores/useChartStore";
import {useWorkspaceStore} from "@/stores/useWorkspaceStore";
import {applyPresetToTicket,definitionFromCurrentTicket} from "@/lib/trading/presetActions";
import {tradeFromChart} from "@/lib/trading/chartTrading";
import type {OrderPreset,PresetDistanceUnit} from "@/lib/trading/orderPresets";
import {Modal} from "./ui";
export function OrderPresetSync(){
  useEffect(()=>{
    const store=useOrderPresetStore;store.getState().refresh();let busy=false;
    const sync=(event:StorageEvent)=>{if(event.key===ORDER_PRESETS_KEY||event.key===null)store.getState().refresh();};
    const keys=(event:KeyboardEvent)=>{if(!event.shiftKey||event.altKey||event.ctrlKey||event.metaKey||event.repeat||!["b","s"].includes(event.key.toLowerCase())||busy||document.querySelector('[role="dialog"]'))return;const target=event.target;if(target instanceof HTMLElement&&target.closest('input,textarea,select,[contenteditable="true"]'))return;event.preventDefault();event.stopPropagation();busy=true;void tradeFromChart(useChartStore.getState().symbol,useWorkspaceStore.getState().activeId,event.key.toLowerCase()==="b"?"buy":"sell").catch(error=>useChartStore.getState().toast("Chart order unavailable",error instanceof Error?error.message:String(error),"error")).finally(()=>{busy=false;});};
    window.addEventListener("storage",sync);window.addEventListener("keydown",keys,true);return()=>{window.removeEventListener("storage",sync);window.removeEventListener("keydown",keys,true);};
  },[]);return null;
}
export function ChartPresetSelect({symbol}:{symbol:string}){
  const presets=useOrderPresetStore(s=>s.presets),selected=useOrderPresetStore(s=>s.selectedId);
  if(!presets.length)return null;
  return <select className="chart-preset-select" aria-label={`Chart order preset ${symbol}`} title="Preset for chart Buy/Sell and Shift+B / Shift+S" value={selected??""} onChange={event=>{try{useOrderPresetStore.getState().select(event.target.value||null);}catch(error){useChartStore.getState().toast("Preset unavailable",String(error),"error");}}}><option value="">No preset</option>{presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>;
}
export function OrderPresetControls(){const [open,setOpen]=useState(false);return <><button type="button" className="button small order-presets-button" onClick={()=>{useOrderPresetStore.getState().refresh();setOpen(true);}}>Order presets</button>{open?<OrderPresetsDialog onClose={()=>setOpen(false)}/>:null}</>;}
function OrderPresetsDialog({onClose}:{onClose:()=>void}){
  const presets=useOrderPresetStore(s=>s.presets),storedError=useOrderPresetStore(s=>s.error),[name,setName]=useState(""),[unit,setUnit]=useState<PresetDistanceUnit>("percent"),[error,setError]=useState(""),[busy,setBusy]=useState(false),lock=useRef(false),[renaming,setRenaming]=useState<{preset:OrderPreset;name:string}|null>(null);
  const run=async(action:()=>Promise<unknown>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError("");try{await action();}catch(error){setError(error instanceof Error?error.message:String(error));}finally{lock.current=false;setBusy(false);}};
  const save=async(preset?:OrderPreset)=>{const definition=await definitionFromCurrentTicket(preset?.definition.unit??unit);await useOrderPresetStore.getState().save(preset?.name??name,definition,preset?.id,preset?.revision);setName("");};
  if(typeof document==="undefined")return null;
  return createPortal(<Modal title="Order presets" className="order-presets-modal" onClose={()=>{if(!lock.current)onClose();}}><div className="form-body">
    <p>Save relative order prices and exits. Applying a preset keeps the current quantity and does not send an order.</p>
    <div className="preset-create"><label>Preset name<input aria-label="New order preset name" value={name} maxLength={64} onChange={event=>setName(event.target.value)}/></label><label>Exit distances<select aria-label="Preset exit distance unit" value={unit} onChange={event=>setUnit(event.target.value as PresetDistanceUnit)}><option value="percent">Percent</option><option value="ticks">Ticks</option></select></label><button type="button" className="button primary" disabled={busy||presets.length>=10} onClick={()=>void run(()=>save())}>Save current ticket</button></div>
    <p className="form-help">{presets.length} / 10 presets · Pending entry prices use tick offsets. Exit prices use the selected distance unit; multi-level quantities are stored as fractions of the entry.</p>
    <div className="preset-list">{presets.map(p=><div className="preset-row" key={p.id}><strong>{p.name}</strong><small>{p.definition.type.replace("_"," ")} · {p.definition.unit} · {p.definition.levels?.length??0} exit levels</small><div className="preset-row-actions"><button type="button" className="button small" disabled={busy} aria-label={`Apply preset ${p.name} to ticket`} onClick={()=>void run(async()=>{await applyPresetToTicket(p);onClose();})}>Apply to ticket</button><button type="button" className="button small" disabled={busy} aria-label={`Use preset ${p.name} on chart`} onClick={()=>{try{useOrderPresetStore.getState().select(p.id);onClose();}catch(error){setError(String(error));}}}>Use on chart</button><button type="button" className="button small" disabled={busy} aria-label={`Rename preset ${p.name}`} onClick={()=>setRenaming({preset:p,name:p.name})}>Rename</button><button type="button" className="button small" disabled={busy} aria-label={`Update preset ${p.name} from ticket`} onClick={()=>void run(()=>save(p))}>Update from ticket</button><button type="button" className="button small" disabled={busy} aria-label={`Delete preset ${p.name}`} onClick={()=>void run(async()=>{await useOrderPresetStore.getState().remove(p.id,p.revision);if(renaming?.preset.id===p.id)setRenaming(null);})}>Delete</button></div></div>)}</div>
    {renaming?<div className="preset-rename"><label>New name<input aria-label={`Rename order preset ${renaming.preset.name}`} maxLength={64} value={renaming.name} onChange={event=>setRenaming({...renaming,name:event.target.value})}/></label><button type="button" className="button" disabled={busy} onClick={()=>void run(async()=>{await useOrderPresetStore.getState().rename(renaming.preset.id,renaming.name,renaming.preset.revision);setRenaming(null);})}>Save preset name</button><button type="button" className="button" disabled={busy} onClick={()=>setRenaming(null)}>Cancel rename</button></div>:null}
    {error||storedError?<p className="form-error" role="alert">{error||storedError}</p>:null}
  </div><div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>Close</button></div></Modal>,document.getElementById("native-chart-dialog-host")??document.body);
}
