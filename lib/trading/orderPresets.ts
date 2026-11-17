import type {Ticket} from "@/stores/usePaperStore";
import {validateExitLevels} from "./exitLevels";
export type PresetDistanceUnit="ticks"|"percent";
export interface PresetLevel {fraction:number;takeProfit:number|null;stopLoss:number|null}
export interface OrderPresetDefinition {type:Ticket["type"];priceTicks?:number;stopTicks?:number;unit:PresetDistanceUnit;takeProfit?:number;stopLoss?:number;levels?:PresetLevel[]}
export interface OrderPreset {id:string;name:string;revision:number;createdAt:number;updatedAt:number;definition:OrderPresetDefinition}
export interface PresetRules {symbol:string;source:"Binance"|"Hyperliquid";quantityStep:number;tick:(price:number)=>number}
const positive=(n:unknown):n is number=>typeof n==="number"&&Number.isFinite(n)&&n>0;
export function validPresetDefinition(value:unknown):value is OrderPresetDefinition{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;const p=value as OrderPresetDefinition;
  if(Object.keys(p).some(k=>!["type","priceTicks","stopTicks","unit","takeProfit","stopLoss","levels"].includes(k))||!["market","limit","stop","stop_limit"].includes(p.type)||!["ticks","percent"].includes(p.unit))return false;
  for(const key of ["priceTicks","stopTicks"] as const)if(p[key]!==undefined&&(!Number.isSafeInteger(p[key])||Math.abs(p[key]!)>1e9))return false;
  if((p.type==="limit"||p.type==="stop_limit")!== (p.priceTicks!==undefined)||(p.type==="stop"||p.type==="stop_limit")!==(p.stopTicks!==undefined))return false;
  if([p.takeProfit,p.stopLoss].some(v=>v!==undefined&&!positive(v)))return false;
  if(p.levels!==undefined){if(!Array.isArray(p.levels)||!p.levels.length||p.levels.length>4||p.takeProfit!==undefined||p.stopLoss!==undefined)return false;let sum=0;for(const l of Array.from(p.levels)){if(!l||typeof l!=="object"||Object.keys(l).some(k=>!["fraction","takeProfit","stopLoss"].includes(k))||!positive(l.fraction)||l.fraction>1||[l.takeProfit,l.stopLoss].some(v=>v!==null&&!positive(v))||l.takeProfit===null&&l.stopLoss===null||p.levels.length>1&&(l.takeProfit===null||l.stopLoss===null))return false;sum+=l.fraction;}if(sum>1+Number.EPSILON*8)return false;}
  return true;
}
function tick(rules:PresetRules,price:number){const step=rules.tick(price);if(!positive(price)||!positive(step))throw new Error("Verified price precision is unavailable for this instrument.");return step;}
function rounded(rules:PresetRules,price:number){for(let i=0;i<3;i++){const step=tick(rules,price),next=Number((Math.round(price/step)*step).toPrecision(15));if(next===price)return price;price=next;}if(!positive(price))throw new Error("The preset produces a nonpositive price.");return price;}
export function createPresetDefinition(ticket:Ticket,baseline:number,rules:PresetRules,unit:PresetDistanceUnit):OrderPresetDefinition{
  if(!positive(baseline)||!positive(ticket.quantity)||ticket.reduceOnly)throw new Error("Choose a positive entry quantity and turn reduce-only off before saving a preset.");
  const sign=ticket.side==="buy"?1:-1,step=tick(rules,baseline),definition:OrderPresetDefinition={type:ticket.type,unit};
  const offset=(price:number|undefined)=>{if(!positive(price))throw new Error("Complete the entry prices before saving this preset.");return Math.round((price-baseline)/sign/step);};
  if(ticket.type==="limit"||ticket.type==="stop_limit")definition.priceTicks=offset(ticket.price);
  if(ticket.type==="stop"||ticket.type==="stop_limit")definition.stopTicks=offset(ticket.stopPrice);
  const entry=ticket.type==="market"?baseline:ticket.price??ticket.stopPrice;if(!positive(entry))throw new Error("An entry reference is required.");
  const distance=(price:number,isTp:boolean)=>{const diff=(price-entry)*sign*(isTp?1:-1);if(!positive(diff))throw new Error("Bracket prices must be on the correct sides of the entry.");const value=unit==="percent"?diff/entry*100:Math.round(diff/tick(rules,entry));if(!positive(value))throw new Error("This exit is smaller than one price tick.");return value;};
  if(ticket.exitLevels?.length){const error=validateExitLevels(ticket.exitLevels,ticket.quantity);if(error)throw new Error(error);definition.levels=ticket.exitLevels.map(l=>({fraction:l.quantity/ticket.quantity,takeProfit:l.takeProfit===null?null:distance(l.takeProfit,true),stopLoss:l.stopLoss===null?null:distance(l.stopLoss,false)}));}
  else{if(ticket.takeProfit!==undefined)definition.takeProfit=distance(ticket.takeProfit,true);if(ticket.stopLoss!==undefined)definition.stopLoss=distance(ticket.stopLoss,false);}
  if(!validPresetDefinition(definition))throw new Error("This ticket cannot be represented as a valid relative preset.");return definition;
}
export function resolvePreset(definition:OrderPresetDefinition,side:Ticket["side"],quantity:number,baseline:number,rules:PresetRules):Ticket{
  if(!validPresetDefinition(definition)||!positive(quantity)||!positive(baseline)||!positive(rules.quantityStep))throw new Error("Preset or instrument parameters are unavailable.");
  const units=quantity/rules.quantityStep;if(!Number.isSafeInteger(Math.round(units))||Math.abs(units-Math.round(units))>Math.max(1,units)*Number.EPSILON*16)throw new Error("The current quantity does not fit this instrument's quantity step.");
  const sign=side==="buy"?1:-1,step=tick(rules,baseline),ticket:Ticket={side,type:definition.type,quantity,price:undefined,stopPrice:undefined,takeProfit:undefined,stopLoss:undefined,exitLevels:undefined,reduceOnly:false};
  if(definition.priceTicks!==undefined)ticket.price=rounded(rules,baseline+sign*definition.priceTicks*step);
  if(definition.stopTicks!==undefined)ticket.stopPrice=rounded(rules,baseline+sign*definition.stopTicks*step);
  const entry=ticket.type==="market"?baseline:ticket.price??ticket.stopPrice!;
  const target=(distance:number,isTp:boolean)=>{const amount=definition.unit==="percent"?entry*distance/100:distance*tick(rules,entry),price=rounded(rules,entry+sign*(isTp?1:-1)*amount);if((price-entry)*sign*(isTp?1:-1)<=0)throw new Error("An exit distance is too small for this instrument's price precision.");return price;};
  if(definition.levels){ticket.exitLevels=definition.levels.map(l=>{const q=Number((quantity*l.fraction).toPrecision(15)),steps=q/rules.quantityStep;if(!Number.isSafeInteger(Math.round(steps))||Math.abs(steps-Math.round(steps))>Math.max(1,steps)*Number.EPSILON*16)throw new Error("An exit quantity does not fit this instrument's quantity step.");return{quantity:q,takeProfit:l.takeProfit===null?null:target(l.takeProfit,true),stopLoss:l.stopLoss===null?null:target(l.stopLoss,false)};});const error=validateExitLevels(ticket.exitLevels,quantity);if(error)throw new Error(error);}
  if(definition.takeProfit!==undefined)ticket.takeProfit=target(definition.takeProfit,true);if(definition.stopLoss!==undefined)ticket.stopLoss=target(definition.stopLoss,false);
  return ticket;
}
