import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { PineJournal } from "@/types/pineAlerts";
import { PineRecoveryError } from "@/lib/alerts/pineJournal";
import { JsonStore, dataDir } from "./storage";
import { usesNetlifyStorage } from "./netlifyStorage";
const MAX_SERVER_PINE_BYTES = 256 * 1024 * 1024;
const directory = () => path.join(dataDir(), "pine-recovery");
const name = (owner: string) => `pine-${createHash("sha256").update(owner).digest("hex")}`;
const stores = new Map<string, JsonStore<PineJournal | null>>();
// One cloud document makes the budget and owner/sequence checks atomic together.
const cloudJournals = new JsonStore<Record<string, PineJournal>>("pine-journals", () => ({}));
const document = (owner: string) => {
  let store = stores.get(owner); if (!store) { store = new JsonStore<PineJournal | null>(name(owner), () => null, directory); stores.set(owner, store); }
  return store;
};
let writes: Promise<unknown> = Promise.resolve();
const serialize = <T>(work: () => Promise<T>): Promise<T> => { const next = writes.then(work, work); writes = next.catch(() => undefined); return next; };
export async function loadPineJournal(owner: string) {
  if (usesNetlifyStorage()) return (await cloudJournals.read())[name(owner)];
  return (await document(owner).read()) ?? undefined;
}
/** Journal before the alert transaction, then an acknowledgement after it: pending output can be regenerated. */
export function appendPineJournal(owner: string, journal: PineJournal): Promise<void> {
  if (usesNetlifyStorage()) return cloudJournals.update(values => {
    const key = name(owner), previous = values[key], sequence = journal.records.length;
    if (previous?.id === journal.id ? previous.records.length !== sequence - 1 : previous?.epoch === journal.epoch || sequence !== 1) throw new PineRecoveryError("Pine journal changed during evaluation. No previous state was overwritten.");
    values[key] = structuredClone(journal);
    if (Buffer.byteLength(JSON.stringify(values)) > MAX_SERVER_PINE_BYTES) throw new PineRecoveryError("Server Pine recovery storage reached its 256 MiB budget. Existing journals were retained.");
  }).then(() => undefined);
  return serialize(async () => {
    const store = document(owner), previous = await store.read(), sequence = journal.records.length;
    if (previous?.id === journal.id ? previous.records.length !== sequence - 1 : previous?.epoch === journal.epoch || sequence !== 1) throw new PineRecoveryError("Pine journal changed during evaluation. No previous state was overwritten.");
    const encoded = JSON.stringify(journal), bytes = Buffer.byteLength(encoded);
    let current = 0;
    try {
      const entries = (await fs.readdir(directory())).filter(file => /^pine-[a-f\d]{64}\.json$/.test(file) && file !== `${name(owner)}.json`);
      current = (await Promise.all(entries.map(async file => (await fs.stat(path.join(directory(), file))).size))).reduce((sum, size) => sum + size, 0);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (current + bytes > MAX_SERVER_PINE_BYTES) throw new PineRecoveryError("Server Pine recovery storage reached its 256 MiB budget. Existing journals were retained.");
    await store.update(() => structuredClone(journal));
  });
}
export function acknowledgePineJournal(owner: string, id: string, sequence: number): Promise<void> {
  if (usesNetlifyStorage()) return cloudJournals.update(values => {
    const value = values[name(owner)];
    if (value?.id === id) value.acknowledged = Math.max(value.acknowledged, Math.min(sequence, value.records.length));
  }).then(() => undefined);
  return serialize(async () => { await document(owner).update(value => value?.id === id ? { ...value, acknowledged: Math.max(value.acknowledged, Math.min(sequence, value.records.length)) } : value); });
}
export function prunePineJournals(owners: readonly { owner: string; epoch: string }[]): Promise<void> {
  if (usesNetlifyStorage()) return cloudJournals.update(values => {
    const keep = new Set(owners.map(value => name(value.owner)));
    for (const key of Object.keys(values)) if (!keep.has(key)) delete values[key];
  }).then(() => undefined);
  return serialize(async () => {
    const keep = new Set(owners.map(value => name(value.owner)));
    let files: string[];
    try { files = await fs.readdir(directory()); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const file of files) {
      const match = /^(pine-[a-f\d]{64})\.json(?:\.bak)?$/.exec(file);
      if (match && !keep.has(match[1])) await fs.rm(path.join(directory(), file), { force: true });
    }
    for (const owner of stores.keys()) if (!keep.has(name(owner))) stores.delete(owner);
  });
}
