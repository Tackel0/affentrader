"use client";
import type { PineAlertSnapshot, PineAlertResult, PineFrame, PineSeriesLoader, PineRecoveryOptions, DurablePineResult } from "@/types/pineAlerts";
import { usePineRecoveryStore } from "@/stores/usePineRecoveryStore";
class PineAlertClient {
  private worker?: Worker;
  private pending = new Map<string, { resolve: (result: PineAlertResult | DurablePineResult) => void; reject: (error: Error) => void; loader?: PineSeriesLoader }>();
  private getWorker() {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("../../workers/pine-alert.worker.ts", import.meta.url), { type: "module", name: "Saved Pine alerts" });
    const worker=this.worker;
    worker.onmessage = ({ data }) => {
      if(this.worker!==worker)return;
      if (data.type === "progress") { usePineRecoveryStore.getState().update(data); return; }
      if (data.type === "storage_error") { for (const pending of this.pending.values()) pending.reject(new Error(data.message)); this.pending.clear(); return; }
      if (data.type === "fetch") {
        const owner = this.pending.get(data.owner);
        if (!owner?.loader) { worker.postMessage({ type: "series", id: data.id, error: "Secondary series unavailable." }); return; }
        void owner.loader(data.symbol, data.timeframe, data.count).then(series => {if(this.worker===worker)worker.postMessage({ type: "series", id: data.id, series });}).catch(error => {if(this.worker===worker)worker.postMessage({ type: "series", id: data.id, error: error instanceof Error ? error.message : String(error) });}); return;
      }
      const pending = this.pending.get(data.id); this.pending.delete(data.id);
      if (data.type === "result") pending?.resolve(data.result); else pending?.reject(new Error(data.message));
    };
    worker.onerror = event => { if(this.worker!==worker)return;for (const pending of this.pending.values()) pending.reject(new Error(event.message || "Pine alert worker failed.")); this.pending.clear(); worker.terminate(); this.worker = undefined; };
    return this.worker;
  }
  run(key: string, signature: string, snapshot: PineAlertSnapshot, frame: PineFrame, loader?: PineSeriesLoader, recovery?: PineRecoveryOptions): Promise<PineAlertResult | DurablePineResult> {
    if (this.pending.size >= 128) return Promise.reject(new Error("Pine alert processing queue is full. Reduce script work or observation frequency."));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, loader });
      try { this.getWorker().postMessage({ type: "run", id, key, signature, snapshot, frame, recovery }); }
      catch (error) { this.pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  drop(key: string) { this.worker?.postMessage({ type: "drop", key }); usePineRecoveryStore.getState().remove(key); }
  acknowledge(owner: string, journalId: string, sequence: number) { this.worker?.postMessage({ type: "ack", owner, journalId, sequence }); }
  retain(owners: readonly { owner: string; epoch: string }[]) { this.getWorker().postMessage({ type: "retain", owners }); }
  shutdown() {
    this.worker?.terminate(); this.worker = undefined;
    for (const pending of this.pending.values()) pending.reject(new Error("Browser alert ownership changed."));
    this.pending.clear();
  }
}
export const pineAlertClient = new PineAlertClient();
/** One-off input inspection has no durable alert journal and survives evaluator ownership changes. */
export const pineAlertInspector = new PineAlertClient();
