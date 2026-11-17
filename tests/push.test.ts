import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "affentrader-push-"));
  process.env.AFFENTRADER_DATA = dir;
  vi.resetModules();
});
afterEach(async () => {
  delete process.env.AFFENTRADER_DATA;
  await rm(dir, { recursive: true, force: true });
});

const subscription = (n: number) => ({
  endpoint: `https://push.example.com/send/${n}`,
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
});

describe("push subscriptions", () => {
  it("validates subscriptions strictly", async () => {
    const { validSubscription } = await import("@/lib/server/push");
    expect(validSubscription(subscription(1))).toBe(true);
    expect(validSubscription({ ...subscription(1), endpoint: "http://insecure.example.com" })).toBe(false);
    expect(validSubscription({ endpoint: "https://x", keys: {} })).toBe(false);
    expect(validSubscription(null)).toBe(false);
  });
  it("stores each endpoint once and caps the list", async () => {
    const push = await import("@/lib/server/push");
    await push.addSubscription(subscription(1));
    await push.addSubscription(subscription(1));
    expect((await push.subscriptions.read()).subscriptions).toHaveLength(1);
    for (let i = 2; i < 40; i++) await push.addSubscription(subscription(i));
    const list = (await push.subscriptions.read()).subscriptions;
    expect(list).toHaveLength(20);
    expect(list.at(-1)!.endpoint.endsWith("/39")).toBe(true);
    await push.removeSubscription(list.at(-1)!.endpoint);
    expect((await push.subscriptions.read()).subscriptions).toHaveLength(19);
  });
  it("creates one persistent VAPID identity", async () => {
    const push = await import("@/lib/server/push");
    const first = await push.vapidKeys();
    expect(first.publicKey.length).toBeGreaterThan(40);
    expect(JSON.parse(await readFile(path.join(dir, "vapid.json"), "utf8")).publicKey).toBe(first.publicKey);
    vi.resetModules();
    const again = await (await import("@/lib/server/push")).vapidKeys();
    expect(again).toEqual(first);
  });
  it("sends to every browser, trims payloads and drops expired endpoints", async () => {
    const push = await import("@/lib/server/push");
    await push.addSubscription(subscription(1));
    await push.addSubscription(subscription(2));
    const send = vi.fn(async (s: { endpoint: string }, _body: string, _options: { vapidDetails: { subject: string } }) => {
      void _body;
      void _options;
      if (s.endpoint.endsWith("/2")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    const result = await push.sendPush({ title: "t".repeat(300), body: "b".repeat(900), tag: "x" }, send as never);
    expect(result).toEqual({ sent: 1, removed: 1 });
    const payload = JSON.parse(send.mock.calls[0][1]);
    expect(payload.title).toHaveLength(100);
    expect(payload.body).toHaveLength(300);
    expect(send.mock.calls[0][2].vapidDetails.subject).toBe(push.VAPID_SUBJECT);
    expect((await push.subscriptions.read()).subscriptions).toHaveLength(1);
    const transient = vi.fn(async () => {
      throw Object.assign(new Error("busy"), { statusCode: 503 });
    });
    expect(await push.sendPush({ title: "a", body: "b" }, transient as never)).toEqual({ sent: 0, removed: 0 });
    expect((await push.subscriptions.read()).subscriptions).toHaveLength(1);
  });
  it("does nothing when nobody subscribed", async () => {
    const push = await import("@/lib/server/push");
    const send = vi.fn();
    expect(await push.sendPush({ title: "a", body: "b" }, send as never)).toEqual({ sent: 0, removed: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
