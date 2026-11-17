import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "affentrader-sync-"));
  process.env.AFFENTRADER_DATA = dir;
  vi.resetModules();
});
afterEach(async () => {
  delete process.env.AFFENTRADER_DATA;
  await rm(dir, { recursive: true, force: true });
});

const KEY = "a".repeat(48);
const backup = (marker = "x") =>
  JSON.stringify({ version: 1, chart: { state: { marker } }, watchlists: { state: {} }, alerts: { state: {} } });

describe("sync documents", () => {
  it("validates keys and never stores them", async () => {
    const sync = await import("@/lib/server/sync");
    expect(sync.validKey(KEY)).toBe(true);
    expect(sync.validKey("short")).toBe(false);
    expect(sync.validKey("G".repeat(48))).toBe(false);
    expect(sync.validKey(undefined)).toBe(false);
    await sync.pushSync(KEY, { data: backup(), baseRevision: 0, device: "a" });
    const files = await readdir(dir);
    expect(files.some((f) => f.includes(KEY))).toBe(false);
    expect(files.some((f) => f === `sync-${sync.documentId(KEY)}.json`)).toBe(true);
  });
  it("pushes, pulls and increments the revision", async () => {
    const sync = await import("@/lib/server/sync");
    expect(await sync.pullSync(KEY)).toBeNull();
    const first = await sync.pushSync(KEY, { data: backup("1"), baseRevision: 0, device: "laptop" });
    expect(first.revision).toBe(1);
    const second = await sync.pushSync(KEY, { data: backup("2"), baseRevision: 1, device: "phone" });
    expect(second.revision).toBe(2);
    const doc = await sync.pullSync(KEY);
    expect(doc).toMatchObject({ revision: 2, device: "phone" });
    expect(JSON.parse(doc!.data).chart.state.marker).toBe("2");
  });
  it("refuses to overwrite a newer version and reports who wrote it", async () => {
    const sync = await import("@/lib/server/sync");
    await sync.pushSync(KEY, { data: backup(), baseRevision: 0, device: "laptop" });
    await sync.pushSync(KEY, { data: backup(), baseRevision: 1, device: "phone" });
    const error = await sync.pushSync(KEY, { data: backup(), baseRevision: 1, device: "tablet" }).catch((e) => e);
    expect(error).toBeInstanceOf(sync.SyncError);
    expect(error.status).toBe(409);
    expect(error.current).toMatchObject({ revision: 2, device: "phone" });
    expect((await sync.pullSync(KEY))!.revision).toBe(2);
  });
  it("keeps different keys apart", async () => {
    const sync = await import("@/lib/server/sync");
    await sync.pushSync(KEY, { data: backup("mine"), baseRevision: 0, device: "a" });
    expect(await sync.pullSync("b".repeat(48))).toBeNull();
  });
  it("rejects malformed, oversized and non-workspace payloads", async () => {
    const sync = await import("@/lib/server/sync");
    const reject = (data: unknown, status: number) =>
      expect(sync.pushSync(KEY, { data, baseRevision: 0, device: "a" })).rejects.toMatchObject({ status });
    await reject(undefined, 400);
    await reject("{", 400);
    await reject(JSON.stringify({ version: 2 }), 400);
    await reject(JSON.stringify({ hello: "world" }), 400);
    await reject("x".repeat(sync.MAX_SYNC_BYTES + 1), 413);
  });
  it("deletes a synced copy", async () => {
    const sync = await import("@/lib/server/sync");
    await sync.pushSync(KEY, { data: backup(), baseRevision: 0, device: "a" });
    await sync.deleteSync(KEY);
    vi.resetModules();
    expect(await (await import("@/lib/server/sync")).pullSync(KEY)).toBeNull();
  });
});
