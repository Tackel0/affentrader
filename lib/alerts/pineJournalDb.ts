import type { PineJournal, PineJournalRecord } from "@/types/pineAlerts";
const NAME = "affentrader-pine-recovery-v1";
export const MAX_BROWSER_PINE_BYTES = 256 * 1024 * 1024;
interface Meta extends Omit<PineJournal, "records"> { key: string; count: number }
interface StoredRecord { owner: string; sequence: number; record: PineJournalRecord }
const range = (owner: string) => IDBKeyRange.bound([owner, 0], [owner, Number.MAX_SAFE_INTEGER]);
/** The transaction completion event, rather than a request success, is the durability boundary. */
export class PineJournalDb {
  private opened?: Promise<IDBDatabase>;
  private open(): Promise<IDBDatabase> {
    if (!this.opened) this.opened = new Promise((resolve, reject) => {
      const request = indexedDB.open(NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("meta", { keyPath: "key" });
        request.result.createObjectStore("records", { keyPath: ["owner", "sequence"] });
        request.result.createObjectStore("usage");
      };
      request.onerror = () => { this.opened = undefined; reject(request.error ?? new Error("Pine journal storage is unavailable.")); };
      request.onblocked = () => reject(new Error("Close older Affentrader tabs to upgrade Pine journal storage."));
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); this.opened = undefined; }; resolve(db); };
    });
    return this.opened;
  }
  private write(db: IDBDatabase) {
    try { return db.transaction(["meta", "records", "usage"], "readwrite", { durability: "strict" }); }
    catch (error) { if (!(error instanceof TypeError)) throw error; return db.transaction(["meta", "records", "usage"], "readwrite"); }
  }
  async load(owner: string): Promise<PineJournal | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["meta", "records"], "readonly"), meta = tx.objectStore("meta").get(owner), records = tx.objectStore("records").getAll(range(owner));
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Could not read the Pine recovery journal."));
      tx.oncomplete = () => {
        const value = meta.result as Meta | undefined;
        if (!value) { resolve(undefined); return; }
        const entries = records.result as StoredRecord[];
        if (entries.length !== value.count) { reject(new Error("Pine journal records are missing. The remaining data was retained.")); return; }
        const { key: _key, count: _count, ...journal } = value; void _key; void _count;
        resolve({ ...journal, records: entries.map(value => value.record) });
      };
    });
  }
  async append(owner: string, journal: PineJournal): Promise<void> {
    const db = await this.open(), record = journal.records.at(-1);
    if (!record) throw new Error("A Pine journal write needs an observation.");
    return new Promise((resolve, reject) => {
      const tx = this.write(db), metaStore = tx.objectStore("meta"), recordStore = tx.objectStore("records"), usage = tx.objectStore("usage");
      const previous = metaStore.get(owner), total = usage.get("total"); let reads = 2, failure: Error | undefined;
      const write = () => {
        if (--reads) return;
        try {
          const old = previous.result as Meta | undefined;
          const same = old?.id === journal.id;
          if (same ? old.count !== record.sequence - 1 : old?.epoch === journal.epoch) throw new Error("Another tab advanced this Pine journal. Its state was retained; use one main tab per subscription.");
          if (!same && record.sequence !== 1) throw new Error("Pine journal changed while restoring. No state was overwritten.");
          const bytes = Number(total.result ?? 0) - (old?.bytes ?? 0) + journal.bytes;
          if (bytes > MAX_BROWSER_PINE_BYTES) throw new Error("Pine recovery storage reached its 256 MiB budget. Existing journals were retained.");
          if (!same && old) recordStore.delete(range(owner));
          const { records: _records, ...header } = journal; void _records;
          metaStore.put({ ...header, key: owner, count: journal.records.length } satisfies Meta);
          recordStore.put({ owner, sequence: record.sequence, record } satisfies StoredRecord); usage.put(bytes, "total");
        } catch (error) { failure = error instanceof Error ? error : new Error(String(error)); tx.abort(); }
      };
      previous.onsuccess = write; total.onsuccess = write;
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error("Pine journal could not be committed. The alert stopped before notification."));
    });
  }
  async acknowledge(owner: string, id: string, sequence: number): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.write(db), store = tx.objectStore("meta"), request = store.get(owner);
      request.onsuccess = () => { const value = request.result as Meta | undefined; if (value?.id === id) store.put({ ...value, acknowledged: Math.max(value.acknowledged, Math.min(sequence, value.count)) }); };
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Could not acknowledge Pine delivery."));
    });
  }
  async prune(owners: readonly { owner: string; epoch: string }[]): Promise<void> {
    const db = await this.open(), keep = new Map(owners.map(value => [value.owner, value.epoch]));
    return new Promise((resolve, reject) => {
      const tx = this.write(db), meta = tx.objectStore("meta"), records = tx.objectStore("records"), usage = tx.objectStore("usage");
      const request = meta.openCursor(); let removed = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) { const value = cursor.value as Meta; if (keep.get(value.key) !== value.epoch) { removed += value.bytes; records.delete(range(value.key)); cursor.delete(); } cursor.continue(); }
        else if (removed) { const total = usage.get("total"); total.onsuccess = () => usage.put(Math.max(0, Number(total.result ?? 0) - removed), "total"); }
      };
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Could not clean up unused Pine journals."));
    });
  }
  async close() { if (this.opened) (await this.opened).close(); this.opened = undefined; }
}
export const pineJournalDb = new PineJournalDb();
