import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonStore } from "@/lib/server/storage";
import { cloudDocumentKey, CloudConflictError } from "@/lib/server/netlifyStorage";
import type { PineJournal } from "@/types/pineAlerts";

const fake = vi.hoisted(() => {
  const documents = new Map<string, { data: unknown; etag: string }>();
  let revision = 0;
  return { documents, store: {
    getWithMetadata: vi.fn(async (key: string) => structuredClone(documents.get(key) ?? null)),
    setJSON: vi.fn(async (key: string, data: unknown, condition: { onlyIfNew?: boolean; onlyIfMatch?: string }) => {
      const previous = documents.get(key);
      if (condition.onlyIfNew ? previous !== undefined : previous?.etag !== condition.onlyIfMatch) return { modified: false };
      const etag = String(++revision);
      documents.set(key, { data: structuredClone(data), etag });
      return { modified: true, etag };
    }),
    list: vi.fn(async ({ prefix }: { prefix: string }) => ({ blobs: [...documents.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) })),
    delete: vi.fn(async (key: string) => { documents.delete(key); }),
  } };
});
vi.mock("@netlify/blobs", () => ({ getStore: () => fake.store }));
beforeEach(() => { fake.documents.clear(); vi.stubEnv("AFFENTRADER_STORAGE", "netlify-blobs"); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("serverless durable storage", () => {
  it("observes another instance's writes without stale process caching", async () => {
    const first = new JsonStore("sample", () => ({ n: 0 })), second = new JsonStore("sample", () => ({ n: 0 }));
    expect(await first.read()).toEqual({ n: 0 });
    await second.update(value => { value.n = 9; });
    expect(await first.read()).toEqual({ n: 9 });
    const copy = await first.read(); copy.n = 99;
    expect(await second.read()).toEqual({ n: 9 });
  });
  it("refuses a lost update across instances and never replays the updater", async () => {
    const first = new JsonStore("race", () => ({ n: 0 })), second = new JsonStore("race", () => ({ n: 0 }));
    const a = vi.fn((value: { n: number }) => { value.n++; }), b = vi.fn((value: { n: number }) => { value.n++; });
    const result = await Promise.allSettled([first.update(a), second.update(b)]);
    expect(result.filter(value => value.status === "fulfilled")).toHaveLength(1);
    expect(result.find(value => value.status === "rejected")).toMatchObject({ reason: expect.any(CloudConflictError) });
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledTimes(1);
    expect(await first.read()).toEqual({ n: 1 });
    await second.update(b);
    expect(await first.read()).toEqual({ n: 2 });
  });
  it("propagates an outage instead of manufacturing an empty workspace", async () => {
    fake.store.getWithMetadata.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(new JsonStore("sample", () => ({ n: 0 })).read()).rejects.toThrow("Storage unavailable");
  });
  it("refuses existing documents without an ETag", async () => {
    fake.documents.set("documents/bad.json", { data: {}, etag: "" });
    await expect(new JsonStore("bad", () => ({})).update(() => ({}))).rejects.toThrow("concurrency token");
  });
  it("keeps subdirectories separate and rejects paths outside the data root", () => {
    expect(cloudDocumentKey("journal", "C:/data/pine", "C:/data")).toBe("documents/pine/journal.json");
    expect(() => cloudDocumentKey("journal", "C:/elsewhere", "C:/data")).toThrow();
    expect(() => cloudDocumentKey("../secret", "C:/data", "C:/data")).toThrow();
  });
  it("derives one server key across instances and fails closed without site authentication", async () => {
    const { accessKey, resetAccessKeyCache } = await import("@/lib/server/security");
    vi.stubEnv("AFFENTRADER_SITE_PASSWORD_HASH", `${"a".repeat(32)}:${"b".repeat(128)}`);
    vi.stubEnv("AFFENTRADER_SITE_SESSION_SECRET", "c".repeat(64));
    const first = await accessKey(); resetAccessKeyCache();
    expect(await accessKey()).toBe(first); expect(first).toMatch(/^[a-f0-9]{48}$/);
    vi.stubEnv("AFFENTRADER_SITE_SESSION_SECRET", "");
    await expect(accessKey()).rejects.toThrow("Configure private site access");
  });
  it("keeps the winning VAPID identity during concurrent cold starts", async () => {
    const { vapidKeys } = await import("@/lib/server/push");
    const [first, second] = await Promise.all([vapidKeys(), vapidKeys()]);
    expect(first).toEqual(second);
    expect(first.publicKey).toHaveLength(87);
  });
  it("saves, rejects a stale revision and deletes a cloud workspace", async () => {
    const sync = await import("@/lib/server/sync");
    const key = "f".repeat(48), data = JSON.stringify({ version: 1, chart: {}, watchlists: {}, alerts: {} });
    await sync.pushSync(key, { data, baseRevision: 0, device: "first" });
    await expect(sync.pushSync(key, { data, baseRevision: 0, device: "stale" })).rejects.toMatchObject({ status: 409 });
    expect((await sync.pullSync(key))?.device).toBe("first");
    await sync.deleteSync(key); expect(await sync.pullSync(key)).toBeNull();
  });
  it("does not create a persistent timer in a serverless invocation", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    const { startAlertRunner } = await import("@/lib/server/alertRunner");
    expect(startAlertRunner()).toMatchObject({ running: false, intervalMs: 60_000 });
    expect(interval).not.toHaveBeenCalled();
  });
  it("recovers, acknowledges and prunes cloud Pine journals without filesystem access", async () => {
    const journal = await import("@/lib/server/pineJournalStore");
    const value = { id: "journal", epoch: "run", acknowledged: 0, records: [{ sequence: 1 }] } as PineJournal;
    await journal.appendPineJournal("owner", value);
    expect(await journal.loadPineJournal("owner")).toEqual(value);
    await journal.acknowledgePineJournal("owner", value.id, 99);
    expect((await journal.loadPineJournal("owner"))?.acknowledged).toBe(1);
    await journal.prunePineJournals([{ owner: "owner", epoch: "run" }]);
    expect(await journal.loadPineJournal("owner")).toBeDefined();
    await journal.prunePineJournals([]);
    expect(await journal.loadPineJournal("owner")).toBeUndefined();
  });
  it("rejects stale cloud Pine appends and preserves the committed journal", async () => {
    const journal = await import("@/lib/server/pineJournalStore");
    const value = { id: "journal", epoch: "run", acknowledged: 0, records: [{ sequence: 1 }] } as PineJournal;
    await journal.appendPineJournal("owner", value);
    await expect(journal.appendPineJournal("owner", value)).rejects.toThrow("changed during evaluation");
    await expect(journal.appendPineJournal("owner", { ...value, id: "stale-restart" })).rejects.toThrow("changed during evaluation");
    expect(await journal.loadPineJournal("owner")).toEqual(value);
  });
});
