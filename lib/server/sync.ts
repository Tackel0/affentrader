import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { JsonStore, dataDir } from "./storage";
import { cloudStore, usesNetlifyStorage } from "./netlifyStorage";

export const MAX_SYNC_BYTES = 8_000_000;
export const MAX_SYNC_DOCUMENTS = 100;

export interface SyncDocument {
  revision: number;
  updatedAt: number;
  device: string;
  /** The workspace backup, as the JSON string the browser produced. */
  data: string;
}

export class SyncError extends Error {
  constructor(
    public status: number,
    message: string,
    public current?: { revision: number; updatedAt: number; device: string },
  ) {
    super(message);
  }
}

/** Sync keys are capability tokens: 48 hex characters generated in the browser. */
export function validKey(key: unknown): key is string {
  return typeof key === "string" && /^[a-f0-9]{32,64}$/.test(key);
}

/** The server stores a document under the hash of its key, never the key. */
export function documentId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 40);
}

const stores = new Map<string, JsonStore<SyncDocument | null>>();
function storeFor(key: string) {
  return workspaceStore(`sync-${documentId(key)}`);
}

function workspaceStore(name: string) {
  const dir = dataDir();
  const id = `${dir}:${name}`;
  let store = stores.get(id);
  if (!store) {
    store = new JsonStore<SyncDocument | null>(name, () => null, () => dir);
    stores.set(id, store);
    if (stores.size > 500) stores.delete(stores.keys().next().value!);
  }
  return store;
}

async function documentCount(): Promise<number> {
  if (usesNetlifyStorage()) return (await cloudStore().list({ prefix: "documents/sync-" })).blobs.length;
  try {
    return (await fs.readdir(dataDir())).filter((f) => /^sync-[a-f0-9]{40}\.json$/.test(f)).length;
  } catch {
    return 0;
  }
}

export async function pullSync(key: string): Promise<SyncDocument | null> {
  return storeFor(key).read();
}

function accountStore(profile: string) {
  if (!/^[a-f0-9]{32}$/.test(profile)) throw new SyncError(401, "Invalid workspace account.");
  return workspaceStore(`account-workspace-${profile}`);
}

export const pullAccountSync = (profile: string) => accountStore(profile).read();

export function checkPayload(data: unknown): asserts data is string {
  if (typeof data !== "string" || !data) throw new SyncError(400, "Missing workspace data.");
  if (Buffer.byteLength(data) > MAX_SYNC_BYTES) throw new SyncError(413, "Workspace exceeds the 8 MB sync limit.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new SyncError(400, "Workspace data is not valid JSON.");
  }
  const doc = parsed as { version?: unknown; chart?: unknown; watchlists?: unknown; alerts?: unknown };
  if (!doc || doc.version !== 1 || !doc.chart || !doc.watchlists || !doc.alerts)
    throw new SyncError(400, "Not a workspace backup.");
}

/**
 * Store a workspace. `baseRevision` is the revision the caller last saw; a
 * mismatch means another device pushed in between and nothing is overwritten.
 */
export async function pushSync(
  key: string,
  input: { data: unknown; baseRevision: number; device: string },
): Promise<{ revision: number; updatedAt: number }> {
  return writeWorkspace(storeFor(key), input, true);
}

export function pushAccountSync(profile: string, input: { data: unknown; baseRevision: number; device: string }) {
  return writeWorkspace(accountStore(profile), input, false);
}

async function writeWorkspace(
  store: JsonStore<SyncDocument | null>,
  input: { data: unknown; baseRevision: number; device: string },
  keyLimit: boolean,
) {
  if (typeof input.baseRevision !== "number" || !Number.isInteger(input.baseRevision) || input.baseRevision < 0) {
    throw new SyncError(400, "Invalid baseRevision.");
  }
  checkPayload(input.data);
  const current = await store.read();
  const currentRevision = current?.revision ?? 0;
  if (keyLimit && !current && (await documentCount()) >= MAX_SYNC_DOCUMENTS)
    throw new SyncError(507, "This server holds the maximum number of synced workspaces.");
  if (input.baseRevision !== currentRevision)
    throw new SyncError(409, "Another device synced a newer version first.", current
      ? { revision: current.revision, updatedAt: current.updatedAt, device: current.device }
      : undefined);
  const next: SyncDocument = {
    revision: currentRevision + 1,
    updatedAt: Date.now(),
    device: String(input.device ?? "device").slice(0, 60),
    data: input.data,
  };
  await store.update(latest => {
    if ((latest?.revision ?? 0) !== input.baseRevision) {
      throw new SyncError(
        409,
        "Another device synced a newer version first.",
        latest ? { revision: latest.revision, updatedAt: latest.updatedAt, device: latest.device } : undefined,
      );
    }
    return next;
  });
  return { revision: next.revision, updatedAt: next.updatedAt };
}

export async function deleteSync(key: string): Promise<void> {
  const id = documentId(key);
  stores.delete(`${dataDir()}:sync-${id}`);
  if (usesNetlifyStorage()) {
    await cloudStore().delete(`documents/sync-${id}.json`);
    return;
  }
  const file = path.join(dataDir(), `sync-${id}.json`);
  await Promise.all([file, `${file}.bak`].map((f) => fs.rm(f, { force: true })));
}
