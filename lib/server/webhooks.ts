import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { sign } from "./security";

export class WebhookError extends Error {}

/** Delays (ms) before each retry of a failed delivery. */
export const RETRY_DELAYS = [5_000, 30_000, 120_000, 600_000, 3_600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS.length + 1;

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return true;
}

export function allowPrivateWebhooks(): boolean {
  return process.env.AFFENTRADER_ALLOW_PRIVATE_WEBHOOKS === "1";
}

/** Syntactic check used when a rule is saved. */
export function parseWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookError("Webhook URL is not valid.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new WebhookError("Webhook URL must start with http:// or https://.");
  if (url.username || url.password)
    throw new WebhookError("Webhook URL must not contain credentials.");
  if (raw.length > 2000) throw new WebhookError("Webhook URL is too long.");
  return url;
}

/**
 * Refuse destinations on private or link-local networks (cloud metadata,
 * routers, the machine itself) unless the operator opted in, resolving the
 * hostname first so DNS names cannot smuggle an internal address through.
 */
export async function assertPublicDestination(url: URL): Promise<void> {
  if (allowPrivateWebhooks()) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => {
        throw new WebhookError(`Could not resolve ${host}.`);
      })).map((r) => r.address);
  if (!addresses.length) throw new WebhookError(`Could not resolve ${host}.`);
  if (addresses.some(isPrivateAddress))
    throw new WebhookError(
      "Webhook target is on a private network. Set AFFENTRADER_ALLOW_PRIVATE_WEBHOOKS=1 to allow it.",
    );
}

export interface DeliveryPayload {
  event: string;
  rule: { id: string; name: string };
  symbol: string;
  timeframe: string;
  price: number;
  time: number;
  message: string;
  source: "browser" | "server";
  execution?: "strategy_emulator";
  strategyFill?: import("@/types/pineAlerts").PineOrderFill;
  simulated?: boolean;
}

export async function deliverWebhook(
  rawUrl: string,
  secret: string | undefined,
  payload: DeliveryPayload,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const url = parseWebhookUrl(rawUrl);
  await assertPublicDestination(url);
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "affentrader-alerts/1.0",
    "x-affentrader-timestamp": timestamp,
  };
  if (secret) headers["x-affentrader-signature"] = `sha256=${sign(secret, body, timestamp)}`;
  const response = await fetcher(url, {
    method: "POST",
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  if (response.status >= 300 && response.status < 400)
    throw new WebhookError(`Webhook redirected (HTTP ${response.status}); redirects are not followed.`);
  if (!response.ok) throw new WebhookError(`Webhook responded with HTTP ${response.status}.`);
}
