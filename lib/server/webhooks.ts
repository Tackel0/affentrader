import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { sign } from "./security";

export class WebhookError extends Error {}

/** Delays (ms) before each retry of a failed delivery. */
export const RETRY_DELAYS = [5_000, 30_000, 120_000, 600_000, 3_600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS.length + 1;

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

function parseIpv4ToWords(ipv4: string): [number, number] | null {
  const parts = ipv4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return [(parts[0] << 8) | parts[1], (parts[2] << 8) | parts[3]];
}

function parseIpv6Groups(raw: string): number[] | null {
  if (raw.includes("%")) return null;
  const halves = raw.toLowerCase().split("::");
  if (halves.length > 2) return null;

  const expandHalf = (part: string, allowIpv4Tail: boolean): number[] | null => {
    if (!part) return [];
    const tokens = part.split(":");
    const out: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (!token) return null;
      if (token.includes(".")) {
        if (!allowIpv4Tail || i !== tokens.length - 1) return null;
        const words = parseIpv4ToWords(token);
        if (!words) return null;
        out.push(words[0], words[1]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(token)) return null;
        out.push(parseInt(token, 16));
      }
    }
    return out;
  };

  if (halves.length === 1) {
    const groups = expandHalf(halves[0], true);
    return groups && groups.length === 8 ? groups : null;
  }
  const left = expandHalf(halves[0], false);
  const right = expandHalf(halves[1], true);
  if (!left || !right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...Array<number>(missing).fill(0), ...right];
}

function wordsToIpv4(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

export function isPrivateAddress(address: string): boolean {
  if (!address || address.includes("%")) return true;
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (version === 6) {
    const g = parseIpv6Groups(address);
    if (!g) return true;
    const prefixZero6 = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
    if (prefixZero6 && g[6] === 0 && g[7] <= 1) return true; // :: and ::1
    if (prefixZero6) return isPrivateAddress(wordsToIpv4(g[6], g[7])); // IPv4-compatible ::a.b.c.d
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
      return isPrivateAddress(wordsToIpv4(g[6], g[7])); // IPv4-mapped ::ffff:0:0/96
    }
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0xffff && g[5] === 0) {
      return isPrivateAddress(wordsToIpv4(g[6], g[7])); // IPv4-translated ::ffff:0:0:0/96
    }
    if (
      g[0] === 0x0064 &&
      g[1] === 0xff9b &&
      ((g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) || g[2] === 1)
    ) {
      return true; // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
    }
    if (g[0] === 0x2002 && isPrivateAddress(wordsToIpv4(g[1], g[2]))) return true; // 6to4 private IPv4
    if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // Discard 100::/64
    if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo 2001::/32
    if (g[0] === 0x2001 && (g[1] & 0xfe00) === 0) return true; // IETF protocol assignments & ORCHID/ORCHIDv2 2001::/23
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // Documentation 2001:db8::/32
    if (g[0] === 0x2001 && g[1] === 0x0002 && g[2] === 0) return true; // Benchmarking 2001:2::/48
    if ((g[0] & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
    if ((g[0] & 0xffc0) === 0xfe80) return true; // Link-local fe80::/10
    if ((g[0] & 0xffc0) === 0xfec0) return true; // Deprecated site-local fec0::/10
    if ((g[0] & 0xff00) === 0xff00) return true; // Multicast ff00::/8
    return false;
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
  if (url.hostname.includes("%"))
    throw new WebhookError("Webhook URL is not valid.");
  if (raw.length > 2000) throw new WebhookError("Webhook URL is too long.");
  return url;
}

export async function resolvePublicAddresses(url: URL): Promise<ResolvedAddress[]> {
  if (allowPrivateWebhooks()) return [];
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host.includes("%")) throw new WebhookError("Webhook URL is not valid.");
  const literalVersion = isIP(host);
  const addresses: ResolvedAddress[] = literalVersion
    ? [{ address: host, family: literalVersion as 4 | 6 }]
    : (
        await lookup(host, { all: true }).catch(() => {
          throw new WebhookError(`Could not resolve ${host}.`);
        })
      ).map((r) => ({
        address: r.address,
        family: (r.family === 6 ? 6 : 4) as 4 | 6,
      }));
  if (!addresses.length) throw new WebhookError(`Could not resolve ${host}.`);
  if (addresses.some((r) => isPrivateAddress(r.address)))
    throw new WebhookError(
      "Webhook target is on a private network. Set AFFENTRADER_ALLOW_PRIVATE_WEBHOOKS=1 to allow it.",
    );
  return addresses;
}

/**
 * Refuse destinations on private or link-local networks (cloud metadata,
 * routers, the machine itself) unless the operator opted in, resolving the
 * hostname first so DNS names cannot smuggle an internal address through.
 */
export async function assertPublicDestination(url: URL): Promise<void> {
  await resolvePublicAddresses(url);
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

function pinnedPost(
  url: URL,
  headers: Record<string, string>,
  body: string,
  resolved: ResolvedAddress[],
  signal: AbortSignal,
): Promise<{ status: number }> {
  const expectedHost = url.hostname.replace(/^\[|\]$/g, "");
  const isHttps = url.protocol === "https:";
  const pinnedLookup: LookupFunction | undefined =
    resolved.length > 0 && !isIP(expectedHost)
      ? (hostname, options, cb) => {
          if (hostname !== expectedHost) {
            cb(new WebhookError("Unexpected webhook hostname."), "", 4);
            return;
          }
          const requestedFamily = options?.family === 4 || options?.family === 6 ? options.family : 0;
          const matches = requestedFamily ? resolved.filter((a) => a.family === requestedFamily) : resolved;
          if (!matches.length) {
            cb(Object.assign(new Error(`No resolved address for family ${requestedFamily}`), { code: "ENOTFOUND" }), "", 4);
            return;
          }
          if (options?.all) {
            cb(
              null,
              matches.map((m) => ({ address: m.address, family: m.family })),
            );
          } else {
            cb(null, matches[0].address, matches[0].family);
          }
        }
      : undefined;

  const requestHeaders: Record<string, string> = {
    ...headers,
    "content-length": String(Buffer.byteLength(body)),
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      fn();
    };

    const transport = isHttps ? https : http;
    const req = transport.request(
      url,
      {
        method: "POST",
        headers: requestHeaders,
        agent: false,
        ...(pinnedLookup ? { lookup: pinnedLookup } : {}),
        ...(isHttps && !isIP(expectedHost) ? { servername: expectedHost } : {}),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300) {
          res.destroy?.();
          finish(() => resolve({ status }));
          return;
        }
        res.resume();
        res.on("end", () => finish(() => resolve({ status })));
        res.on("error", (err) => finish(() => reject(err)));
      },
    );

    const onAbort = () => {
      const reason = signal.reason instanceof Error ? signal.reason : new Error("Webhook request timed out.");
      req.destroy(reason);
      finish(() => reject(reason));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    req.on("error", (err) => finish(() => reject(err)));
    req.end(body);
  });
}

export async function deliverWebhook(
  rawUrl: string,
  secret: string | undefined,
  payload: DeliveryPayload,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const url = parseWebhookUrl(rawUrl);
  const resolved = await resolvePublicAddresses(url);
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "affentrader-alerts/1.0",
    "x-affentrader-timestamp": timestamp,
  };
  if (secret) headers["x-affentrader-signature"] = `sha256=${sign(secret, body, timestamp)}`;

  const signal = AbortSignal.timeout(8000);
  const usingCustomFetcher =
    fetcher !== fetch ||
    "mock" in fetcher ||
    (Boolean(process.env.VITEST) && !String(fetcher).includes("undici"));

  let status: number;
  if (usingCustomFetcher) {
    const response = await fetcher(url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal,
    });
    try {
      status = response.status;
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  } else {
    ({ status } = await pinnedPost(url, headers, body, resolved, signal));
  }

  if (status >= 300 && status < 400)
    throw new WebhookError(`Webhook redirected (HTTP ${status}); redirects are not followed.`);
  if (status < 200 || status >= 300) throw new WebhookError(`Webhook responded with HTTP ${status}.`);
}
