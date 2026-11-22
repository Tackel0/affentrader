import { accountScopedName } from "@/lib/accountScope";
import type { StateStorage } from "zustand/middleware";
export const ALERT_STORAGE_KEY = accountScopedName("affentrader-alerts-v1");
let observed: string | null | undefined;
let buffering=false,suppressed=false,pending:string|undefined;
const backing = () => typeof localStorage === "undefined" ? undefined : localStorage;
export const alertRawStorage: StateStorage = {
  getItem(name) {
    const value = backing()?.getItem(name) ?? null;
    if (value !== null) {
      const parsed:unknown=JSON.parse(value);
      if(!parsed||typeof parsed!=="object"||!("state" in parsed)||!parsed.state||typeof parsed.state!=="object")throw new Error("Saved alerts have an invalid storage envelope.");
      const state=parsed.state as Record<string,unknown>;
      if(!Array.isArray(state.alerts)||!Array.isArray(state.logs)||state.rules!==undefined&&!Array.isArray(state.rules)||state.events!==undefined&&!Array.isArray(state.events))throw new Error("Saved alert collections are invalid.");
    }
    if (name === ALERT_STORAGE_KEY) observed = value;
    return value;
  },
  setItem(name, value) {
    if(suppressed)return;
    if(name===ALERT_STORAGE_KEY&&buffering){pending=value;return;}
    if (name === ALERT_STORAGE_KEY && observed === value) return;
    backing()?.setItem(name, value);
    if (name === ALERT_STORAGE_KEY) observed = value;
  },
  removeItem(name) { backing()?.removeItem(name); if (name === ALERT_STORAGE_KEY) observed = null; },
};
export const alertSnapshotChanged = () => (backing()?.getItem(ALERT_STORAGE_KEY) ?? null) !== observed;
/** A command publishes one complete alert snapshot, or restores its pre-command in-memory state. */
export function beginAlertPersistence(){
  if(buffering)throw new Error("Nested alert write transactions are not supported.");
  buffering=true;pending=undefined;
  return {
    commit(){const value=pending;if(value!==undefined&&value!==observed){backing()?.setItem(ALERT_STORAGE_KEY,value);observed=value;}buffering=false;pending=undefined;},
    abort(restore:()=>void){buffering=false;pending=undefined;suppressed=true;try{restore();}finally{suppressed=false;}},
  };
}
