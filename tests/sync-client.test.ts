// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRemote, pushWorkspace } from "@/lib/sync";
import { createWorkspaceBackup, workspaceFingerprint } from "@/lib/workspaceBackup";
import { useChartStore } from "@/stores/useChartStore";
import { useSyncStore } from "@/stores/useSyncStore";
import { hotStorage } from "@/lib/debouncedStorage";

function pendingRequest() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const response = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  const fetch = vi.fn<typeof globalThis.fetch>(() => response);
  vi.stubGlobal("fetch", fetch);
  return { fetch, reject, respond: (status = 200) => resolve(new Response(JSON.stringify({
    revision: 1, updatedAt: 123, device: "laptop", current: { revision: 2, updatedAt: 124, device: "phone" },
  }), { status })) };
}

beforeEach(() => {
  useSyncStore.setState(useSyncStore.getInitialState(), true);
  useChartStore.getState().set({ pineDraft: { name: "Sync regression", source: "before upload", activeId: null } });
  useSyncStore.getState().set({ key: "a".repeat(48), status: "idle", device: "laptop" });
});

afterEach(() => {
  hotStorage.discard();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("workspace upload snapshots", () => {
  it("keeps edits made during a slow upload dirty and includes them in the next upload", async () => {
    const request = pendingRequest();
    const stringify = vi.spyOn(JSON, "stringify");
    const upload = pushWorkspace();
    const sent = JSON.parse(request.fetch.mock.calls[0][1]!.body as string);
    expect(JSON.parse(sent.data).chart.state.pineDraft.source).toBe("before upload");
    useChartStore.getState().set({ pineDraft: { name: "Sync regression", source: "edited while uploading", activeId: null } });
    request.respond();
    expect(await upload).toBe(true);
    // A push exports the workspace only once, including no second capture after HTTP.
    const exports = stringify.mock.calls.filter(([value]) => value?.version === 1 && value?.chart && value?.premium);
    expect(exports).toHaveLength(1);
    expect(useSyncStore.getState().syncedFingerprint).toBe(workspaceFingerprint(sent.data));
    expect(useSyncStore.getState().syncedFingerprint).not.toBe(workspaceFingerprint());

    const next = pendingRequest();
    const secondUpload = pushWorkspace();
    const second = JSON.parse(next.fetch.mock.calls[0][1]!.body as string);
    expect(second.baseRevision).toBe(1);
    expect(JSON.parse(second.data).chart.state.pineDraft.source).toBe("edited while uploading");
    next.respond();
    expect(await secondUpload).toBe(true);
    expect(useSyncStore.getState().syncedFingerprint).toBe(workspaceFingerprint());
  });

  it("does not start duplicate uploads while one is pending", async () => {
    const request = pendingRequest();
    const upload = pushWorkspace();
    expect(await pushWorkspace()).toBe(false);
    expect(request.fetch).toHaveBeenCalledTimes(1);
    request.respond();
    expect(await upload).toBe(true);
  });

  it.each([200, 409, 503, "offline"])("ignores a %s upload response after changing connections", async (status) => {
    const request = pendingRequest();
    const upload = pushWorkspace();
    useSyncStore.getState().set({ key: "b".repeat(48), revision: 7, syncedFingerprint: "new baseline", status: "idle" });
    const connected = useSyncStore.getState();
    if (status === "offline") request.reject(new Error("Network failed"));
    else request.respond(Number(status));
    expect(await upload).toBe(false);
    expect(useSyncStore.getState()).toBe(connected);
  });

  it("keeps an unchanged uploaded workspace clean", async () => {
    const request = pendingRequest();
    const upload = pushWorkspace();
    request.respond();
    expect(await upload).toBe(true);
    expect(useSyncStore.getState().syncedFingerprint).toBe(workspaceFingerprint());
    expect(workspaceFingerprint(JSON.stringify(createWorkspaceBackup()))).toBe(workspaceFingerprint());
  });

  it.each([409, 503, "offline"])("keeps the previous baseline when an upload fails with %s", async (status) => {
    useSyncStore.getState().set({ syncedFingerprint: "previous baseline" });
    const request = pendingRequest();
    const upload = pushWorkspace();
    if (status === "offline") request.reject(new Error("Network failed"));
    else request.respond(Number(status));
    expect(await upload).toBe(false);
    expect(useSyncStore.getState().syncedFingerprint).toBe("previous baseline");
    expect(useSyncStore.getState().revision).toBe(0);
    expect(useSyncStore.getState().status).toBe(status === 409 ? "conflict" : status === 503 ? "error" : "offline");
  });
});

describe("delayed sync metadata", () => {
  it("does not overwrite a new connection with stale metadata", async () => {
    const request = pendingRequest();
    const peek = checkRemote();
    useSyncStore.getState().set({ key: "b".repeat(48), revision: 7, remote: null });
    const connected = useSyncStore.getState();
    request.respond();
    expect(await peek).toBeNull();
    expect(useSyncStore.getState()).toBe(connected);
  });

  it.each(["syncing", "completed"])("does not let an old peek reset a %s upload", async (phase) => {
    const request = pendingRequest();
    const peek = checkRemote();
    useSyncStore.getState().set(phase === "syncing" ? { status: "syncing" } : { revision: 3, status: "idle" });
    const uploading = useSyncStore.getState();
    request.respond();
    expect(await peek).toBeNull();
    expect(useSyncStore.getState()).toBe(uploading);
  });

  it("ignores a late network failure after an upload advances the revision", async () => {
    const request = pendingRequest();
    const peek = checkRemote();
    useSyncStore.getState().set({ revision: 3, status: "idle" });
    const uploaded = useSyncStore.getState();
    request.reject(new Error("Network failed"));
    expect(await peek).toBeNull();
    expect(useSyncStore.getState()).toBe(uploaded);
  });
});
