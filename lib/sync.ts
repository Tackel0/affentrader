"use client";
import { defaultDevice, useAccountSyncStore, useSyncStore, type RemoteInfo } from "@/stores/useSyncStore";
import { ACCOUNT_SCOPE_HEADER, readWorkspaceProfile, workspaceProfile } from "@/lib/accountScope";
import {
  createWorkspaceBackup,
  workspaceFingerprint,
} from "@/lib/workspaceBackup";

interface PullResponse extends RemoteInfo {
  data: string | null;
  error?: string;
  current?: RemoteInfo;
}

function connection() {
  const profile = workspaceProfile();
  if (profile !== readWorkspaceProfile()) return null;
  const key = useSyncStore.getState().key;
  if (key) return { store: useSyncStore, header: "x-affentrader-sync", value: key };
  return profile ? { store: useAccountSyncStore, header: ACCOUNT_SCOPE_HEADER, value: profile } : null;
}

const active = (target: NonNullable<ReturnType<typeof connection>>) => {
  const current = connection();
  return current?.store === target.store && current.value === target.value;
};

async function call(
  target: NonNullable<ReturnType<typeof connection>>,
  init: RequestInit & { query?: string } = {},
): Promise<{ status: number; body: PullResponse }> {
  const response = await fetch(`/api/sync${init.query ?? ""}`, {
    ...init,
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), [target.header]: target.value },
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as PullResponse };
}

function fail(target: NonNullable<ReturnType<typeof connection>>, message: string, status: "offline" | "error" = "error") {
  if (active(target)) target.store.getState().set({ status, error: message });
}

/** Ask the server how new its copy is, without downloading it. */
export async function checkRemote(): Promise<RemoteInfo | null> {
  const target = connection();
  if (!target) return null;
  const state = target.store.getState();
  try {
    const { status, body } = await call(target, { query: "?peek=1" });
    const current = target.store.getState();
    // A delayed peek must not overwrite a new connection or an in-flight upload.
    if (!active(target) || current.revision !== state.revision || current.status === "syncing") return null;
    if (status !== 200) {
      fail(target, body.error ?? `Server responded with HTTP ${status}`);
      return null;
    }
    const remote = { revision: body.revision, updatedAt: body.updatedAt, device: body.device };
    const conflicting = remote.revision > current.revision && current.syncedFingerprint !== workspaceFingerprint();
    target.store.getState().set({
      remote,
      error: "",
      status: conflicting ? "conflict" : "idle",
    });
    return remote;
  } catch {
    const current = target.store.getState();
    if (!active(target) || current.revision !== state.revision || current.status === "syncing") return null;
    fail(target, "The sync server is unreachable.", "offline");
    return null;
  }
}

/** Upload this workspace. Returns false when another device was ahead. */
export async function pushWorkspace(): Promise<boolean> {
  const target = connection();
  if (!target) return false;
  const state = target.store.getState();
  if (state.status === "syncing") return false;
  state.set({ status: "syncing", error: "" });
  try {
    // The baseline must describe the bytes sent, not edits made while awaiting HTTP.
    const data = JSON.stringify(createWorkspaceBackup());
    const fingerprint = workspaceFingerprint(data);
    const { status, body } = await call(target, {
      method: "PUT",
      body: JSON.stringify({
        data,
        baseRevision: state.revision,
        device: state.device || defaultDevice(),
      }),
    });
    if (!active(target)) return false;
    if (status === 409) {
      target.store.getState().set({ status: "conflict", remote: body.current ?? null });
      return false;
    }
    if (status !== 200) {
      fail(target, body.error ?? `Server responded with HTTP ${status}`);
      return false;
    }
    target.store.getState().set({
      revision: body.revision,
      syncedFingerprint: fingerprint,
      lastSyncedAt: Date.now(),
      status: "idle",
      remote: { revision: body.revision, updatedAt: body.updatedAt, device: state.device || defaultDevice() },
    });
    return true;
  } catch {
    if (!active(target)) return false;
    fail(target, "The sync server is unreachable.", "offline");
    return false;
  }
}

/** Download the server's copy and replace this browser's workspace with it. */
export async function pullWorkspace(ifUnchanged = workspaceFingerprint()): Promise<boolean> {
  const target = connection();
  if (!target) return false;
  const state = target.store.getState();
  if (state.status === "syncing") return false;
  state.set({ status: "syncing", error: "" });
  try {
    const { status, body } = await call(target);
    if (!active(target)) return false;
    if (status !== 200) {
      fail(target, body.error ?? `Server responded with HTTP ${status}`);
      return false;
    }
    if (!body.data) {
      fail(target, "Der Server hat noch keine Kopie dieses Workspace.");
      return false;
    }
    // Validation inside restoreWorkspaceText runs before anything is written, so a
    // corrupt copy never replaces local data; only then is the new baseline recorded.
    const parsed = body.data;
    const revision = body.revision;
    const set = target.store.getState().set;
    let validated: import("@/lib/workspace").WorkspaceBackup;
    try {
      const { parseWorkspace } = await import("@/lib/workspace");
      validated = parseWorkspace(parsed);
    } catch (error) {
      fail(target, `Die gespeicherte Kopie ist ungültig: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    if (!active(target)) return false;
    if (workspaceFingerprint() !== ifUnchanged) {
      set({ status: "conflict", remote: { revision, updatedAt: body.updatedAt, device: body.device } });
      return false;
    }
    set({ revision, lastSyncedAt: Date.now(), adopt: true, status: "idle", error: "" });
    const { restoreWorkspace } = await import("@/lib/workspaceBackup");
    await restoreWorkspace(validated, () => active(target) && workspaceFingerprint() === ifUnchanged);
    return true;
  } catch (error) {
    if (active(target) && target.store.getState().adopt) target.store.getState().set({ adopt: false, revision: state.revision, lastSyncedAt: state.lastSyncedAt });
    fail(target, error instanceof Error ? error.message : String(error));
    return false;
  }
}

export async function deleteRemoteCopy(): Promise<void> {
  const target = connection();
  if (target?.header === "x-affentrader-sync") await call(target, { method: "DELETE" }).catch(() => undefined);
}
