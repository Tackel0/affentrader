import { getStore } from "@netlify/blobs";
import path from "node:path";

/** Explicit configuration also permits testing the serverless path locally. */
export function usesNetlifyStorage(): boolean {
  return process.env.AFFENTRADER_STORAGE === "netlify-blobs" || process.env.NETLIFY === "true" || Boolean(process.env.NETLIFY_BLOBS_CONTEXT);
}

export const cloudStore = () => getStore({ name: "affentrader-private", consistency: "strong" });

export function cloudDocumentKey(name: string, directory: string, root: string): string {
  const relative = path.relative(root, directory).split(path.sep).join("/");
  if (relative.startsWith("..") || path.isAbsolute(relative) || !/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("Invalid cloud document path.");
  return `documents/${relative ? `${relative}/` : ""}${name}.json`;
}

/** Never retry an updater: callers can have transaction-local side effects. */
export async function updateCloudDocument<T>(key: string, fallback: () => T, updater: (draft: T) => T | void): Promise<T> {
  const store = cloudStore();
  const previous = await store.getWithMetadata(key, { type: "json" });
  if (previous && !previous.etag) throw new Error("Cloud storage did not supply a concurrency token.");
  const draft = structuredClone(previous ? previous.data as T : fallback());
  const next = updater(draft) ?? draft;
  const result = await store.setJSON(key, next, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
  if (!result.modified) throw new CloudConflictError();
  return structuredClone(next);
}

export class CloudConflictError extends Error {
  readonly status = 409;
  constructor() { super("Server data changed concurrently. Reload and retry; no newer data was overwritten."); }
}
