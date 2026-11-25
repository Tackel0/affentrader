import webpush, { type PushSubscription } from "web-push";
import { promises as fs } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import { JsonStore, dataDir } from "./storage";
import { cloudStore, updateCloudDocument, usesNetlifyStorage, CloudConflictError } from "./netlifyStorage";
import { allowPrivateWebhooks, isPrivateAddress, resolvePublicAddresses } from "./webhooks";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export const VAPID_SUBJECT = "mailto:alerts@affentrader.local";
const MAX_SUBSCRIPTIONS = 20;

let keys: VapidKeys | null = null;
let pendingKeys: Promise<VapidKeys> | null = null;

/** VAPID identity of this installation, created on first use. */
export async function vapidKeys(): Promise<VapidKeys> {
  if (usesNetlifyStorage()) {
    const key = "identities/vapid.json";
    const existing = await cloudStore().getWithMetadata(key, { type: "json" });
    if (existing) return existing.data as VapidKeys;
    try { return (await updateCloudDocument<VapidKeys | null>(key, () => null, value => value ?? webpush.generateVAPIDKeys()))!; }
    catch (error) {
      if (!(error instanceof CloudConflictError)) throw error;
      const winner = await cloudStore().getWithMetadata(key, { type: "json" });
      if (!winner) throw error;
      return winner.data as VapidKeys;
    }
  }
  if (keys) return keys;
  if (!pendingKeys) {
    pendingKeys = (async () => {
      const file = path.join(dataDir(), "vapid.json");
      try {
        const parsed = JSON.parse(await fs.readFile(file, "utf8")) as VapidKeys;
        if (parsed.publicKey && parsed.privateKey) return (keys = parsed);
      } catch {
        /* generate below */
      }
      const created = webpush.generateVAPIDKeys();
      await fs.mkdir(path.dirname(file), { recursive: true });
      try {
        await fs.writeFile(file, JSON.stringify(created), { mode: 0o600, flag: "wx" });
        return (keys = created);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          const parsed = JSON.parse(await fs.readFile(file, "utf8")) as VapidKeys;
          if (parsed.publicKey && parsed.privateKey) return (keys = parsed);
        }
        await fs.writeFile(file, JSON.stringify(created), { mode: 0o600 });
        return (keys = created);
      }
    })().finally(() => {
      pendingKeys = null;
    });
  }
  return pendingKeys;
}

export function resetVapidCache() {
  keys = null;
  pendingKeys = null;
}

interface SubscriptionDb {
  subscriptions: (PushSubscription & { addedAt: number })[];
}

export const subscriptions = new JsonStore<SubscriptionDb>("push", () => ({ subscriptions: [] }));

export function validSubscription(value: unknown): value is PushSubscription {
  const s = value as PushSubscription | undefined;
  if (
    !s ||
    typeof s.endpoint !== "string" ||
    s.endpoint.length >= 1000 ||
    typeof s.keys?.p256dh !== "string" ||
    !s.keys.p256dh ||
    typeof s.keys?.auth !== "string" ||
    !s.keys.auth
  ) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(s.endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.hostname.includes("%")) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return false;
  if (!allowPrivateWebhooks()) {
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
      return false;
    }
    if (isIP(host) && isPrivateAddress(host)) return false;
  }
  return true;
}

export async function assertPublicPushEndpoint(endpoint: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Invalid push subscription endpoint.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hostname.includes("%")) {
    throw new Error("Invalid push subscription endpoint.");
  }
  await resolvePublicAddresses(url);
}

export async function addSubscription(subscription: PushSubscription): Promise<void> {
  await subscriptions.update((db) => {
    db.subscriptions = db.subscriptions.filter((s) => s.endpoint !== subscription.endpoint);
    db.subscriptions.push({ endpoint: subscription.endpoint, keys: subscription.keys, addedAt: Date.now() });
    if (db.subscriptions.length > MAX_SUBSCRIPTIONS)
      db.subscriptions.splice(0, db.subscriptions.length - MAX_SUBSCRIPTIONS);
  });
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await subscriptions.update((db) => {
    db.subscriptions = db.subscriptions.filter((s) => s.endpoint !== endpoint);
  });
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  symbol?: string;
}

export interface Sender {
  (subscription: PushSubscription, body: string, options: { vapidDetails: { subject: string; publicKey: string; privateKey: string }; TTL: number }): Promise<unknown>;
}

/** Deliver a notification to every registered browser; dead endpoints are dropped. */
export async function sendPush(
  payload: PushPayload,
  send?: Sender,
): Promise<{ sent: number; removed: number }> {
  const effectiveSend: Sender =
    send ??
    (async (s, b, o) => {
      await assertPublicPushEndpoint(s.endpoint);
      return webpush.sendNotification(s, b, o);
    });
  const { subscriptions: list } = await subscriptions.read();
  if (!list.length) return { sent: 0, removed: 0 };
  const { publicKey, privateKey } = await vapidKeys();
  const body = JSON.stringify({
    title: payload.title.slice(0, 100),
    body: payload.body.slice(0, 300),
    tag: payload.tag,
    symbol: payload.symbol,
  });
  let sent = 0;
  const dead: string[] = [];
  await Promise.all(
    list.map(async (subscription) => {
      try {
        await effectiveSend(subscription, body, {
          vapidDetails: { subject: VAPID_SUBJECT, publicKey, privateKey },
          TTL: 3600,
        });
        sent++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(subscription.endpoint);
      }
    }),
  );
  if (dead.length)
    await subscriptions.update((db) => {
      db.subscriptions = db.subscriptions.filter((s) => !dead.includes(s.endpoint));
    });
  return { sent, removed: dead.length };
}
