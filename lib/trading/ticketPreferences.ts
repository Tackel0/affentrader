import { accountScopedName } from "@/lib/accountScope";
import type {Ticket} from "@/stores/usePaperStore";
import {validateExitLevels} from "./exitLevels";
const KEY=accountScopedName("affentrader-paper-ticket-v1");
function valid(value:unknown):value is Ticket {
  if(!value||typeof value!=="object")return false;const t=value as Ticket;
  if(t.exitLevels!==undefined&&validateExitLevels(t.exitLevels)!==null)return false;
  return ["buy","sell"].includes(t.side)&&["market","limit","stop","stop_limit"].includes(t.type)&&typeof t.quantity==="number"&&Number.isFinite(t.quantity)&&t.quantity>=0&&typeof t.reduceOnly==="boolean"&&[t.price,t.stopPrice,t.takeProfit,t.stopLoss].every(value=>value===undefined||typeof value==="number"&&Number.isFinite(value));
}
export function readPaperTicket(fallback:Ticket):Ticket {
  try{const local=typeof sessionStorage==="undefined"?null:sessionStorage.getItem(KEY);if(local){const value:unknown=JSON.parse(local);if(valid(value))return value;}
    const old=typeof localStorage==="undefined"?null:localStorage.getItem(accountScopedName("affentrader-paper-v1"));if(old){const ticket=JSON.parse(old)?.state?.ticket as unknown;if(valid(ticket)){savePaperTicket(ticket);return ticket;}}
  }catch{}
  return {...fallback};
}
export function savePaperTicket(ticket:Ticket){try{if(typeof sessionStorage!=="undefined"&&valid(ticket))sessionStorage.setItem(KEY,JSON.stringify(ticket));}catch{/* A local ticket preference never changes the durable paper account. */}}
