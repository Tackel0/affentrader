import { accountScopedName } from "@/lib/accountScope";
import type { OrderBook } from "@/types/trading";
import { MAX_DEPTH_COLUMNS } from "./depthHeatmap";
import { REPLAY_DEPTH_RETENTION_MS } from "./replayDepth";

export interface StoredDepth { symbol: string; receivedAt: number; bucket: number; book: OrderBook }
const CAPACITY = 4 * MAX_DEPTH_COLUMNS;

export class ReplayDepthDb {
  private connection?: Promise<IDBDatabase>;

  constructor(private name = accountScopedName("affentrader-replay-depth-v1"), private now = Date.now) {}

  private open() {
    return this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("books", { keyPath: ["bucket", "symbol"] });
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Depth storage is blocked by another tab."));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); this.connection = undefined; };
        resolve(db);
      };
    }).catch(error => { this.connection = undefined; throw error; });
  }

  async update(input: readonly StoredDepth[], read = false): Promise<StoredDepth[]> {
    const db = await this.open();
    const from = this.now() - REPLAY_DEPTH_RETENTION_MS;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("books", "readwrite");
      const store = tx.objectStore("books");
      let restored: StoredDepth[] = [];
      for (const record of input) {
        if (record.receivedAt < from) continue;
        const key = [record.bucket, record.symbol];
        const previous = store.get(key);
        previous.onsuccess = () => {
          if (!previous.result || previous.result.receivedAt <= record.receivedAt) store.put(record);
        };
      }
      // Queue pruning after the last put has been queued, within the same transaction.
      const pending = store.openCursor();
      pending.onsuccess = () => {
        const expire = store.openCursor(IDBKeyRange.upperBound([Math.floor(from / 1000)]));
        expire.onsuccess = () => {
          if (expire.result) {
            expire.result.delete();
            expire.result.continue();
            return;
          }
          const count = store.count();
          count.onsuccess = () => {
            let excess = count.result - CAPACITY;
            const oldest = store.openCursor();
            oldest.onsuccess = () => {
              if (excess > 0 && oldest.result) {
                oldest.result.delete();
                excess--;
                oldest.result.continue();
              } else if (read) {
                const rows = store.getAll(undefined, CAPACITY);
                rows.onsuccess = () => { restored = rows.result.filter(row => row.receivedAt >= from); };
              }
            };
          };
        };
      };
      tx.oncomplete = () => resolve(restored);
      tx.onabort = () => reject(tx.error ?? new Error("Depth storage transaction was interrupted."));
    });
  }
}

export const replayDepthDb = new ReplayDepthDb();
