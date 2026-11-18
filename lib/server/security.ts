import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { dataDir } from "./storage";
import { usesNetlifyStorage } from "./netlifyStorage";
import { siteAccessConfig } from "./siteAccess";

let cachedKey: string | null = null;

/**
 * The per-installation access key. It is created on first use, stored in
 * `.data/access-key.txt` and required (as `x-affentrader-key`) for every
 * route that stores data on, or sends requests from, the server. Network
 * headers cannot prove a request is local, so a shared secret is the only
 * dependable check.
 */
let pendingKey: Promise<string> | null = null;

export interface SameOriginOptions {
  allowMissingOrigin?: boolean;
  fallbackHost?: string;
}

/**
 * Validate same-origin requests behind reverse proxies (e.g. Envoy/Azure/Netlify)
 * where request.url may normalize to the bind address (0.0.0.0:3000) rather than Host.
 */
export function isSameOriginRequest(request: Request, options: SameOriginOptions = {}): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return Boolean(options.allowMissingOrigin);
  try {
    const parsed = new URL(origin);
    const expectedHost = (request.headers.get("host") ?? options.fallbackHost ?? new URL(request.url).host).trim();
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      parsed.origin.toLowerCase() === origin.trim().toLowerCase() &&
      Boolean(expectedHost) &&
      parsed.host.toLowerCase() === expectedHost.toLowerCase()
    );
  } catch {
    return false;
  }
}

export async function accessKey(): Promise<string> {
  if (usesNetlifyStorage()) {
    const settings = siteAccessConfig();
    if (!settings) throw new Error("Configure private site access before using server features.");
    return createHmac("sha256", settings.secret).update("affentrader:server-access:v1").digest("hex").slice(0, 48);
  }
  if (cachedKey) return cachedKey;
  if (!pendingKey) {
    pendingKey = (async () => {
      const file = path.join(dataDir(), "access-key.txt");
      try {
        const existing = (await fs.readFile(file, "utf8")).trim();
        if (/^[a-f0-9]{48}$/.test(existing)) return (cachedKey = existing);
      } catch {
        /* create below */
      }
      const created = randomBytes(24).toString("hex");
      await fs.mkdir(path.dirname(file), { recursive: true });
      try {
        await fs.writeFile(file, `${created}\n`, { mode: 0o600, flag: "wx" });
        return (cachedKey = created);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          const existing = (await fs.readFile(file, "utf8")).trim();
          if (/^[a-f0-9]{48}$/.test(existing)) return (cachedKey = existing);
        }
        await fs.writeFile(file, `${created}\n`, { mode: 0o600 });
        return (cachedKey = created);
      }
    })().finally(() => {
      pendingKey = null;
    });
  }
  return pendingKey;
}

export function resetAccessKeyCache() {
  cachedKey = null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function isAuthorized(request: Request): Promise<boolean> {
  const supplied = request.headers.get("x-affentrader-key");
  if (!supplied) return false;
  return safeEqual(supplied, await accessKey());
}

/**
 * Checks `x-affentrader-key` against an existing key without generating or
 * writing `.data/access-key.txt` when no key exists yet (used by public `/api/health`).
 */
export async function isAuthorizedWithoutCreatingKey(request: Request): Promise<boolean> {
  const supplied = request.headers.get("x-affentrader-key");
  if (!supplied) return false;
  if (usesNetlifyStorage()) {
    const settings = siteAccessConfig();
    if (!settings) return false;
    const expected = createHmac("sha256", settings.secret).update("affentrader:server-access:v1").digest("hex").slice(0, 48);
    return safeEqual(supplied, expected);
  }
  if (cachedKey) return safeEqual(supplied, cachedKey);
  if (pendingKey) {
    const pending = await pendingKey.catch(() => null);
    return pending ? safeEqual(supplied, pending) : false;
  }
  const file = path.join(dataDir(), "access-key.txt");
  try {
    const existing = (await fs.readFile(file, "utf8")).trim();
    if (/^[a-f0-9]{48}$/.test(existing)) {
      cachedKey = existing;
      return safeEqual(supplied, existing);
    }
  } catch {
    /* key file does not exist yet */
  }
  return false;
}

/** Bodies larger than this are refused before parsing. */
export const MAX_BODY_BYTES = 256 * 1024;

export async function readJson(request: Request, limit = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const rawLength = request.headers.get("content-length");
  if (rawLength !== null) {
    const declared = Number(rawLength);
    if (Number.isFinite(declared) && declared > limit) {
      await request.body?.cancel().catch(() => undefined);
      throw new HttpError(413, "Request body too large.");
    }
  }

  let text = "";
  const reader = request.body?.getReader();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) {
          await reader.cancel().catch(() => undefined);
          throw new HttpError(413, "Request body too large.");
        }
        chunks.push(chunk.value);
      }
      text = Buffer.concat(chunks).toString("utf8");
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, "Could not read request body.");
    }
  } else {
    text = await request.text();
    if (Buffer.byteLength(text) > limit) throw new HttpError(413, "Request body too large.");
  }

  if (!text.trim()) throw new HttpError(400, "Body must be valid JSON.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "Body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

const MAX_RATE_BUCKETS = 2000;
const apiBuckets = new Map<string, { window: number; count: number }>();

export function apiRateBucketKey(sessionToken: string, tier: "read" | "heavy"): string {
  const digest = createHash("sha256").update(sessionToken).digest("hex").slice(0, 16);
  return `${tier}:${digest}`;
}

export function takeApiAttempt(
  bucketKey: string,
  limit: number,
  now = Date.now(),
): { allowed: boolean; retryAfterSec: number } {
  const window = Math.floor(now / 60_000);
  const existing = apiBuckets.get(bucketKey);
  const entry = existing && existing.window === window ? existing : { window, count: 0 };
  entry.count += 1;
  apiBuckets.delete(bucketKey);
  apiBuckets.set(bucketKey, entry);
  if (apiBuckets.size > MAX_RATE_BUCKETS) {
    const oldest = apiBuckets.keys().next().value;
    if (oldest !== undefined) apiBuckets.delete(oldest);
  }
  const msRemaining = (window + 1) * 60_000 - now;
  const retryAfterSec = Math.max(1, Math.ceil(msRemaining / 1000));
  return { allowed: entry.count <= limit, retryAfterSec };
}

export function resetApiRateLimit(): void {
  apiBuckets.clear();
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function sign(secret: string, body: string, timestamp: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
