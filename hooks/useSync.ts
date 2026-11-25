"use client";
import { useEffect } from "react";
import { useAccountSyncStore, useSyncStore } from "@/stores/useSyncStore";
import { useChartStore } from "@/stores/useChartStore";
import { checkRemote, pullWorkspace, pushWorkspace } from "@/lib/sync";
import { isPopout } from "@/lib/windowScope";
import { workspaceFingerprint } from "@/lib/workspaceBackup";
import { hadLocalAccountWorkspace, workspaceProfile } from "@/lib/accountScope";

const CHECK_MS = 30_000;
const CHANGE_MS = 10_000;

/**
 * Keeps this workspace in step with the sync server: it pushes local edits
 * when no other device has moved ahead, tells the user when a newer copy is
 * waiting, and never overwrites anything silently when both sides changed.
 */
export function useSync() {
  const key = useSyncStore((s) => s.key);
  useEffect(() => {
    const account = !key && Boolean(workspaceProfile());
    const store = account ? useAccountSyncStore : useSyncStore;
    if (!key && !account) {
      useSyncStore.getState().set({ status: "off", remote: null });
      return;
    }
    // One window syncs the shared workspace; pop-outs only follow it.
    if (isPopout()) return;
    let disposed = false, checking = false;
    let announced = 0;
    const initial = store.getState();
    // After a pull + reload, stores are synchronously hydrated from localStorage;
    // record the restored baseline immediately so early user edits are not swallowed.
    if (initial.adopt) initial.set({ adopt: false, syncedFingerprint: workspaceFingerprint() });
    const initialFingerprint = account && !hadLocalAccountWorkspace() && !initial.revision && !initial.syncedFingerprint ? workspaceFingerprint() : null;
    const tick = async () => {
      const s = store.getState();
      if (disposed || checking || s.status === "syncing" || s.adopt || document.hidden) return;
      checking = true;
      try {
        const remote = await checkRemote();
        if (!remote || disposed) return;
        const state = store.getState();
        const fingerprint = workspaceFingerprint();
        const changed = state.syncedFingerprint !== fingerprint;
        const untouched = !changed || (state.revision === 0 && !state.syncedFingerprint && initialFingerprint === fingerprint);
        if (account && remote.revision > state.revision && untouched && state.auto) {
          await pullWorkspace(fingerprint);
          return;
        }
        if (remote.revision > state.revision && !changed && announced !== remote.revision) {
          announced = remote.revision;
          useChartStore.getState().toast("Neuere Workspace-Kopie", "Öffne die Synchronisierung, um den neueren Stand zu laden.", "info");
        }
        if (state.auto && changed && remote.revision === state.revision && state.status !== "conflict") await pushWorkspace();
      } finally {
        checking = false;
      }
    };
    const first = setTimeout(() => void tick(), account ? 150 : 3000);
    const remoteTimer = setInterval(() => void tick(), CHECK_MS);
    const changeTimer = setInterval(() => {
      const s = store.getState();
      if (!s.auto || s.status !== "idle" || s.adopt || checking || document.hidden) return;
      if (s.syncedFingerprint !== workspaceFingerprint() && s.remote && s.remote.revision === s.revision)
        void pushWorkspace();
    }, CHANGE_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      disposed = true;
      clearTimeout(first);
      clearInterval(remoteTimer);
      clearInterval(changeTimer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [key]);
}
