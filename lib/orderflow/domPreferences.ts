import { isSymbolId } from "@/lib/symbolId";
import { DOM_COLUMNS,defaultDomColumns,requiredDomColumn,type DomColumns } from "./domColumns";
import type { DomFollowMode } from "./domNavigation";
import {defaultDomHighlight,validDomHighlight,type DomHighlight} from "./domLargeOrders";
import {DOM_ZOOMS,defaultDomColors,validDomColors,type DomColors} from "./domStyle";
import {defaultBookView,validBookView,type BookViewSettings} from "./bookView";
export interface DomPreferences {columns:DomColumns;follow:DomFollowMode;delay:number;executionUnit:"base"|"quote";groups:Record<string,number>;highlight?:DomHighlight;zoom?:number;colors?:DomColors;book?:BookViewSettings;view?:"book"|"configured"}
export const DOM_GROUPS=[1,5,10,50,100] as const;
export function defaultDomPreferences():DomPreferences {return {columns:defaultDomColumns(),follow:"auto",delay:10000,executionUnit:"base",groups:{},highlight:defaultDomHighlight(),zoom:100,colors:defaultDomColors(),book:defaultBookView(),view:"book"};}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,expected:readonly string[])=>Object.keys(v).length===expected.length&&Object.keys(v).every(k=>expected.includes(k));
export function validDomPreferences(value:unknown):value is DomPreferences {
  if(!record(value)||!keys(value,["columns","follow","delay","executionUnit","groups",...["highlight","zoom","colors","book","view"].filter(k=>Object.hasOwn(value,k))])||Object.hasOwn(value,"book")&&!validBookView(value.book)||Object.hasOwn(value,"highlight")&&!validDomHighlight(value.highlight)||Object.hasOwn(value,"zoom")&&!(DOM_ZOOMS as readonly unknown[]).includes(value.zoom)||Object.hasOwn(value,"colors")&&!validDomColors(value.colors)||!record(value.columns)||!keys(value.columns,["order","visible"]))return false;
  if (Object.hasOwn(value,"view") && value.view !== "book" && value.view !== "configured") return false;
  const {order,visible}=value.columns,ids=DOM_COLUMNS.map(c=>c.id) as string[];
  if(!Array.isArray(order)||order.length!==ids.length||new Set(order).size!==ids.length||!order.every(id=>typeof id==="string"&&ids.includes(id))||!record(visible)||!keys(visible,ids))return false;
  if(!DOM_COLUMNS.every(c=>typeof visible[c.id]==="boolean"&&(!requiredDomColumn(c.id)||visible[c.id]===true)))return false;
  if(!["auto","fixed","timed"].includes(value.follow as string)||![5000,10000,30000,60000].includes(value.delay as number)||!["base","quote"].includes(value.executionUnit as string)||!record(value.groups)||Object.keys(value.groups).length>128)return false;
  return Object.entries(value.groups).every(([symbol,group])=>isSymbolId(symbol)&&typeof group==="number"&&(DOM_GROUPS as readonly number[]).includes(group));
}
export function readDomPreferences(value:unknown):DomPreferences {return validDomPreferences(value)?structuredClone({...value,highlight:value.highlight??defaultDomHighlight(),zoom:value.zoom??100,colors:value.colors??defaultDomColors(),book:{...defaultBookView(),...value.book},view:value.view??"book"}):defaultDomPreferences();}
export function domGrouping(value:DomPreferences,symbol:string) {return Object.hasOwn(value.groups,symbol)?value.groups[symbol]:1;}
export function setDomGrouping(value:DomPreferences,symbol:string,group:number):DomPreferences {
  if(!isSymbolId(symbol)||!(DOM_GROUPS as readonly number[]).includes(group))throw new Error("Invalid DOM market grouping.");
  const groups={...value.groups};delete groups[symbol];if(group!==1)groups[symbol]=group;
  while(Object.keys(groups).length>128)delete groups[Object.keys(groups)[0]];
  return {...value,groups};
}
