"use client";
import { useState } from "react";
import { Cloud, Copy, RefreshCw } from "lucide-react";
import { useChartStore } from "@/stores/useChartStore";
import { defaultDevice, newSyncKey, useAccountSyncStore, useSyncStore } from "@/stores/useSyncStore";
import { checkRemote, deleteRemoteCopy, pullWorkspace, pushWorkspace } from "@/lib/sync";
import { hasLegacyWorkspace, importLegacyWorkspace, workspaceFingerprint } from "@/lib/workspaceBackup";
import { workspaceProfile } from "@/lib/accountScope";
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
  const keys = useSyncStore(), accountState = useAccountSyncStore();
  const signedIn = Boolean(workspaceProfile());
  const account = signedIn && !keys.key;
  const s = account ? accountState : keys;
  const [entry, setEntry] = useState("");
  const [reveal, setReveal] = useState(false);
  const [message, setMessage] = useState("");
  if (!open) return null;
  const close = () => useChartStore.getState().set({ syncOpen: false });
  const dirty = (account || s.key) && s.syncedFingerprint !== workspaceFingerprint();
  const behind = s.remote && s.remote.revision > s.revision;
  const connect = (key: string, fresh: boolean) => {
    keys.set({ key, revision: 0, syncedFingerprint: "", device: keys.device || defaultDevice(), status: "idle", error: "", remote: null });
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
        {account && <>
          <p className="form-help">Dein Konto speichert Watchlists, Chart-Layouts, Zeichnungen, Indikatorvorlagen, Pine-Entwürfe, Alerts und das Setup-Journal.</p>
          <div className={`sync-status ${s.status}`} role="status">{s.status === "conflict" ? "Es gibt Änderungen auf diesem Gerät und im Konto." : s.status === "syncing" ? "Workspace wird synchronisiert…" :
            behind ? "Im Konto liegt eine neuere Kopie." : dirty ? "Lokale Änderungen warten auf die Synchronisierung." : "Workspace im Konto gespeichert."}</div>
          <label className="check-row"><input type="checkbox" checked={s.auto} onChange={event => s.set({ auto: event.target.checked })} /> Automatisch synchronisieren</label>
          {s.lastSyncedAt > 0 && <p className="form-help">Zuletzt synchronisiert {new Date(s.lastSyncedAt).toLocaleString("de-DE")}</p>}
          <div className="sync-actions">
            <button type="button" className="button small" onClick={() => void run(() => checkRemote().then(Boolean), "Kontostand geprüft.")}>Prüfen</button>
            <button type="button" className="button small" disabled={s.status === "syncing" || Boolean(behind)} onClick={() => void run(pushWorkspace, "Workspace im Konto gespeichert.")}>Jetzt speichern</button>
            <button type="button" className="button small" disabled={s.status === "syncing" || !s.remote?.revision} onClick={() => {
              if (window.confirm("Den Workspace dieses Browsers durch die Kopie im Konto ersetzen?")) void pullWorkspace();
            }}>Kopie aus Konto laden</button>
          </div>
          {hasLegacyWorkspace() && <button type="button" className="button small" disabled={s.status === "syncing"} onClick={() => {
            if (window.confirm("Den bisherigen Workspace dieses Browsers in dein Konto übernehmen? Der aktuell geöffnete Workspace wird dabei ersetzt.")) {
              void importLegacyWorkspace().catch(error => setMessage(error instanceof Error ? error.message : "Der bisherige Workspace konnte nicht übernommen werden."));
            }
          }}>Bisherigen Browser-Workspace übernehmen</button>}
        </>}
        {!s.key ? (
          <details open={account ? undefined : true}>
            <summary>Mit einem Schlüssel synchronisieren</summary>
            <p className="form-help">
              Der Schlüssel öffnet einen eigenen Synchronisierungsbereich. Du kannst denselben Schlüssel auf deinen Geräten verwenden.
            </p>
            <button className="button primary" onClick={() => connect(newSyncKey(), true)}>
              <Cloud size={14} /> Create a sync key
            </button>
            <label>
              Or enter a key from another device
              <input
                aria-label="Sync key"
                type="password"
                autoComplete="off"
                placeholder="48-character key"
                value={entry}
                onChange={(e) => setEntry(e.target.value.trim().toLowerCase())}
              />
            </label>
            <button className="button" disabled={!/^[a-f0-9]{32,64}$/.test(entry)} onClick={() => connect(entry, false)}>
              Use this key
            </button>
          </details>
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
                    if (signedIn) accountState.set({ auto: false, status: "off", remote: null });
                    keys.set({ key: "", revision: 0, syncedFingerprint: "", status: "off", remote: null });
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
