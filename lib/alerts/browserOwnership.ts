"use client";
import { BrowserAlertLease, AlertWriteQueue, type BrowserLocks } from "./browserLease";
import { alertSnapshotChanged, beginAlertPersistence } from "./browserPersistence";
import { useAlertStore } from "@/stores/useAlertStore";
import { useWatchlistStore } from "@/stores/useWatchlistStore";
import { useServerStore } from "@/stores/useServerStore";

function browserLocks(): BrowserLocks | undefined {
  if (typeof navigator === "undefined" || !navigator.locks) return;
  return { request: async (name, options, callback) => await navigator.locks.request(name, options, callback) };
}
async function refreshAlerts() {
  if (!alertSnapshotChanged()) return;
  await useAlertStore.persist.rehydrate();
  if (alertSnapshotChanged()) throw new Error("Saved alerts could not be read. Their existing storage was retained.");
}
let owner: BrowserAlertLease | undefined;
export function browserAlertOwner(): BrowserAlertLease {
  return owner ??= new BrowserAlertLease(browserLocks(), async () => {
    await editAlerts(()=>undefined);
    await useWatchlistStore.persist.rehydrate();
    await useServerStore.persist.rehydrate();
  });
}
/** All browser alert mutations use the same origin-wide write lock, including edits in standby tabs. */
export function editAlerts<T>(action: (state: ReturnType<typeof useAlertStore.getState>) => T, valid?: () => boolean): Promise<T | undefined> {
  return new AlertWriteQueue(browserLocks(), refreshAlerts, useAlertStore.getState).run(state=>{
    const transaction=beginAlertPersistence();
    try{const value=action(state);transaction.commit();return value;}
    catch(error){transaction.abort(()=>useAlertStore.setState(state,true));throw error;}
  }, valid);
}
