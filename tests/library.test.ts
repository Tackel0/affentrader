import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "affentrader-library-"));
  process.env.AFFENTRADER_DATA = dir;
  vi.resetModules();
});
afterEach(async () => {
  delete process.env.AFFENTRADER_DATA;
  await rm(dir, { recursive: true, force: true });
});

const SOURCE = '//@version=6\nindicator("Demo", overlay=true)\nplot(close)';
const lib = () => import("@/lib/server/library");

describe("script library", () => {
  it("publishes, lists and fetches public scripts", async () => {
    const l = await lib();
    const { script, invite } = await l.publishScript({ title: "My EMA", description: "Moving average", author: "Ada", kind: "indicator", tags: ["EMA", "trend", "bad tag!"], source: SOURCE });
    expect(invite).toBeUndefined();
    expect(script.version).toBe(1);
    expect(script.tags).toEqual(["ema", "trend"]);
    const listed = await l.listScripts();
    expect(listed.map((s) => s.title)).toEqual(["My EMA"]);
    expect((await l.getScript(script.id)).source).toBe(SOURCE);
    expect(await l.listScripts({ query: "ada" })).toHaveLength(1);
    expect(await l.listScripts({ query: "zzz" })).toHaveLength(0);
    expect(await l.listScripts({ kind: "strategy" })).toHaveLength(0);
  });

  it("rejects bad input", async () => {
    const l = await lib();
    await expect(l.publishScript({ title: "ok title", source: "" })).rejects.toThrow(/empty/);
    await expect(l.publishScript({ title: "ok title", source: "plot(close)" })).rejects.toThrow(/declaration/);
    await expect(l.publishScript({ title: "x", source: SOURCE })).rejects.toThrow(/title/);
    await expect(l.publishScript({ title: "big", source: SOURCE + " ".repeat(200_001) })).rejects.toThrow(/200 KB/);
  });

  it("keeps invite-only scripts out of listings and behind their code", async () => {
    const l = await lib();
    const { script, invite } = await l.publishScript({ title: "Secret sauce", source: SOURCE, visibility: "invite" });
    expect(invite).toMatch(/^[a-f0-9-]{36}\.[a-f0-9]{24}$/);
    expect(await l.listScripts()).toHaveLength(0);
    await expect(l.getScript(script.id)).rejects.toMatchObject({ status: 404 });
    await expect(l.getScript(script.id, { invite: `${script.id}.${"0".repeat(24)}` })).rejects.toMatchObject({ status: 404 });
    expect((await l.getScript(script.id, { invite })).title).toBe("Secret sauce");
    expect((await l.openInvite(invite!)).id).toBe(script.id);
    expect((await l.getScript(script.id, { owner: true })).id).toBe(script.id);
    await expect(l.openInvite("garbage")).rejects.toMatchObject({ status: 400 });
    // The stored record never contains the secret.
    const raw = JSON.stringify(await l.library.read());
    expect(raw).not.toContain(invite!.split(".")[1]);
  });

  it("versions scripts and regenerates invites", async () => {
    const l = await lib();
    const { script, invite } = await l.publishScript({ title: "Versioned", source: SOURCE, visibility: "invite" });
    const unchanged = await l.updateScript(script.id, { source: SOURCE });
    expect(unchanged.script.version).toBe(1);
    const second = await l.updateScript(script.id, { source: SOURCE + "\nplot(open)", notes: "adds open" });
    expect(second.script.version).toBe(2);
    expect(second.script.versions.map((v) => v.notes)).toEqual(["Initial release", "adds open"]);
    const rotated = await l.updateScript(script.id, { visibility: "invite" });
    expect(rotated.invite).not.toBe(invite);
    await expect(l.getScript(script.id, { invite })).rejects.toMatchObject({ status: 404 });
    expect((await l.getScript(script.id, { invite: rotated.invite })).version).toBe(2);
    const open = await l.updateScript(script.id, { visibility: "public" });
    expect(open.script.visibility).toBe("public");
    expect(await l.listScripts()).toHaveLength(1);
    await expect(l.updateScript("nope", { title: "whatever" })).rejects.toMatchObject({ status: 404 });
  });

  it("caps stored versions", async () => {
    const l = await lib();
    const { script } = await l.publishScript({ title: "Many versions", source: SOURCE });
    for (let i = 0; i < l.MAX_VERSIONS + 5; i++) await l.updateScript(script.id, { source: `${SOURCE}\n// ${i}` });
    const detail = await l.getScript(script.id);
    expect(detail.versions).toHaveLength(l.MAX_VERSIONS);
    expect(detail.version).toBe(l.MAX_VERSIONS + 6);
  });

  it("counts each anonymous reader once", async () => {
    const l = await lib();
    const { script } = await l.publishScript({ title: "Liked", source: SOURCE });
    const a = "a".repeat(32);
    const b = "b".repeat(32);
    expect(await l.setLike(script.id, a, true)).toEqual({ likes: 1, liked: true });
    expect((await l.setLike(script.id, a, true)).likes).toBe(1);
    expect((await l.setLike(script.id, b, true)).likes).toBe(2);
    expect((await l.getScript(script.id, { token: a })).liked).toBe(true);
    expect((await l.setLike(script.id, a, false)).likes).toBe(1);
    const popular = await l.publishScript({ title: "Unloved", source: SOURCE });
    expect((await l.listScripts({ sort: "popular" }))[0].id).toBe(script.id);
    expect(popular.script.likes).toBe(0);
    await expect(l.setLike("nope", a, true)).rejects.toMatchObject({ status: 404 });
    expect(l.validToken("short")).toBe(false);
  });

  it("deletes scripts and lists them for the publisher", async () => {
    const l = await lib();
    const { script } = await l.publishScript({ title: "Hidden one", source: SOURCE, visibility: "invite" });
    expect(await l.mine()).toHaveLength(1);
    expect(await l.deleteScript(script.id)).toBe(true);
    expect(await l.deleteScript(script.id)).toBe(false);
    expect(await l.mine()).toHaveLength(0);
  });
});
