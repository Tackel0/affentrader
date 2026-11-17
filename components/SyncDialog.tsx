"use client";
import { useState } from "react";
import { Cloud, Copy, RefreshCw } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { defaultDevice, newSyncKey, useSyncStore } from "@/stores/useSyncStore";
import { checkRemote, deleteRemoteCopy, pullWorkspace, pushWorkspace } from "@/lib/sync";
import { workspaceFingerprint } from "@/lib/workspaceBackup";
import { Modal } from "./ui";

const STATUS: Record<string, string> = {
  off: "Not syncing",
  idle: "Up to date",
  syncing: "Syncing…",
  conflict: "Both this device and another changed the workspace",
  offline: "Sync server unreachable",
  error: "Sync problem",
};

export function SyncDialog() {
  const open = useChartStore((s) => s.syncOpen);
  const s = useSyncStore();
  const [entry, setEntry] = useState("");
  const [reveal, setReveal] = useState(false);
  const [message, setMessage] = useState("");
  if (!open) return null;
  const close = () => useChartStore.getState().set({ syncOpen: false });
  const dirty = s.key && s.syncedFingerprint !== workspaceFingerprint();
  const behind = s.remote && s.remote.revision > s.revision;
  const connect = (key: string, fresh: boolean) => {
    s.set({ key, revision: 0, syncedFingerprint: "", device: s.device || defaultDevice(), status: "idle", error: "", remote: null });
    setMessage(fresh ? "Sync key created. Push this workspace, then enter the key on your other devices." : "");
    void checkRemote();
  };
  const run = async (task: () => Promise<boolean>, success: string) => {
    setMessage("");
    const ok = await task();
    if (ok) setMessage(success);
  };
  return (
    <Modal title="Sync across devices" onClose={close} className="small-modal">
      <div className="form-body">
        {!s.key ? (
          <>
            <p className="form-help">
              Sync copies your charts, drawings, watchlists, alerts and layouts through this server so another browser or device can pick them up. No account is needed: a secret key names your sync space, so keep it private.
            </p>
            <button className="button primary" onClick={() => connect(newSyncKey(), true)}>
              <Cloud size={14} /> Create a sync key
            </button>
            <label>
              Or enter a key from another device
              <input
                aria-label="Sync key"
                autoComplete="off"
                placeholder="48-character key"
                value={entry}
                onChange={(e) => setEntry(e.target.value.trim().toLowerCase())}
              />
            </label>
            <button className="button" disabled={!/^[a-f0-9]{32,64}$/.test(entry)} onClick={() => connect(entry, false)}>
              Use this key
            </button>
          </>
        ) : (
          <>
            <div className={`sync-status ${s.status}`}>
              <span className={`status-dot ${s.status === "idle" ? "" : "amber"}`} />
              {STATUS[s.status] ?? s.status}
              {behind ? " · a newer copy is waiting" : dirty ? " · local changes not pushed" : ""}
            </div>
            <label>
              Sync key
              <div className="key-row">
                <input readOnly aria-label="Your sync key" type={reveal ? "text" : "password"} value={s.key} />
                <button type="button" className="button small" onClick={() => setReveal(!reveal)}>
                  {reveal ? "Hide" : "Show"}
                </button>
                <button
                  type="button"
                  className="button small"
                  aria-label="Copy sync key"
                  onClick={() => {
                    void navigator.clipboard?.writeText(s.key);
                    setMessage("Key copied.");
                  }}
                >
                  <Copy size={12} />
                </button>
              </div>
            </label>
            <label>
              This device is called
              <input value={s.device} maxLength={60} onChange={(e) => s.set({ device: e.target.value })} />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={s.auto} onChange={(e) => s.set({ auto: e.target.checked })} />
              Push my changes automatically
            </label>
            <p className="form-help">
              {s.remote?.revision
                ? `Server copy: revision ${s.remote.revision} from ${s.remote.device || "another device"} · ${new Date(s.remote.updatedAt).toLocaleString()}`
                : "The server has no copy yet."}
              {s.lastSyncedAt ? ` · last synced ${new Date(s.lastSyncedAt).toLocaleTimeString()}` : ""}
            </p>
            {s.status === "conflict" ? (
              <p className="error-message">
                Another device synced while you also made changes. Pull to take the server copy (your local changes on this device are replaced), or push to keep yours only after pulling once.
              </p>
            ) : null}
            <div className="sync-actions">
              <button className="button small" onClick={() => void run(() => checkRemote().then(Boolean), "Checked.")}>
                <RefreshCw size={12} /> Check
              </button>
              <button
                className="button small"
                disabled={s.status === "syncing" || Boolean(behind)}
                onClick={() => void run(pushWorkspace, "Pushed to the server.")}
              >
                Push now
              </button>
              <button
                className="button small"
                disabled={s.status === "syncing" || !s.remote?.revision}
                onClick={() => {
                  if (window.confirm("Replace this browser's workspace with the synced copy? The page reloads.")) void pullWorkspace();
                }}
              >
                Pull and reload
              </button>
            </div>
            <div className="sync-actions">
              <button
                className="link-button"
                onClick={() => {
                  if (window.confirm("Stop syncing on this device? Other devices keep their copies.")) {
                    s.set({ key: "", revision: 0, syncedFingerprint: "", status: "off", remote: null });
                  }
                }}
              >
                Disconnect this device
              </button>
              <button
                className="link-button"
                onClick={() => {
                  if (window.confirm("Delete the copy stored on the server? Devices keep their local data.")) {
                    void deleteRemoteCopy().then(() => s.set({ revision: 0, remote: null }));
                  }
                }}
              >
                Delete server copy
              </button>
            </div>
          </>
        )}
        {s.error ? <p className="error-message">{s.error}</p> : null}
        {message ? <p className="ticket-ok">{message}</p> : null}
      </div>
      <div className="modal-actions">
        <button className="button primary" onClick={close}>
          Done
        </button>
      </div>
    </Modal>
  );
}
