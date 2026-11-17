import {ExecutionLease,ExclusiveWriteQueue,type BrowserLocks} from "@/lib/browser/coordination";
export type {BrowserLocks} from "@/lib/browser/coordination";
export type {ExecutionStatus as AlertOwnerStatus,ExecutionSnapshot as AlertOwnerSnapshot} from "@/lib/browser/coordination";
export const ALERT_EXECUTION_LOCK="affentrader-browser-alert-execution-v1";
export const ALERT_WRITE_LOCK="affentrader-browser-alert-write-v1";
export class BrowserAlertLease extends ExecutionLease {
  constructor(locks:BrowserLocks|undefined,prepare:()=>Promise<void>){super(locks,prepare,ALERT_EXECUTION_LOCK,"This browser cannot coordinate alerts between tabs. Use a browser with Web Locks support.");}
}
export class AlertWriteQueue<S> extends ExclusiveWriteQueue<S> {
  constructor(locks:BrowserLocks|undefined,refresh:()=>Promise<void>,current:()=>S){super(locks,refresh,current,ALERT_WRITE_LOCK,"This browser cannot safely save shared alerts. Web Locks support is required.");}
}
