"use client";
import { accountScopedName } from "@/lib/accountScope";
import type { ScriptDetail, ScriptKind, ScriptSummary, Visibility } from "@/lib/server/library";

export type { ScriptDetail, ScriptKind, ScriptSummary, Visibility };

const READER_KEY = "affentrader-reader-v1";

/** Anonymous per-browser id used only to count each like once. */
export function readerToken(): string {
  try {
    const existing = localStorage.getItem(accountScopedName(READER_KEY));
    if (existing && /^[a-f0-9]{32}$/.test(existing)) return existing;
    const made = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(accountScopedName(READER_KEY), made);
    return made;
  } catch {
    return "0".repeat(32);
  }
}

export class LibraryRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(query: string, init: RequestInit = {}, serverKey = ""): Promise<T> {
  const timeout = AbortSignal.timeout(20_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const response = await fetch(`/api/library${query}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      "x-affentrader-reader": readerToken(),
      ...(serverKey ? { "x-affentrader-key": serverKey } : {}),
    },
    signal,
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new LibraryRequestError(body.error ?? `Server responded with HTTP ${response.status}`, response.status);
  return body;
}

export interface PublishFields {
  title: string;
  description: string;
  author: string;
  kind: ScriptKind;
  tags: string[];
  visibility: Visibility;
  source: string;
  notes: string;
}

export const scriptLibrary = {
  list: (query: string, kind: string, sort: string, signal?: AbortSignal) =>
    call<{ scripts: ScriptSummary[] }>(`?q=${encodeURIComponent(query)}&kind=${encodeURIComponent(kind)}&sort=${sort}`, { signal }),
  mine: (serverKey: string, signal?: AbortSignal) => call<{ scripts: ScriptSummary[] }>("?mine=1", { signal }, serverKey),
  get: (id: string, invite = "", serverKey = "", signal?: AbortSignal) =>
    call<{ script: ScriptDetail }>(
      `?id=${encodeURIComponent(id)}${invite ? `&invite=${encodeURIComponent(invite)}` : ""}${serverKey ? "&owner=1" : ""}`,
      { signal },
      serverKey,
    ),
  openInvite: (code: string) => call<{ script: ScriptDetail }>(`?invite=${encodeURIComponent(code.trim())}`),
  publish: (serverKey: string, fields: PublishFields) =>
    call<{ script: ScriptDetail; invite?: string }>("", { method: "POST", body: JSON.stringify(fields) }, serverKey),
  update: (serverKey: string, id: string, fields: Partial<PublishFields>) =>
    call<{ script: ScriptDetail; invite?: string }>("", { method: "PUT", body: JSON.stringify({ id, ...fields }) }, serverKey),
  remove: (serverKey: string, id: string) =>
    call<{ removed: boolean }>(`?id=${encodeURIComponent(id)}`, { method: "DELETE" }, serverKey),
  like: (id: string, liked: boolean, invite = "") =>
    call<{ likes: number; liked: boolean }>("", { method: "POST", body: JSON.stringify({ action: "like", id, liked, invite }) }),
};
