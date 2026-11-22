"use client";
import { accountScopedName } from "@/lib/accountScope";
import {create} from "zustand";
import {nativeBrowserLocks} from "@/lib/browser/coordination";
import {validPresetDefinition,type OrderPreset,type OrderPresetDefinition} from "@/lib/trading/orderPresets";
export const ORDER_PRESETS_KEY=accountScopedName("affentrader-order-presets-v1");
const SELECTED_KEY=accountScopedName("affentrader-chart-order-preset-v1");
export function readPresetLibrary():OrderPreset[]{
  if(typeof localStorage==="undefined")throw new Error("Browser storage is unavailable.");const raw=localStorage.getItem(ORDER_PRESETS_KEY);if(raw===null)return [];
  if(raw.length>100000)throw new Error("The order preset library is too large.");const value=JSON.parse(raw) as {version?:number;presets?:OrderPreset[]};
  if(value?.version!==1||!Array.isArray(value.presets)||value.presets.length>10)throw new Error("Saved order presets are invalid or use a newer format. Existing data was retained.");
  const presets=value.presets;
  if(presets.some(p=>!p||typeof p.id!=="string"||!p.id||typeof p.name!=="string"||!p.name.trim()||p.name.length>64||!Number.isSafeInteger(p.revision)||p.revision<0||![p.createdAt,p.updatedAt].every(t=>Number.isFinite(t))||p.updatedAt<p.createdAt||!validPresetDefinition(p.definition))||new Set(presets.map(p=>p.id)).size!==presets.length||new Set(presets.map(p=>p.name.toLowerCase())).size!==presets.length)throw new Error("Saved order presets are invalid. Existing data was retained.");return presets;
}
interface PresetState {presets:OrderPreset[];selectedId:string|null;error:string|null;refresh:()=>void;select:(id:string|null)=>void;save:(name:string,definition:OrderPresetDefinition,id?:string,revision?:number)=>Promise<OrderPreset>;rename:(id:string,name:string,revision:number)=>Promise<void>;remove:(id:string,revision:number)=>Promise<void>}
const selected=()=>{try{return typeof sessionStorage==="undefined"?null:sessionStorage.getItem(SELECTED_KEY);}catch{return null;}};
const saveSelection=(id:string|null)=>{try{if(typeof sessionStorage!=="undefined"){if(id)sessionStorage.setItem(SELECTED_KEY,id);else sessionStorage.removeItem(SELECTED_KEY);}}catch{}};
async function edit<T>(action:(presets:OrderPreset[])=>T):Promise<T>{
  const locks=nativeBrowserLocks();if(!locks)throw new Error("This browser cannot safely save shared order presets. Web Locks support is required.");
  return locks.request(accountScopedName("affentrader-order-presets-write-v1"),{},async()=>{const presets=readPresetLibrary(),result=action(presets);localStorage.setItem(ORDER_PRESETS_KEY,JSON.stringify({version:1,presets}));const current=useOrderPresetStore.getState().selectedId,id=presets.some(p=>p.id===current)?current:null;saveSelection(id);useOrderPresetStore.setState({presets,selectedId:id,error:null});return structuredClone(result);});
}
function named(name:string,presets:OrderPreset[],id?:string){name=name.trim();if(!name||name.length>64)throw new Error("Use a preset name of 1–64 characters.");if(presets.some(p=>p.id!==id&&p.name.toLowerCase()===name.toLowerCase()))throw new Error("A preset with this name already exists.");return name;}
function existing(presets:OrderPreset[],id:string,revision:number){const p=presets.find(p=>p.id===id);if(!p||p.revision!==revision)throw new Error("This preset changed. Reopen its current version.");if(!Number.isSafeInteger(p.revision+1))throw new Error("This preset reached its revision limit.");return p;}
export const useOrderPresetStore=create<PresetState>((set,get)=>({
  presets:[],selectedId:selected(),error:null,
  refresh:()=>{try{const presets=readPresetLibrary(),id=presets.some(p=>p.id===get().selectedId)?get().selectedId:null;saveSelection(id);set({presets,selectedId:id,error:null});}catch(error){set({error:error instanceof Error?error.message:String(error)});}},
  select:id=>{const presets=readPresetLibrary();if(id&&!presets.some(p=>p.id===id))throw new Error("This preset no longer exists.");saveSelection(id);set({presets,selectedId:id,error:null});},
  save:async(name,definition,id,revision)=>{const snapshot=structuredClone(definition);if(!validPresetDefinition(snapshot))throw new Error("Invalid relative preset settings.");return edit(presets=>{name=named(name,presets,id);const now=Date.now();if(id){const p=existing(presets,id,revision!);Object.assign(p,{name,definition:snapshot,revision:p.revision+1,updatedAt:Math.max(now,p.updatedAt)});return p;}if(presets.length>=10)throw new Error("Up to ten order presets can be saved for this paper account.");const p:OrderPreset={id:crypto.randomUUID(),name,definition:snapshot,revision:0,createdAt:now,updatedAt:now};if(presets.some(item=>item.id===p.id))throw new Error("Preset identity collision. Try saving again.");presets.push(p);return p;});},
  rename:async(id,name,revision)=>{await edit(presets=>{const p=existing(presets,id,revision);p.name=named(name,presets,id);p.revision++;p.updatedAt=Math.max(Date.now(),p.updatedAt);});},
  remove:async(id,revision)=>{await edit(presets=>{existing(presets,id,revision);presets.splice(presets.findIndex(p=>p.id===id),1);});},
}));
