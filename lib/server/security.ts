import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual, createHmac } from "node:crypto";
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
    const expectedHost = request.headers.get("host") ?? options.fallbackHost ?? new URL(request.url).host;
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      parsed.origin === origin &&
      Boolean(expectedHost) &&
      parsed.host === expectedHost
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

/** Bodies larger than this are refused before parsing. */
export const MAX_BODY_BYTES = 256 * 1024;

export async function readJson(request: Request, limit = MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit) throw new HttpError(413, "Request body too large.");
  const text = await request.text();
  if (Buffer.byteLength(text) > limit) throw new HttpError(413, "Request body too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Body must be valid JSON.");
  }
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
