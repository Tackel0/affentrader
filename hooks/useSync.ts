"use client";
import { useEffect } from "react";
import { useSyncStore } from "@/stores/useSyncStore";
import { useChartStore } from "@/stores/useChartStore";
import { checkRemote, pushWorkspace } from "@/lib/sync";
import { isPopout } from "@/lib/windowScope";
import { workspaceFingerprint } from "@/lib/workspaceBackup";

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
    if (!key) {
      useSyncStore.getState().set({ status: "off", remote: null });
      return;
    }
    // One window syncs the shared workspace; pop-outs only follow it.
    if (isPopout()) return;
    let disposed = false;
    let announced = 0;
    // After a pull the restored workspace becomes the baseline once stores have settled.
    const adopt = setTimeout(() => {
      const s = useSyncStore.getState();
      if (s.adopt) s.set({ adopt: false, syncedFingerprint: workspaceFingerprint() });
    }, 2500);
    const tick = async () => {
      const s = useSyncStore.getState();
      if (disposed || s.status === "syncing" || s.adopt) return;
      const remote = await checkRemote();
      if (!remote || disposed) return;
      const state = useSyncStore.getState();
      const changed = state.syncedFingerprint !== workspaceFingerprint();
      if (remote.revision > state.revision && !changed && announced !== remote.revision) {
        announced = remote.revision;
        useChartStore
          .getState()
          .toast("Newer workspace available", `${remote.device || "Another device"} synced changes. Open Sync in the menu to pull them.`, "info");
      }
      if (state.auto && changed && remote.revision === state.revision && state.status !== "conflict") await pushWorkspace();
    };
    const first = setTimeout(() => void tick(), 3000);
    const remoteTimer = setInterval(() => void tick(), CHECK_MS);
    const changeTimer = setInterval(() => {
      const s = useSyncStore.getState();
      if (!s.auto || s.status !== "idle" || s.adopt) return;
      if (s.syncedFingerprint !== workspaceFingerprint() && s.remote && s.remote.revision === s.revision)
        void pushWorkspace();
    }, CHANGE_MS);
    return () => {
      disposed = true;
      clearTimeout(adopt);
      clearTimeout(first);
      clearInterval(remoteTimer);
      clearInterval(changeTimer);
    };
  }, [key]);
}
