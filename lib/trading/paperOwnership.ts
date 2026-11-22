"use client";
import { accountScopedName } from "@/lib/accountScope";
import {ExecutionLease,ExclusiveWriteQueue,nativeBrowserLocks} from "@/lib/browser/coordination";
import {usePaperStore} from "@/stores/usePaperStore";
import {paperSnapshotChanged,beginPaperPersistence} from "./paperPersistence";
export const PAPER_EXECUTION_LOCK=accountScopedName("affentrader-paper-execution-v1");
export const PAPER_WRITE_LOCK=accountScopedName("affentrader-paper-write-v1");
async function refreshPaper(){if(!paperSnapshotChanged())return;await usePaperStore.persist.rehydrate();if(paperSnapshotChanged())throw new Error("Saved paper account could not be read. Its existing storage was retained.");}
let owner:ExecutionLease|undefined;
export function paperExecutionOwner(){return owner??=new ExecutionLease(nativeBrowserLocks(),async()=>{await editLivePaper(()=>undefined);},PAPER_EXECUTION_LOCK,"This browser cannot coordinate paper execution between tabs. Web Locks support is required.");}
/** Matching and user commands share the same write lock and commit one complete account snapshot. */
export function editLivePaper<T>(action:(state:ReturnType<typeof usePaperStore.getState>)=>T,valid?:()=>boolean):Promise<T|undefined>{
  return new ExclusiveWriteQueue(nativeBrowserLocks(),refreshPaper,usePaperStore.getState,PAPER_WRITE_LOCK,"This browser cannot safely save a shared paper account. Web Locks support is required.").run(state=>{
    const transaction=beginPaperPersistence();
    try{const result=action(state);transaction.commit();return result;}
    catch(error){transaction.abort(()=>usePaperStore.setState(state,true));throw error;}
  },valid);
}
/** The account selected when a command was issued cannot change while it waits. */
export async function editPaper<T>(action:(state:ReturnType<typeof usePaperStore.getState>)=>T):Promise<T|undefined>{
  const initial=usePaperStore.getState(),mode=initial.mode,epoch=initial.contextEpoch;
  const apply=(state:typeof initial)=>{if(state.mode!==mode||state.contextEpoch!==epoch)throw new Error("The selected paper account changed. Review the ticket and submit again.");return action(state);};
  return mode==="replay"?apply(initial):editLivePaper(apply);
}
