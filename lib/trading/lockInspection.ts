export interface PaperLockCounts {executionHeld:number;executionWaiting:number;writesHeld:number;writesWaiting:number;matchingContexts:number|null;holderAlsoWaiting:boolean|null}
/** A held lock proves exclusive access, not that its holder is receiving prices or matching orders. */
export async function inspectPaperLocks(manager:Pick<LockManager,"query">|undefined=typeof navigator!=="undefined"?navigator.locks:undefined):Promise<PaperLockCounts>{
  if(!manager||typeof manager.query!=="function")throw new Error("This browser cannot inspect matching access.");
  const snapshot=await manager.query(),count=(items:LockInfo[]|undefined,name:string)=>(items??[]).filter(item=>item.name===name).length;
  const held=(snapshot.held??[]).filter(item=>item.name==="affentrader-paper-execution-v1"),pending=(snapshot.pending??[]).filter(item=>item.name==="affentrader-paper-execution-v1"),matching=[...held,...pending],identified=matching.every(item=>Boolean(item.clientId));
  return {executionHeld:held.length,executionWaiting:pending.length,writesHeld:count(snapshot.held,"affentrader-paper-write-v1"),writesWaiting:count(snapshot.pending,"affentrader-paper-write-v1"),matchingContexts:identified?new Set(matching.map(item=>item.clientId)).size:null,holderAlsoWaiting:identified?held.some(holder=>pending.some(waiter=>waiter.clientId===holder.clientId)):null};
}
