import type {StateStorage} from "zustand/middleware";
import type {Account} from "./broker";
import {isSymbolId} from "@/lib/symbolId";
import {validPaperSource} from "./executionSource";
import {validateExitLevels} from "./exitLevels";
export const PAPER_STORAGE_KEY="affentrader-paper-v1";
let observed:string|null|undefined,buffering=false,suppressed=false,pending:string|undefined;
const backing=()=>typeof localStorage==="undefined"?undefined:localStorage;
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
export function validPaperAccount(value:unknown):value is Account {
  if(!object(value))return false;
  if(!["initialBalance","cash","feeRate","slippageBps","leverage","seq"].every(key=>typeof value[key]==="number"&&Number.isFinite(value[key])))return false;
  if(Number(value.initialBalance)<=0||Number(value.leverage)<1||Number(value.feeRate)<0||Number(value.slippageBps)<0||!Number.isSafeInteger(value.seq)||Number(value.seq)<0)return false;
  if(!["positions","orders","fills","equity"].every(key=>Array.isArray(value[key])&&(value[key] as unknown[]).every(object)))return false;
  const account=value as unknown as Account,finite=(...values:unknown[])=>values.every(v=>typeof v==="number"&&Number.isFinite(v));
  if(account.orders.some(o=>o.exitLevels!==undefined&&validateExitLevels(o.exitLevels,o.quantity)!==null))return false;
  if(account.orders.some(o=>!validPaperSource(o.createdSource)||!validPaperSource(o.fillSource)||!validPaperSource(o.modifiedSource)||o.revision!==undefined&&(!Number.isSafeInteger(o.revision)||o.revision<0)||o.modifiedAt!==undefined&&(!finite(o.modifiedAt)||o.modifiedAt<o.createdAt))||account.fills.some(f=>!validPaperSource(f.source)||f.priceBasis!==undefined&&!["bid","ask","last","limit"].includes(f.priceBasis)))return false;
  if(account.positions.some(p=>!isSymbolId(p.symbol)||!finite(p.quantity,p.avgPrice,p.openedAt,p.realizedPnl)||p.quantity===0||p.avgPrice<=0))return false;
  if(account.orders.some(o=>typeof o.id!=="string"||!o.id||!isSymbolId(o.symbol)||!["working","filled","canceled","rejected"].includes(o.status)||!["buy","sell"].includes(o.side)||!["market","limit","stop","stop_limit"].includes(o.type)||!finite(o.createdAt)||o.status!=="rejected"&&(!finite(o.quantity)||o.quantity<=0)||o.status==="working"&&[o.price,o.stopPrice,o.takeProfit,o.stopLoss].some(v=>v!==undefined&&(!finite(v)||v<=0))))return false;
  if(account.fills.some(f=>typeof f.id!=="string"||!f.id||!isSymbolId(f.symbol)||!["buy","sell"].includes(f.side)||!finite(f.quantity,f.price,f.fee,f.time,f.realizedPnl,f.position)||f.quantity<=0||f.price<=0))return false;
  return new Set(account.orders.map(o=>o.id)).size===account.orders.length&&new Set(account.fills.map(f=>f.id)).size===account.fills.length&&account.equity.every(p=>finite(p.time,p.equity));
}
export const paperRawStorage:StateStorage={
  getItem(name){const value=backing()?.getItem(name)??null;if(value===null&&typeof observed==="string")throw new Error("Saved paper account was removed. Reload before starting a new account.");if(value!==null){const parsed:unknown=JSON.parse(value);if(!object(parsed)||parsed.version!==undefined&&parsed.version!==0&&parsed.version!==1||!object(parsed.state)||!validPaperAccount(parsed.state.live))throw new Error("Saved paper account is invalid or uses a newer format. Its storage was retained.");}if(name===PAPER_STORAGE_KEY)observed=value;return value;},
  // Quotes, local Replay and ticket changes cannot persist an older shared account.
  setItem(name,value){if(suppressed||!buffering||name!==PAPER_STORAGE_KEY)return;pending=value;},
  removeItem(name){if(!buffering)throw new Error("Paper account removal requires a write transaction.");backing()?.removeItem(name);observed=null;},
};
export const paperSnapshotChanged=()=>(backing()?.getItem(PAPER_STORAGE_KEY)??null)!==observed;
export const assertPaperTransaction=()=>{if(!buffering)throw new Error("Shared paper account changes require a serialized command.");};
export function beginPaperPersistence(){
  if(buffering)throw new Error("Nested paper account transactions are not supported.");buffering=true;pending=undefined;
  return {
    commit(){const value=pending;if(value!==undefined&&value!==observed){if(!validPaperAccount(JSON.parse(value).state?.live))throw new Error("The paper command produced an invalid account. Previous state was retained.");backing()?.setItem(PAPER_STORAGE_KEY,value);observed=value;}buffering=false;pending=undefined;},
    abort(restore:()=>void){buffering=false;pending=undefined;suppressed=true;try{restore();}finally{suppressed=false;}},
  };
}
