"use client";
import { defaultDevice, useSyncStore, type RemoteInfo } from "@/stores/useSyncStore";
import {
  createWorkspaceBackup,
  restoreWorkspaceText,
  workspaceFingerprint,
} from "@/lib/workspaceBackup";

interface PullResponse extends RemoteInfo {
  data: string | null;
  error?: string;
  current?: RemoteInfo;
}

async function call(
  key: string,
  init: RequestInit & { query?: string } = {},
): Promise<{ status: number; body: PullResponse }> {
  const response = await fetch(`/api/sync${init.query ?? ""}`, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), "x-affentrader-sync": key },
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as PullResponse };
}

function fail(message: string, status: "offline" | "error" = "error") {
  useSyncStore.getState().set({ status, error: message });
}

/** Ask the server how new its copy is, without downloading it. */
export async function checkRemote(): Promise<RemoteInfo | null> {
  const state = useSyncStore.getState();
  if (!state.key) return null;
  try {
    const { status, body } = await call(state.key, { query: "?peek=1" });
    if (status !== 200) {
      fail(body.error ?? `Server responded with HTTP ${status}`);
      return null;
    }
    const remote = { revision: body.revision, updatedAt: body.updatedAt, device: body.device };
    const conflicting = remote.revision > state.revision && state.syncedFingerprint !== workspaceFingerprint();
    useSyncStore.getState().set({
      remote,
      error: "",
      status: conflicting ? "conflict" : "idle",
    });
    return remote;
  } catch {
    fail("The sync server is unreachable.", "offline");
    return null;
  }
}

/** Upload this workspace. Returns false when another device was ahead. */
export async function pushWorkspace(): Promise<boolean> {
  const state = useSyncStore.getState();
  if (!state.key) return false;
  state.set({ status: "syncing", error: "" });
  try {
    const { status, body } = await call(state.key, {
      method: "PUT",
      body: JSON.stringify({
        data: JSON.stringify(createWorkspaceBackup()),
        baseRevision: state.revision,
        device: state.device || defaultDevice(),
      }),
    });
    if (status === 409) {
      useSyncStore.getState().set({ status: "conflict", remote: body.current ?? null });
      return false;
    }
    if (status !== 200) {
      fail(body.error ?? `Server responded with HTTP ${status}`);
      return false;
    }
    useSyncStore.getState().set({
      revision: body.revision,
      syncedFingerprint: workspaceFingerprint(),
      lastSyncedAt: Date.now(),
      status: "idle",
      remote: { revision: body.revision, updatedAt: body.updatedAt, device: state.device || defaultDevice() },
    });
    return true;
  } catch {
    fail("The sync server is unreachable.", "offline");
    return false;
  }
}

/** Download the server's copy and replace this browser's workspace with it. */
export async function pullWorkspace(): Promise<boolean> {
  const state = useSyncStore.getState();
  if (!state.key) return false;
  state.set({ status: "syncing", error: "" });
  try {
    const { status, body } = await call(state.key);
    if (status !== 200) {
      fail(body.error ?? `Server responded with HTTP ${status}`);
      return false;
    }
    if (!body.data) {
      fail("Nothing has been synced to this key yet.");
      return false;
    }
    // Validation inside restoreWorkspaceText runs before anything is written, so a
    // corrupt copy never replaces local data; only then is the new baseline recorded.
    const parsed = body.data;
    const revision = body.revision;
    const set = useSyncStore.getState().set;
    try {
      const { parseWorkspace } = await import("@/lib/workspace");
      parseWorkspace(parsed);
    } catch (error) {
      fail(`The synced copy is invalid: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    set({ revision, lastSyncedAt: Date.now(), adopt: true, status: "idle", error: "" });
    await restoreWorkspaceText(parsed);
    return true;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return false;
  }
}

export async function deleteRemoteCopy(): Promise<void> {
  const state = useSyncStore.getState();
  if (state.key) await call(state.key, { method: "DELETE" }).catch(() => undefined);
}
